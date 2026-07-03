"use client";

// LeadDrawer · the rich right-side lead-detail drawer for the agency leads
// workbench — the #1 prototype-vs-product gap, now URL-driven (?lead=<businessId>).
//
// Opens when `businessId` is non-null; lazily fetches the agency-scoped detail
// payload via getLeadDetailAction (loading skeleton meanwhile; the LAST payload
// stays on screen while a new one refetches so prev/next feels instant). Renders
// the prototype's 9 sections using the already-ported drawer classes
// (.drawer-scrim / .drawer / .dhead / .dsec / .dglance / .gauge / .dfacts /
// .dcontacts / .fsig / .dchips / .dacc[.ghost] / .callout / .dfoot — all defined
// in agency-portal.css). Data-domain accordions render REAL rows when enriched,
// else a ghost "not enriched yet — enrich to unlock" card.
//
// Per .claude/rules/cache-components.md Pattern 4: this is a client component;
// the callbacks (onClose / onNav) are owned by the client parent (LeadsWorkbench),
// so no function prop crosses a server→client boundary. Per
// .claude/rules/ui-ux-agency.md: dense, jargon-OK, numbers over adjectives.
// English-only.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";

import { Icon } from "@/components/agency/Icon";
import { showToast } from "@/components/agency/Toast";
import { StatusPill } from "@/modules/agency-portal/components/StatusPill";
import { GenerateTouchesOverlay } from "./GenerateTouchesOverlay";
import { InfoTip } from "./InfoTip";
import { reportWrongDataAction } from "../dispute-actions";

// WP4-16 · the vs-cell explainer (restored from the prototype). The drawer's
// evidence values are toned green/red against this cell's typical — this one
// sentence tells Tom what the colors mean, so a delta is never silent.
const VS_CELL_EXPLAINER =
  "Values are shown against this cell's typical (median) and leaders — so a number means something. Green = better than the cell, red = worse.";
import {
  getLeadDetailAction,
  shareAuditLinkAction,
  type GetLeadDetailResult,
} from "../lead-detail-actions";
import type {
  LeadDetail,
  LeadDomainBlock,
  LeadEvidenceRow,
  LeadFiredSignal,
  LeadSignalVerdict,
} from "../lead-detail";
import type { CellBand } from "../leads-workbench";
import { percentileFromBand } from "../visual-helpers";
import { VsCellBar } from "./VsCellBar";
import { enrichTypesForDomainKey, openEnrichSheet } from "../enrich-sheet-bus";

export interface LeadDrawerProps {
  /** The open lead's businessId, or null when the drawer is closed. */
  businessId: string | null;
  /** The discovery this workbench is scoped to — selects whose persisted signals
   *  the lead is evaluated against for the "why this qualifies" verdicts (P3). */
  discoveryId: string;
  /** The CURRENT visible (filtered + sorted, flattened if grouped) row ids. */
  orderedIds: string[];
  /**
   * WP5-11 · the workbench's vs-cell distribution bands (keyed by numeric
   * column key: reviews / rating / perf / match). Evidence rows whose payload
   * carries a `metric` render a VsCellBar against the matching band; rows
   * without one (or when the cohort was too small for bands) keep the text
   * form — graceful fallback, never a broken bar.
   */
  bands?: Partial<Record<string, CellBand>>;
  /** Close the drawer (clears ?lead). */
  onClose: () => void;
  /** Navigate to another lead by businessId (prev/next). */
  onNav: (id: string) => void;
}

/**
 * The settled result of the most-recent finished load. `loadedId` records WHICH
 * businessId it reflects — so "is the open lead still loading?" is a derived
 * comparison (loadedId !== businessId) rather than a synchronous setState in the
 * fetch effect (which the react-hooks/set-state-in-effect rule forbids).
 */
type Loaded =
  | { kind: "none" }
  | { kind: "ok"; loadedId: string; lead: LeadDetail }
  | { kind: "error"; loadedId: string; message: string };

export function LeadDrawer({
  businessId,
  discoveryId,
  orderedIds,
  bands,
  onClose,
  onNav,
}: LeadDrawerProps) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "none" });
  // The last successfully-loaded lead, kept visible while a sibling refetches.
  const [lastLead, setLastLead] = useState<LeadDetail | null>(null);
  // WP5-2 · the single-lead touch-generation overlay (footer CTA).
  const [genOpen, setGenOpen] = useState(false);
  // WP6-10 · the agency-branded share link's "opened Nx" count, tagged with the
  // businessId it belongs to so the render ignores a stale count after the lead
  // changes (no synchronous setState-in-effect reset — per this file's rule).
  const [shareViews, setShareViews] = useState<{
    forId: string;
    count: number;
  } | null>(null);
  const [sharing, startShare] = useTransition();
  const xBtnRef = useRef<HTMLButtonElement | null>(null);
  // WP4-8 · the drawer element — scopes the Tab focus-trap so focus can't
  // escape to the table behind the scrim (a11y for role=dialog aria-modal).
  const drawerRef = useRef<HTMLElement | null>(null);
  // Token guards against an out-of-order resolve when the user clicks fast.
  const reqToken = useRef(0);

  const open = businessId != null;

  // ── Fetch on businessId change (setState only in async callbacks) ──────────
  useEffect(() => {
    if (businessId == null) return;
    const token = ++reqToken.current;
    getLeadDetailAction(businessId, discoveryId)
      .then((res: GetLeadDetailResult) => {
        if (token !== reqToken.current) return; // superseded
        if (res.status === "ok") {
          setLoaded({ kind: "ok", loadedId: businessId, lead: res.lead });
          setLastLead(res.lead);
        } else {
          setLoaded({
            kind: "error",
            loadedId: businessId,
            message: errorMessage(res.status),
          });
        }
      })
      .catch(() => {
        if (token !== reqToken.current) return;
        setLoaded({
          kind: "error",
          loadedId: businessId,
          message: "Couldn't load this lead.",
        });
      });
  }, [businessId, discoveryId]);

  // ── Prev/next over the CURRENT visible order ───────────────────────────────
  const navTo = useCallback(
    (dir: -1 | 1) => {
      if (businessId == null || orderedIds.length === 0) return;
      const pos = orderedIds.indexOf(businessId);
      if (pos < 0) return;
      let next = pos + dir;
      if (next < 0) next = orderedIds.length - 1;
      if (next >= orderedIds.length) next = 0;
      onNav(orderedIds[next]);
    },
    [businessId, orderedIds, onNav],
  );

  // ── WP6-10 · mint + copy the agency-branded share link ─────────────────────
  const onShare = useCallback(() => {
    if (businessId == null) return;
    const forId = businessId;
    startShare(async () => {
      const res = await shareAuditLinkAction(forId, discoveryId);
      if (res.status !== "ok") {
        showToast("Couldn't create a share link. Try again.");
        return;
      }
      setShareViews({ forId, count: res.viewCount });
      try {
        await navigator.clipboard.writeText(res.url);
        showToast("Audit link copied");
      } catch {
        // Clipboard blocked (permissions / insecure context) — still a win:
        // the link exists. Surface it so Tom can copy it manually.
        showToast(res.url);
      }
    });
  }, [businessId, discoveryId]);

  // ── Keyboard (WP4-8) · Escape closes · ↑/↓ walk prev/next lead · Tab traps ──
  // Focus the close button on open. ArrowUp/ArrowDown walk the sibling leads
  // (mouse-free triage — the buttons stay for the mouse). Tab is trapped inside
  // the drawer so focus can't fall behind the scrim to the table (a11y: a
  // role=dialog aria-modal must not leak focus). Arrow-nav is skipped while the
  // user is typing in a field (no forms in the drawer today, but defensive).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing =
        target != null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (!typing && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        navTo(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      // Tab focus-trap: keep Tab / Shift+Tab cycling within the drawer.
      if (e.key === "Tab" && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (active && !drawerRef.current.contains(active)) {
          // Focus somehow outside the drawer → pull it back in.
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => xBtnRef.current?.focus(), 60);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose, navTo]);

  // The settled result reflects the OPEN lead only when loadedId matches.
  const settled =
    businessId != null &&
    loaded.kind !== "none" &&
    loaded.loadedId === businessId
      ? loaded
      : null;
  // Loading whenever the open lead's result hasn't settled yet.
  const isLoading = open && settled == null;
  const isError = settled?.kind === "error";
  const errorText = settled?.kind === "error" ? settled.message : null;
  // What to render: the settled lead when ready, else the last one while loading.
  const lead = settled?.kind === "ok" ? settled.lead : lastLead;

  return (
    <>
      <div
        className={`drawer-scrim${open ? " show" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        className={`drawer${open ? " show" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leadDrawerName"
        aria-hidden={!open}
      >
        {/* ── Header ── */}
        <div className="dhead">
          <div className="nav-arrows">
            {/* WP4-8 · kbd hints in the tooltip — ↑/↓ walk prev/next lead. */}
            <button
              type="button"
              className="ab"
              onClick={() => navTo(-1)}
              aria-label="Previous lead (press up arrow)"
              title="Previous lead · ↑"
              disabled={orderedIds.length < 2}
            >
              <Icon name="arrow-up" size={15} />
            </button>
            <button
              type="button"
              className="ab"
              onClick={() => navTo(1)}
              aria-label="Next lead (press down arrow)"
              title="Next lead · ↓"
              disabled={orderedIds.length < 2}
            >
              <Icon name="arrow-down" size={15} />
            </button>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              id="leadDrawerName"
              style={{ marginBottom: 3, fontSize: 19 }}
              title={lead?.name}
            >
              {lead?.name ?? (isLoading ? "Loading…" : "Lead")}
            </h1>
            <p className="note" style={{ margin: 0 }}>
              {lead ? headerSub(lead) : isError ? errorText : " "}
            </p>
            {lead ? (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 8,
                  flexWrap: "wrap",
                }}
              >
                <Pills lead={lead} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="x"
            ref={xBtnRef}
            onClick={onClose}
            aria-label="Close drawer"
          >
            ×
          </button>
        </div>

        {/* ── Body ── */}
        <div className="dbody">
          {isError && !lead ? (
            <div className="dsec">
              <p className="note" style={{ margin: 0 }}>
                {errorText ?? "Couldn't load."}
              </p>
            </div>
          ) : lead ? (
            <DrawerBody lead={lead} dimmed={isLoading} bands={bands} />
          ) : (
            <DrawerSkeleton />
          )}
        </div>

        {/* ── Footer ── */}
        <div className="dfoot">
          <button
            type="button"
            className="btn primary"
            disabled={businessId == null}
            onClick={() => setGenOpen(true)}
          >
            Generate touch
          </button>
          {/* WP6-10 · agency-branded share link (copies to clipboard). */}
          <button
            type="button"
            className="btn"
            disabled={businessId == null || sharing}
            onClick={onShare}
          >
            {sharing ? "Creating link…" : "Share audit link"}
          </button>
          {shareViews != null && shareViews.forId === businessId ? (
            <span className="note" style={{ marginLeft: "auto" }}>
              {shareViews.count === 0
                ? "Not opened yet"
                : `Opened ${shareViews.count}× by the prospect`}
            </span>
          ) : null}
        </div>
      </aside>

      {/* WP5-2 · real single-lead generation (replaces the toast apology).
          On success the overlay deep-links to the Touchpoints tab. */}
      <GenerateTouchesOverlay
        businessIds={businessId != null ? [businessId] : []}
        discoveryId={discoveryId}
        open={genOpen}
        onClose={() => setGenOpen(false)}
      />
    </>
  );
}

// ── Header helpers ───────────────────────────────────────────────────────────

function headerSub(lead: LeadDetail): string {
  const bits: string[] = [];
  if (lead.addressLine && lead.addressLine !== "—") bits.push(lead.addressLine);
  if (lead.category) bits.push(lead.category);
  const rev =
    lead.rating != null
      ? `⭐ ${lead.rating.toFixed(1)}${lead.reviewCount != null ? ` (${lead.reviewCount.toLocaleString()})` : ""}`
      : null;
  if (rev) bits.push(rev);
  if (lead.openStatus && lead.openStatus !== "—") bits.push(lead.openStatus);
  return bits.join(" · ");
}

function Pills({ lead }: { lead: LeadDetail }) {
  const reachTone = reachabilityTone(lead.reachability);
  return (
    <>
      <span className={`pill ${reachTone} dot`}>
        Reachable · {lead.reachability.toLowerCase()}
      </span>
      <span className="pill indigo">Match {lead.match}%</span>
      <StatusPill status={lead.status} as="span" />
      {lead.complianceFlag ? (
        <span className="pill amber dot">Compliance: pixel risk</span>
      ) : (
        <span className="pill green dot">No compliance flags</span>
      )}
      {lead.closed ? (
        <span className="pill red dot">{lead.openStatus}</span>
      ) : null}
    </>
  );
}

function reachabilityTone(tier: string): "green" | "amber" | "red" {
  switch (tier) {
    case "RICH":
    case "MULTI":
      return "green";
    case "PHONE_ONLY":
    case "EMAIL_ONLY":
      return "amber";
    case "UNREACHABLE":
      return "red";
    default:
      return "amber";
  }
}

// ── Body ─────────────────────────────────────────────────────────────────────

function DrawerBody({
  lead,
  dimmed,
  bands,
}: {
  lead: LeadDetail;
  dimmed: boolean;
  bands?: Partial<Record<string, CellBand>>;
}) {
  const gaugeColor =
    lead.match >= 85
      ? "var(--green)"
      : lead.match >= 72
        ? "var(--indigo)"
        : "var(--amber)";

  return (
    <div
      style={
        dimmed
          ? ({ opacity: 0.55, transition: "opacity .15s" } as CSSProperties)
          : undefined
      }
      aria-busy={dimmed}
    >
      {/* 3. At a glance */}
      <div className="dsec">
        <div className="brand-eyebrow">At a glance</div>
        <div className="dglance">
          <div
            className="gauge"
            style={
              {
                "--pct": String(lead.match),
                "--gc": gaugeColor,
              } as CSSProperties
            }
          >
            <div className="gv">
              <b>{lead.match}</b>
              <span>match</span>
            </div>
          </div>
          <div className="dgcol">
            <div className="dfacts">
              {lead.facts.map((f) => (
                <div className="dfact" key={f.key}>
                  <div className="fk">{f.key}</div>
                  <div className="fv" title={f.value}>
                    {f.value}
                  </div>
                </div>
              ))}
            </div>
            <ContactsStrip lead={lead} />
          </div>
        </div>
      </div>

      {/* 4. Why this lead qualifies + 5. Other angles */}
      <div className="dsec">
        <div className="brand-eyebrow" style={{ margin: "0 0 2px" }}>
          Expert signals · composites
        </div>
        <h2 style={{ margin: "0 0 10px" }}>Why this lead qualifies</h2>

        {/* The research's chosen signals, with honest per-lead verdicts (P3):
            fired / didn't / not computable yet ("enrich to unlock"). */}
        {lead.signalVerdicts.length > 0 ? (
          <SignalVerdicts verdicts={lead.signalVerdicts} />
        ) : null}

        {lead.firedSignals.length === 0 ? (
          lead.signalVerdicts.length === 0 ? (
            <p className="note" style={{ margin: 0 }}>
              No composite signals fired — this lead matched on raw qualifiers
              only. Open the data sections below for the raw evidence.
            </p>
          ) : null
        ) : (
          lead.firedSignals.map((s) => (
            <FiredSignal
              key={s.key}
              signal={s}
              bands={bands}
              businessId={lead.businessId}
            />
          ))
        )}
        {lead.angles.length > 0 ? (
          <>
            <div className="dchips-head">Other angles to pitch</div>
            <div className="dchips">
              {lead.angles.map((a, i) => (
                <span
                  key={`${a.label}-${i}`}
                  className={`ppchip ${a.group}`}
                  title={a.title}
                >
                  {a.label}
                </span>
              ))}
            </div>
          </>
        ) : null}
        {/* WP6-9 · "we only cite what we verified" — surfaces when touch
            generation pruned a claim it couldn't confirm (whyJson.droppedTokens).
            Auditable evidence as a visible trust feature. */}
        {lead.verifiedNote ? (
          <p
            className="note"
            style={{ margin: "8px 0 0", fontSize: 11 }}
            role="note"
          >
            {lead.verifiedNote}
          </p>
        ) : null}
      </div>

      {/* 6. Data-domain accordions */}
      {lead.domains.map((d) => (
        <DomainAccordion
          key={d.key}
          block={d}
          bands={bands}
          businessId={lead.businessId}
        />
      ))}

      {/* 7. Expert findings */}
      {lead.expertFindings.length > 0 ? (
        <div className="dacc open" style={{ marginBottom: 8 }}>
          <div className="dacc-head" style={{ cursor: "default" }}>
            <span className="dacc-ic" aria-hidden="true">
              <Icon name="expert" size={15} />
            </span>
            <span className="dacc-title">Expert findings</span>
            <span className="dacc-sum">
              {lead.expertFindings.length} flag
              {lead.expertFindings.length === 1 ? "" : "s"} to check
            </span>
          </div>
          <div className="dacc-body">
            {lead.expertFindings.map((f) => (
              <div
                key={f.key}
                className={`callout ${f.tone}`}
                style={{ fontSize: 12, marginTop: 8 }}
              >
                <Icon name="warning" size={14} style={{ flex: "none" }} />
                <p style={{ margin: 0 }}>
                  <b>{f.title}:</b> {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 8. This lead's touches */}
      <div className="dsec" style={{ marginTop: 12 }}>
        <h2 style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="mail" size={15} /> This lead&rsquo;s touches
        </h2>
        {lead.touches.length === 0 ? (
          <div className="note">
            No touch yet. Generate touch below — grounded in this lead&rsquo;s
            signals.
          </div>
        ) : (
          lead.touches.map((t) => (
            <div
              key={t.draftId}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 11,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <b style={{ fontSize: 12.5 }}>
                  Touch {t.seq} of {t.of}
                  <span
                    className="note"
                    style={{ marginLeft: 6, fontWeight: 400 }}
                  >
                    {t.channel}
                  </span>
                </b>
                <span
                  className={`pill ${t.status === "Sent" ? "green" : ""}`}
                  style={{ fontSize: 10 }}
                >
                  {t.status}
                </span>
              </div>
              {t.subject ? (
                <p
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--ink)",
                    margin: "0 0 4px",
                  }}
                >
                  {t.subject}
                </p>
              ) : null}
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                }}
              >
                {t.body}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ContactsStrip({ lead }: { lead: LeadDetail }) {
  if (!lead.contactsEnriched) {
    return (
      <div className="dcontacts">
        <span className="dcontact-ghost">Contacts not enriched yet</span>
      </div>
    );
  }
  return (
    <div className="dcontacts">
      <span className="dcontact">
        <span className="ci" aria-hidden="true">
          <Icon name="phone" size={13} />
        </span>
        {lead.phones.length ? (
          <>
            <ContactLinks contacts={lead.phones} />
            {/* WP6-13 · per-field bad-data report → hide + auto-refund. */}
            <ReportWrongButton
              businessId={lead.businessId}
              reason="wrong_number"
              value={lead.phones[0].value}
            />
          </>
        ) : (
          <span className="note">—</span>
        )}
      </span>
      <span className="dcontact">
        <span className="ci" aria-hidden="true">
          <Icon name="mail" size={13} />
        </span>
        {lead.emails.length ? (
          <>
            <ContactLinks contacts={lead.emails} />
            <ReportWrongButton
              businessId={lead.businessId}
              reason="wrong_email"
              value={lead.emails[0].value}
            />
          </>
        ) : (
          <span className="note">—</span>
        )}
      </span>
      <span className="dcontact">
        <span className="ci" aria-hidden="true">
          <Icon name="link" size={13} />
        </span>
        {lead.socials.length ? (
          <ContactLinks contacts={lead.socials} external />
        ) : (
          <span className="note">—</span>
        )}
      </span>
    </div>
  );
}

/**
 * WP6-13 / WP7-3 · a compact "report wrong" affordance. Flags the datum as
 * wrong → hides it from every shared artifact (dispute-actions). Contact-data
 * reasons ALSO auto-refund the family credit; a `wrong_finding` dispute hides
 * the finding but doesn't refund (findings aren't independently billed).
 * One-shot: disables + shows "Reported" once fired. Agency voice, terse.
 */
function ReportWrongButton({
  businessId,
  reason,
  value,
  signalKey,
  label = "report wrong",
  ariaLabel = "Report wrong data",
}: {
  businessId: string;
  reason:
    | "wrong_number"
    | "wrong_email"
    | "site_changed"
    | "closed"
    | "wrong_finding";
  value?: string;
  /** The disputed finding's signalKey (required when reason === wrong_finding). */
  signalKey?: string;
  /** Visible link text — differs for a finding ("dispute this"). */
  label?: string;
  ariaLabel?: string;
}) {
  const [reported, setReported] = useState(false);
  const [pending, startTransition] = useTransition();

  if (reported) {
    return (
      <span className="note" style={{ fontSize: 10, marginLeft: 4 }}>
        Reported ✓
      </span>
    );
  }
  const title =
    reason === "wrong_finding"
      ? "Dispute this finding — we'll hide it from your leads and exports"
      : "Report this data as wrong — we'll hide it and refund the credit";
  return (
    <button
      type="button"
      className="clink"
      style={{
        fontSize: 10,
        marginLeft: 4,
        opacity: 0.6,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
      disabled={pending}
      title={title}
      aria-label={ariaLabel}
      onClick={() =>
        startTransition(async () => {
          const r = await reportWrongDataAction({
            businessId,
            reason,
            value,
            signalKey,
          });
          if (r.status === "ok") {
            setReported(true);
            showToast(
              r.refunded > 0
                ? `Reported · ${r.refunded} credit refunded`
                : "Reported — thanks",
            );
          } else {
            showToast("Couldn't report that — try again", "error");
          }
        })
      }
    >
      {label}
    </button>
  );
}

function ContactLinks({
  contacts,
  external,
}: {
  contacts: { value: string; href: string }[];
  external?: boolean;
}) {
  // Render EVERY contact as its own clickable link (was: first + a hover-only
  // "+N" that hid phones/emails 2..N even in the detail card). The agency paid
  // to reveal these — show them all, each dialable/mailable.
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px" }}>
      {contacts.map((c, i) => (
        <a
          key={`${c.href}-${i}`}
          className="clink"
          href={c.href}
          title={c.value}
          {...(external
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
        >
          {c.value}
        </a>
      ))}
    </span>
  );
}

// ── Research signal verdicts (the chosen signals + honest per-lead result) ────

/**
 * The research's signals, each with its honest verdict for this lead (P3):
 *   - fired   · green dot  · this signal matched (a real qualifier)
 *   - didn't  · neutral    · evaluated, did not fire
 *   - not yet · amber dot  · not computable — the backing data isn't enriched
 *     (shown as "enrich to unlock", never a fake match).
 * Sorted fired → not-computable → didn't so the strongest qualifiers lead.
 */
function SignalVerdicts({ verdicts }: { verdicts: LeadSignalVerdict[] }) {
  const rank = (m: boolean | null): number =>
    m === true ? 0 : m === null ? 1 : 2;
  const ordered = [...verdicts].sort(
    (a, b) => rank(a.matched) - rank(b.matched),
  );
  const firedCount = verdicts.filter((v) => v.matched === true).length;
  const pendingCount = verdicts.filter((v) => v.matched === null).length;

  return (
    <div className="sigverdicts" style={{ margin: "0 0 12px" }}>
      <div className="note" style={{ margin: "0 0 8px" }}>
        {firedCount} of {verdicts.length} of your signals fired
        {pendingCount > 0
          ? ` · ${pendingCount} need${pendingCount === 1 ? "s" : ""} enrichment`
          : ""}
      </div>
      {ordered.map((v) => (
        <SignalVerdictRow key={v.key} verdict={v} />
      ))}
    </div>
  );
}

function SignalVerdictRow({ verdict }: { verdict: LeadSignalVerdict }) {
  const { tone, label } =
    verdict.matched === true
      ? { tone: "green" as const, label: "Fired" }
      : verdict.matched === null
        ? { tone: "amber" as const, label: "Enrich to unlock" }
        : { tone: "" as const, label: "Didn’t fire" };
  return (
    <div
      className="sig"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 0",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          className="name"
          style={{ display: "block" }}
          title={verdict.means}
        >
          {verdict.title}
        </span>
      </span>
      <span className={`pill ${tone} dot`.trim()} style={{ flexShrink: 0 }}>
        {label}
      </span>
    </div>
  );
}

// ── Fired composite signal (collapsible) ─────────────────────────────────────

function FiredSignal({
  signal,
  bands,
  businessId,
}: {
  signal: LeadFiredSignal;
  bands?: Partial<Record<string, CellBand>>;
  /** Owning business — threads the per-finding "dispute this" affordance (WP7-3). */
  businessId?: string;
}) {
  const [open, setOpen] = useState(false);
  // WP7-10 · the toggle is a REAL <button> in the header (not role="button" on
  // the whole card) so the collapsible body — which now carries its own
  // interactive "dispute this finding" button — is a SIBLING, not nested inside
  // an interactive control (axe `nested-interactive`). `aria-controls` +
  // `aria-expanded` announce the disclosure relationship.
  const bodyId = `fsig-body-${signal.key}`;
  return (
    <div className={`fsig${open ? " open" : ""}`}>
      <button
        type="button"
        className="fsig-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fsig-name">{signal.title}</span>
        <ConfidencePill confidence={signal.confidence} />
        <span className="fsig-chv" aria-hidden="true">
          ▾
        </span>
      </button>
      {signal.summary ? <div className="fsig-sum">{signal.summary}</div> : null}
      {open ? (
        <div className="fsig-body" id={bodyId}>
          {signal.pitch ? (
            <div className="fsig-pitch">{signal.pitch}</div>
          ) : null}
          {signal.evidence.length ? (
            <div className="fsig-ev">
              <div
                className="elabel"
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                What we found{" "}
                {/* WP4-16 · vs-cell explainer — green=better/red=worse. */}
                <InfoTip
                  text={VS_CELL_EXPLAINER}
                  triggerLabel="What the green/red values mean"
                />
              </div>
              {signal.evidence.map((ev, i) => (
                <EvidenceRow key={i} row={ev} bands={bands} />
              ))}
            </div>
          ) : null}
          {/* WP7-3 · per-claim "dispute this" — a disputed finding is hidden
              from every shared artifact (drawer / one-pager / share page / CSV).
              A trust deposit: the evidence Tom pitches is his to correct. */}
          {businessId ? (
            <div
              className="note"
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
              }}
            >
              Not right for this lead?
              <ReportWrongButton
                businessId={businessId}
                reason="wrong_finding"
                signalKey={signal.key}
                label="dispute this finding"
                ariaLabel={`Dispute finding: ${signal.title}`}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A 3-dot confidence pill matching the prototype's .conf structure. */
function ConfidencePill({ confidence }: { confidence: string }) {
  const level = confidence.toLowerCase();
  const dots = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const tone = level === "high" ? "green" : level === "medium" ? "amber" : "";
  return (
    <span
      className={`conf ${tone}`.trim()}
      title={`Confidence: ${confidence}`}
      aria-label={`Confidence: ${confidence}`}
    >
      {[0, 1, 2].map((i) => (
        <i key={i} className={i < dots ? "on" : undefined} aria-hidden="true" />
      ))}
    </span>
  );
}

function EvidenceRow({
  row,
  bands,
}: {
  row: LeadEvidenceRow;
  bands?: Partial<Record<string, CellBand>>;
}) {
  // WP5-11 · when the row carries a structured metric AND the workbench has a
  // band for it, render the value ON the cell distribution (typical band + p90
  // leaders tick + marker) — proof that screenshots into a pitch deck. Text
  // form stays the graceful fallback (no metric / cohort too small for bands).
  const band = row.metric ? bands?.[row.metric.bandKey] : undefined;
  if (row.metric && band) {
    return (
      <div className="sig">
        <div className="row">
          <span className="name">{row.label}</span>
        </div>
        <div style={{ margin: "4px 0 6px" }}>
          <VsCellBar
            value={row.metric.value}
            p10={band.p10}
            p25={band.p25}
            p50={band.p50}
            p75={band.p75}
            p90={band.p90}
            percentile={percentileFromBand(row.metric.value, band)}
            unit={row.metric.unit ?? ""}
          />
        </div>
      </div>
    );
  }

  const toneColor =
    row.tone === "g"
      ? "var(--green)"
      : row.tone === "a"
        ? "var(--amber)"
        : row.tone === "r"
          ? "var(--red)"
          : undefined;
  return (
    <div className="sig">
      <div className="row">
        <span className="name">{row.label}</span>
        <span
          className="val"
          style={toneColor ? { color: toneColor } : undefined}
        >
          {row.value}
        </span>
      </div>
    </div>
  );
}

// ── Data-domain accordion (real or ghost) ────────────────────────────────────

function DomainAccordion({
  block,
  bands,
  businessId,
}: {
  block: LeadDomainBlock;
  bands?: Partial<Record<string, CellBand>>;
  /** The open lead — the ghost card's enrich CTA scopes the sheet to it. */
  businessId: string;
}) {
  const [open, setOpen] = useState(false);

  if (!block.enriched) {
    const enrichments = enrichTypesForDomainKey(block.key);
    return (
      <div className="dacc ghost">
        <div className="ghead">
          <span className="dacc-ic" aria-hidden="true">
            {block.icon}
          </span>
          <span className="dacc-title">{block.title}</span>
          <span className="dacc-ghost-tag">Not enriched</span>
        </div>
        <div className="dacc-ghost-note">{block.ghostNote}</div>
        {/* WP5-3 · the ghost tag's promise made real: opens the in-workbench
            enrich sheet pre-seeded with this domain's families, scoped to
            this lead. */}
        {enrichments.length > 0 ? (
          <button
            type="button"
            className="btn sm"
            style={{ margin: "6px 12px 10px" }}
            onClick={() =>
              openEnrichSheet({
                enrichments,
                scope: { selectedBusinessIds: [businessId] },
              })
            }
          >
            Enrich to unlock →
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`dacc${open ? " open" : ""}`}>
      <button
        type="button"
        className="dacc-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dacc-ic" aria-hidden="true">
          {block.icon}
        </span>
        <span className="dacc-title">{block.title}</span>
        {block.summary ? (
          <span className="dacc-sum" title={block.summary}>
            {block.summary}
          </span>
        ) : null}
        <span className="dacc-chv" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="dacc-body">
          {block.rows.length ? (
            block.rows.map((r, i) => (
              <EvidenceRow key={i} row={r} bands={bands} />
            ))
          ) : (
            <p className="note" style={{ margin: "6px 0 0" }}>
              No detail rows.
            </p>
          )}
          {/* WP6-9 · evidence-honesty provenance — where this block's data came
              from + when it was retrieved, so every claim is auditable. */}
          {block.source ? (
            <p className="note" style={{ margin: "8px 0 0", fontSize: 11 }}>
              {block.source}
              {block.asOf ? ` · as of ${block.asOf}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function DrawerSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="dsec">
        <div className="dglance">
          <div
            className="gauge"
            style={{ "--pct": "0", "--gc": "var(--line-2)" } as CSSProperties}
          >
            <div className="gv">
              <b style={{ color: "var(--faint)" }}>·</b>
              <span>match</span>
            </div>
          </div>
          <div className="dgcol">
            <div className="dfacts">
              {Array.from({ length: 6 }).map((_, i) => (
                <div className="dfact" key={i}>
                  <div className="fk">&nbsp;</div>
                  <div
                    className="fv"
                    style={{
                      height: 12,
                      background: "var(--surface-2)",
                      borderRadius: 4,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="dacc"
          style={{ height: 42, background: "var(--surface-2)" }}
        />
      ))}
    </div>
  );
}

function errorMessage(status: GetLeadDetailResult["status"]): string {
  switch (status) {
    case "not_found":
      return "This lead isn't in your workspace.";
    case "forbidden":
      return "You don't have access to this lead.";
    case "unauthorized":
      return "Sign in to view this lead.";
    default:
      return "Couldn't load this lead. Try again.";
  }
}
