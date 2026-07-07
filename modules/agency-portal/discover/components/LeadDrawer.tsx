"use client";

// LeadDrawer · the rich right-side lead-detail drawer for the agency leads
// workbench — URL-driven (?lead=<businessId>).
//
// Opens when `businessId` is non-null; lazily fetches the agency-scoped detail
// payload via getLeadDetailAction (loading skeleton meanwhile; the LAST payload
// stays on screen while a new one refetches so prev/next feels instant).
//
// 2026-07 restructure (style audit): the drawer speaks the portal's flat-panel
// overlay language — a white surface with full-bleed 1px-divided sections
// (matching the EnrichMoreSheet), headed by the shared `.eyebrow` token.
// Section order puts the money first: Why-qualifies → Contacts → Data (enriched
// domain blocks render OPEN AND FLAT, non-enriched compress to one
// enrich-sheet-vocabulary line each) → Outreach. The match gauge and the
// duplicated facts grid are gone (the header pills carry identity + match
// once). Data-domain blocks still render off the honest run state (enriched /
// empty / failed / running / not_run — the shared loader's TypeState), never
// data presence.
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
  type ReactNode,
} from "react";

import { Icon, type IconName } from "@/components/agency/Icon";
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
  LeadContact,
  LeadDetail,
  LeadDomainBlock,
  LeadEvidenceRow,
  LeadFiredSignal,
  LeadRival,
  LeadSignalVerdict,
} from "../lead-detail";
import type { CellBand } from "../leads-workbench";
import { percentileFromBand } from "../visual-helpers";
import { VsCellBar } from "./VsCellBar";
import {
  enrichTypesForDomainKey,
  openEnrichSheet,
  subscribeLeadDetailChanged,
} from "../enrich-sheet-bus";

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
  // LD-1 · bumped by a 'lead-detail-changed' bus event (a touch was generated,
  // or a run enriched this lead) to force a re-fetch for the SAME businessId, so
  // "This lead's touches" stops saying "No touch yet" after a generation.
  const [refreshTick, setRefreshTick] = useState(0);

  // AUDIT U22 · resizable drawer (persisted). A left-edge handle drags the width
  // so a power user can widen the detail view; ⌘/arrow prev-next already exists.
  const [drawerWidth, setDrawerWidth] = useState<number | null>(null);
  useEffect(() => {
    // Deferred read (setTimeout 0) to satisfy react-hooks/set-state-in-effect.
    const t = window.setTimeout(() => {
      const saved = Number(window.localStorage.getItem("wb-drawer-width"));
      if (saved >= 360 && saved <= 900) setDrawerWidth(saved);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  function onResizeStart(startX: number) {
    const startW = drawerRef.current?.getBoundingClientRect().width ?? 480;
    function onMove(ev: PointerEvent) {
      // Drawer is docked RIGHT → dragging the left edge leftward widens it.
      const next = Math.min(900, Math.max(360, startW + (startX - ev.clientX)));
      setDrawerWidth(next);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const w = drawerRef.current?.getBoundingClientRect().width;
      if (w)
        window.localStorage.setItem("wb-drawer-width", String(Math.round(w)));
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

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
  }, [businessId, discoveryId, refreshTick]);

  // LD-1 · when this lead's server-side detail changes (a touch was generated,
  // or a background run enriched it), re-fetch in place instead of showing stale
  // "No touch yet". setState is inside the async event callback, not the effect
  // body, so react-hooks/set-state-in-effect is satisfied.
  useEffect(() => {
    if (businessId == null) return;
    return subscribeLeadDetailChanged(({ businessId: changed }) => {
      if (changed === businessId) setRefreshTick((t) => t + 1);
    });
  }, [businessId]);

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
        style={drawerWidth ? { width: `${drawerWidth}px` } : undefined}
      >
        {/* AUDIT U22 · left-edge resize handle (drag to widen). */}
        <div
          className="drawer-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize drawer"
          onPointerDown={(e) => {
            e.preventDefault();
            onResizeStart(e.clientX);
          }}
        />
        {/* ── Header ── */}
        <div className="dhead">
          <div className="nav-arrows">
            {/* WP4-8 · kbd hints in the tooltip — ↑/↓ walk prev/next lead. */}
            <button
              type="button"
              className="ab"
              onClick={() => navTo(-1)}
              aria-label="Previous lead (press up arrow)"
              data-tip="Previous lead · ↑"
              disabled={orderedIds.length < 2}
            >
              <Icon name="arrow-up" size={15} />
            </button>
            <button
              type="button"
              className="ab"
              onClick={() => navTo(1)}
              aria-label="Next lead (press down arrow)"
              data-tip="Next lead · ↓"
              disabled={orderedIds.length < 2}
            >
              <Icon name="arrow-down" size={15} />
            </button>
          </div>
          {lead?.logoUrl ? <HeaderLogo src={lead.logoUrl} /> : null}
          <div className="dhead-main">
            <h1 id="leadDrawerName" data-tip={lead?.name}>
              {lead?.name ?? (isLoading ? "Loading…" : "Lead")}
            </h1>
            <p className="note">
              {lead ? headerSub(lead) : isError ? errorText : " "}
            </p>
            {lead ? (
              <div className="dhead-pills">
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
              <p className="note m0">{errorText ?? "Couldn't load."}</p>
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
            <span className="note dfoot-note">
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
        // LD-2 · from the drawer, refresh the lead's touches in place on success
        // rather than navigating away to the Touchpoints tab.
        stayInPlace
      />
    </>
  );
}

// ── Header helpers ───────────────────────────────────────────────────────────

/**
 * The Business.logoUrl header avatar. Plain <img> on purpose: logo hosts vary
 * (Google-hosted CDNs), so the next/image proxy would 400 on any host outside
 * `images.remotePatterns` — and a 36px avatar gains nothing from optimization.
 * Graceful absent: a load error hides the element entirely (no broken box).
 */
function HeaderLogo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="davatar"
      src={src}
      alt=""
      width={36}
      height={36}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function headerSub(lead: LeadDetail): string {
  const bits: string[] = [];
  if (lead.addressLine && lead.addressLine !== "—") bits.push(lead.addressLine);
  if (lead.category) bits.push(lead.category);
  // Tabular, emoji-free: "5.0 · 113 reviews" (style audit — no ⭐ in chrome).
  const rev =
    lead.rating != null
      ? `${lead.rating.toFixed(1)}${lead.reviewCount != null ? ` · ${lead.reviewCount.toLocaleString()} reviews` : ""}`
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
      {/* The gauge is gone — this pill is the ONE match surface. The tooltip
          carries the measured-vs-derived framing the gauge used to imply. */}
      <span
        className="pill indigo"
        data-tip={
          lead.matchFromSignals
            ? "Measured — your research's signals evaluated against this lead"
            : "Estimated from pain-signal count — enrich to get a measured match"
        }
      >
        Match {lead.match}%
      </span>
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
  const enriched = lead.domains.filter((d) => d.state === "enriched");
  const notEnriched = lead.domains.filter((d) => d.state !== "enriched");

  return (
    <div className={dimmed ? "ddim" : undefined} aria-busy={dimmed}>
      {/* 1. Why this lead qualifies — Tom's money, first. Expert findings
          (compliance / ADA callouts) merge here: they are findings too. */}
      <div className="dsec">
        <div className="eyebrow">Why this lead qualifies</div>

        {/* The research's chosen signals, with honest per-lead verdicts (P3):
            fired / didn't / not computable yet ("enrich to unlock"). */}
        {lead.signalVerdicts.length > 0 ? (
          <SignalVerdicts verdicts={lead.signalVerdicts} />
        ) : null}

        {lead.firedSignals.length === 0 ? (
          lead.signalVerdicts.length === 0 ? (
            <p className="note m0">
              No composite signals fired — this lead matched on raw qualifiers
              only. See the Data section below for the raw evidence.
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
            <div className="microlabel">Other angles to pitch</div>
            <div className="dchips">
              {lead.angles.map((a, i) => (
                <span
                  key={`${a.label}-${i}`}
                  className={`ppchip ${a.group}`}
                  data-tip={a.title}
                >
                  {a.label}
                </span>
              ))}
            </div>
          </>
        ) : null}
        {lead.expertFindings.map((f) => (
          <div key={f.key} className={`callout ${f.tone}`}>
            <Icon name="warning" size={14} className="cicon" />
            <p className="m0">
              <b>{f.title}:</b> {f.body}
            </p>
          </div>
        ))}
        {/* WP6-9 · "we only cite what we verified" — surfaces when touch
            generation pruned a claim it couldn't confirm (whyJson.droppedTokens).
            Auditable evidence as a visible trust feature. */}
        {lead.verifiedNote ? (
          <p className="note vnote" role="note">
            {lead.verifiedNote}
          </p>
        ) : null}
      </div>

      {/* 2. Contacts — the outreach action, its own flat section. */}
      <div className="dsec">
        <div className="eyebrow">Contacts</div>
        <ContactsStrip lead={lead} />
      </div>

      {/* 3. Data — one headed section. Enriched domains render OPEN AND FLAT
          (the paid evidence is never behind a click); the always-free Profile
          and Nearby rivals listing blocks follow; non-enriched domains compress
          to ONE enrich-sheet-vocabulary line each (honest TypeState intact:
          not_run / empty / failed / running each renders distinctly). */}
      <div className="dsec">
        <div className="eyebrow">
          Data · {enriched.length} of {lead.domains.length} enriched
          {/* WP4-16 · toned values across ALL data rows are covered here, not
              just fired-signal evidence. */}
          <InfoTip
            text={VS_CELL_EXPLAINER}
            triggerLabel="What the green/red values mean"
          />
        </div>
        {enriched.map((d) => (
          <DataBlock key={d.key} block={d} bands={bands} />
        ))}
        <ProfileBlock lead={lead} bands={bands} />
        {lead.rivals.length > 0 ? <RivalsBlock rivals={lead.rivals} /> : null}
        {notEnriched.map((d) => (
          <DataGhostRow
            key={d.key}
            block={d}
            bands={bands}
            businessId={lead.businessId}
          />
        ))}
      </div>

      {/* 4. This lead's touches */}
      <div className="dsec">
        <div className="eyebrow">Outreach · touches</div>
        {lead.touches.length === 0 ? (
          <div className="note">
            No touch yet. Generate touch below — grounded in this lead&rsquo;s
            signals.
          </div>
        ) : (
          lead.touches.map((t) => (
            <div key={t.draftId} className="dtouch">
              <div className="dtouch-head">
                <b>
                  Touch {t.seq} of {t.of}
                  <span className="note dtouch-ch">{t.channel}</span>
                </b>
                <span className={`pill ${t.status === "Sent" ? "green" : ""}`}>
                  {t.status}
                </span>
              </div>
              {t.subject ? <p className="dtouch-subject">{t.subject}</p> : null}
              <p className="dtouch-body">{t.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Issue 5 · the contacts strip, restructured into stacked per-channel groups
 * (Phones / Emails / Socials). Each group is an icon-column grid — the channel
 * icon top-aligned in a fixed 18px column, values in a wrapping flex cell so
 * wrapped lines align to one left edge. Each value + its role/primary tags +
 * report affordance is ONE non-breaking unit; groups cap at 4 values with a
 * real "+N more" toggle.
 *
 * Truth unification (2026-07-06): renders off the honest `contactsState` (the
 * shared loader's CONTACTS run state), never data presence. The discovery GBP
 * phone/email render as LISTING facts ("From the Google listing") in every
 * state — they are free discovery data, not proof the contact scan ran.
 */
function ContactsStrip({ lead }: { lead: LeadDetail }) {
  const listing =
    lead.listingContacts.length > 0 ? (
      <div>
        <div className="microlabel">From the Google listing</div>
        <div className="dcontact-listing">
          {lead.listingContacts.map((c) => (
            <a className="clink" key={c.href} href={c.href}>
              {c.value}
            </a>
          ))}
        </div>
      </div>
    ) : null;

  if (lead.contactsState !== "enriched") {
    const note =
      lead.contactsState === "empty"
        ? "Contacts scanned · none found"
        : lead.contactsState === "failed"
          ? "Contact scan failed on the last run"
          : lead.contactsState === "running"
            ? "Enriching contacts…"
            : "Contacts not enriched yet";
    const actionable =
      lead.contactsState === "not_run" || lead.contactsState === "failed";
    return (
      <div className="dcontacts">
        {listing}
        <span className="dcontact-ghost">{note}</span>
        {actionable ? (
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              openEnrichSheet({
                enrichments: ["contacts"],
                preselect: true,
                scope: { selectedBusinessIds: [lead.businessId] },
              })
            }
          >
            {lead.contactsState === "failed"
              ? "Retry contacts →"
              : "Enrich contacts →"}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="dcontacts">
      {listing}
      <ContactGroup
        icon="phone"
        groupLabel="Phone numbers"
        contacts={lead.phones}
        businessId={lead.businessId}
        reportReason="wrong_number"
      />
      <ContactGroup
        icon="mail"
        groupLabel="Email addresses"
        contacts={lead.emails}
        businessId={lead.businessId}
        reportReason="wrong_email"
      />
      {/* E6 · socials — each stored social channel (Instagram / Facebook /
          TikTok / YouTube / X / LinkedIn / Yelp) as its own linked handle.
          Renders nothing when there are none — no empty "—" noise. */}
      {lead.socials.length > 0 ? (
        <ContactGroup
          icon="link"
          groupLabel="Social profiles"
          contacts={lead.socials}
          social
        />
      ) : null}
    </div>
  );
}

/** Per-group cap before the "+N more" toggle (issue 5). */
const CONTACT_GROUP_CAP = 4;

/**
 * Issue 5 · one channel group (phones / emails / socials): fixed icon column +
 * wrapping value cell. Values render primary-first (the loader orders by
 * isPrimary desc) with a mono-caps "primary" tag and a role prefix when known.
 * WP6-13 · the per-value ReportWrongButton lives INSIDE each unit — reporting
 * the 3rd email disputes the 3rd email, not [0] (and values 2..N are
 * reportable at all now).
 */
function ContactGroup({
  icon,
  groupLabel,
  contacts,
  businessId,
  reportReason,
  social,
}: {
  icon: IconName;
  groupLabel: string;
  contacts: LeadContact[];
  businessId?: string;
  reportReason?: "wrong_number" | "wrong_email";
  /** Social group: external links, platform prefix, no role tags. */
  social?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflow = contacts.length - CONTACT_GROUP_CAP;
  const shown =
    expanded || overflow <= 0 ? contacts : contacts.slice(0, CONTACT_GROUP_CAP);
  return (
    <div className="dcontact-group" aria-label={groupLabel}>
      <span className="ci" aria-hidden="true">
        <Icon name={icon} size={13} />
      </span>
      <span className="dcontact-vals">
        {contacts.length === 0 ? (
          <span className="note">—</span>
        ) : (
          shown.map((c, i) => (
            <span className="cunit" key={`${c.href}-${i}`}>
              {!social && c.role ? (
                <span className="cctag">{c.role}</span>
              ) : null}
              <a
                className="clink"
                href={c.href}
                data-tip={
                  social
                    ? c.href
                    : c.verified
                      ? `${c.value} · verified`
                      : c.value
                }
                {...(social
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {social && c.channel ? (
                  <span className="cplat">
                    {socialPlatformLabel(c.channel)}
                  </span>
                ) : null}
                {c.value}
              </a>
              {c.primary ? (
                <span className="cctag primary">primary</span>
              ) : null}
              {/* Per-value provenance ("tel: link · 95%") — trust before a
                  cold dial. Socials skip it (the URL is its own provenance). */}
              {!social && c.provenance ? (
                <span
                  className="cctag prov"
                  data-tip={`Found via ${c.provenance.replace(" · ", " · confidence ")}`}
                >
                  {c.provenance}
                </span>
              ) : null}
              {businessId && reportReason ? (
                <ReportWrongButton
                  businessId={businessId}
                  reason={reportReason}
                  value={c.value}
                />
              ) : null}
            </span>
          ))
        )}
        {overflow > 0 ? (
          <button
            type="button"
            className="clink cmore"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "less" : `+${overflow} more`}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** E6 · short platform label for a social ContactChannel enum value. */
function socialPlatformLabel(channel?: string): string {
  switch (channel) {
    case "INSTAGRAM":
      return "IG";
    case "FACEBOOK":
      return "FB";
    case "TIKTOK":
      return "TT";
    case "YOUTUBE":
      return "YT";
    case "LINKEDIN":
      return "LI";
    case "X":
      return "X";
    case "YELP":
      return "Yelp";
    default:
      return "";
  }
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
    return <span className="note report-done">Reported ✓</span>;
  }
  const title =
    reason === "wrong_finding"
      ? "Dispute this finding — we'll hide it from your leads and exports"
      : "Report this data as wrong — we'll hide it and refund the credit";
  return (
    <button
      type="button"
      className="clink report-link"
      disabled={pending}
      data-tip={title}
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
                ? `Reported · ${r.refunded} credit${r.refunded === 1 ? "" : "s"} refunded`
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
    <div className="sigverdicts">
      <div className="note">
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
  // Wave-3 honesty · a null verdict whose backing researches already RAN is
  // "Scanned · no data" (calm, never a re-pay invite); only a truly-unscanned
  // signal offers "Enrich to unlock".
  const { tone, label } =
    verdict.matched === true
      ? { tone: "green" as const, label: "Fired" }
      : verdict.matched === null
        ? verdict.scanned
          ? { tone: "" as const, label: "Scanned · no data" }
          : { tone: "amber" as const, label: "Enrich to unlock" }
        : { tone: "" as const, label: "Didn’t fire" };
  // Layout lives in `.sigverdicts .sig` (agency-portal.css) — the class existed
  // in markup with no stylesheet entry, so every row carried inline overrides.
  return (
    <div className="sig">
      <span className="name" data-tip={verdict.means}>
        {verdict.title}
      </span>
      <span className={`pill ${tone} dot`.trim()}>{label}</span>
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
              <div className="microlabel">
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
            <div className="note fsig-dispute">
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
      data-tip={`Confidence: ${confidence}`}
      aria-label={`Confidence: ${confidence}`}
    >
      {[0, 1, 2].map((i) => (
        <i key={i} className={i < dots ? "on" : undefined} aria-hidden="true" />
      ))}
    </span>
  );
}

/**
 * AI-brief readability (owner 2026-07-06) · render `**bold**` markdown emphasis
 * inside AI-written text. The ai-research pipeline now bolds the single most
 * important phrase per sentence; older rows without markers render unchanged.
 * Pure text splitting — no HTML ever passes through (React escapes the rest).
 */
function renderInlineBold(text: string): ReactNode {
  if (!text.includes("**")) return text;
  const parts = text.split(/\*\*(.+?)\*\*/g);
  // Odd indices are the captured bold spans. A stray unpaired "**" (e.g. the
  // storage clamp truncated mid-marker) is stripped, never shown literally.
  return parts.map((p, i) =>
    i % 2 === 1 ? <b key={i}>{p}</b> : p.replaceAll("**", ""),
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
  const rawBand = row.metric ? bands?.[row.metric.bandKey] : undefined;
  // A degenerate band (everyone identical → p90 <= p10) conveys nothing: plotting
  // a marker on it fabricates a misleading "value · typical X · 50th pct" reading
  // (e.g. a lone advertiser in a zero-ad market shows "1 · typical 0 · 50th pct").
  // Fall through to the plain text form instead of a meaningless bar.
  const band = rawBand && rawBand.p90 > rawBand.p10 ? rawBand : undefined;
  if (row.metric && band) {
    return (
      <div className="sig">
        <div className="row">
          <span className="name">{row.label}</span>
        </div>
        <div className="evbar">
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

  // Tones are classes (tg/ta/tr — green/amber/red), not inline colors; the
  // Data-section head's InfoTip explains them once for every toned value.
  const toneClass =
    row.tone === "g"
      ? " tg"
      : row.tone === "a"
        ? " ta"
        : row.tone === "r"
          ? " tr"
          : "";

  // Drawer content pass · a pulled-review quote line: indented quoted text
  // with a mono meta suffix ("5★ · Jul 2 · owner replied").
  if (row.quote) {
    return (
      <div className="dquote">
        <span className="qtext">{row.value}</span>
        <span className="qmeta">{row.label}</span>
      </div>
    );
  }

  // Issue 13 · a prose row (Angle rows — counter labels add nothing): one
  // label-less full-width line under the section head DomainRows prints.
  // `pain` lines (the outreach pain hypotheses) get the amber-rule highlight —
  // the issues must stand out from neutral prose (owner 2026-07-06).
  if (row.prose) {
    return (
      <div className={`sig kv prose${row.pain ? " pain" : ""}`}>
        <p className={`val${toneClass}`}>{renderInlineBold(row.value)}</p>
      </div>
    );
  }

  // Issue 13 · sectioned rows (only the AI brief sets `section`) share ONE
  // fixed 110–130px label column via the `.sig.kv` grid variant — every value
  // starts at the same x. Unsectioned metric pairs keep the classic
  // name-left/val-right flex row. `strong` bolds verdict-style short values.
  return (
    <div className={row.section != null ? "sig kv" : "sig"}>
      <div className="row">
        <span className="name">{row.label}</span>
        <span className={`val${toneClass}`}>
          {row.strong ? <b>{row.value}</b> : renderInlineBold(row.value)}
        </span>
      </div>
    </div>
  );
}

// ── Data-domain blocks (flat when enriched · one honest line otherwise) ──────

/**
 * An ENRICHED domain: an open, flat block — head (icon + title + right-aligned
 * source · as-of provenance) over 3–6 dense rows. No accordion: the paid
 * evidence is never behind a click (style audit, information order).
 */
function DataBlock({
  block,
  bands,
}: {
  block: LeadDomainBlock;
  bands?: Partial<Record<string, CellBand>>;
}) {
  const hasListing = block.listingRows.length > 0;
  return (
    <div className="dblock">
      <div className="dblock-head">
        <span className="bic" aria-hidden="true">
          <Icon name={block.icon} size={14} />
        </span>
        <span className="dblock-title">{block.title}</span>
        {/* WP6-9 · evidence-honesty provenance — where this block's data came
            from + when it was retrieved, so every claim is auditable. */}
        {block.source ? (
          <span className="dblock-src">
            {block.source}
            {block.asOf ? ` · ${block.asOf}` : ""}
          </span>
        ) : null}
      </div>
      {/* E1 · listing facts (Reviews) render first, labelled as the listing,
          then the enrichment rows below. */}
      {hasListing ? (
        <>
          <div className="microlabel">From the Google listing</div>
          {block.listingRows.map((r, i) => (
            <EvidenceRow key={`l-${i}`} row={r} bands={bands} />
          ))}
          {block.rows.length ? (
            <div className="microlabel">From the reviews pull</div>
          ) : null}
        </>
      ) : null}
      <DomainRows rows={block.rows} bands={bands} hasListing={hasListing} />
    </div>
  );
}

/**
 * A NON-ENRICHED domain compressed to ONE line in the enrich-sheet vocabulary
 * (state dot + title + right-aligned state tag / CTA — the same visual code as
 * .enrich-group-row, so state reads identically in both surfaces). The honest
 * TypeState split is intact:
 *   not_run · hollow dot · "Enrich →" CTA (ghostNote in the tooltip)
 *   empty   · green dot  · "Ran · none found" (verified — never a CTA)
 *   failed  · red dot    · "Failed" tag + "Retry →" CTA
 *   running · indigo dot · "enriching…" (paid for — no CTA)
 * Reviews keeps its E1 exception: the free GBP listing facts still render in a
 * compact sub-group under the line, labelled as the listing.
 */
function DataGhostRow({
  block,
  bands,
  businessId,
}: {
  block: LeadDomainBlock;
  bands?: Partial<Record<string, CellBand>>;
  /** The open lead — the enrich CTA scopes the sheet to it. */
  businessId: string;
}) {
  const enrichments = enrichTypesForDomainKey(block.key);
  const hasListing = block.listingRows.length > 0;
  const openSheet = () =>
    openEnrichSheet({
      enrichments,
      // AUDIT D1 · a drawer single-domain CTA → pre-select its enrichment.
      preselect: true,
      scope: { selectedBusinessIds: [businessId] },
    });

  const dotClass =
    block.state === "empty"
      ? "dnr-dot on"
      : block.state === "failed"
        ? "dnr-dot failed"
        : block.state === "running"
          ? "dnr-dot running"
          : "dnr-dot";

  return (
    <>
      <div className="dnr">
        <span className={dotClass} aria-hidden="true" />
        <span className="dnr-title">{block.title}</span>
        {block.state === "empty" ? (
          <span
            className="microlabel dnr-tag"
            data-tip={
              block.emptyNote ?? "Enrichment ran — nothing found for this lead."
            }
          >
            Ran · none found
          </span>
        ) : block.state === "running" ? (
          <span
            className="microlabel dnr-tag"
            data-tip="Scan in progress — results land here when it finishes."
          >
            enriching…
          </span>
        ) : block.state === "failed" ? (
          <>
            <span
              className="microlabel dnr-tag failed"
              data-tip="Enrichment errored on the last run."
            >
              Failed
            </span>
            {enrichments.length > 0 ? (
              <button
                type="button"
                className="dacc-enrich"
                onClick={openSheet}
                aria-label={`Retry ${block.title} enrichment`}
              >
                Retry →
              </button>
            ) : null}
          </>
        ) : enrichments.length > 0 ? (
          // WP5-3 · the CTA's promise made real: opens the in-workbench enrich
          // sheet pre-seeded with this domain's families, scoped to this lead.
          <button
            type="button"
            className="dacc-enrich dnr-cta"
            data-tip={block.ghostNote}
            onClick={openSheet}
            aria-label={`Enrich ${block.title}`}
          >
            Enrich →
          </button>
        ) : (
          <span className="microlabel dnr-tag" data-tip={block.ghostNote}>
            Not enriched
          </span>
        )}
      </div>
      {/* E1 · discovery listing facts — shown even before enrichment ran,
          labelled as the listing (not a review pull). */}
      {hasListing ? (
        <div className="dnr-listing">
          <div className="microlabel">From the Google listing</div>
          {block.listingRows.map((r, i) => (
            <EvidenceRow key={i} row={r} bands={bands} />
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * The always-free GBP Profile block (Data section): photos · claimed · years ·
 * open-days · notable attributes, plus the owner's own GBP description
 * (truncated, expandable) and the direct Maps listing link. Listing-labelled —
 * free discovery data, never proof an enrichment ran.
 */
function ProfileBlock({
  lead,
  bands,
}: {
  lead: LeadDetail;
  bands?: Partial<Record<string, CellBand>>;
}) {
  const p = lead.profile;
  if (p.rows.length === 0 && !p.description && !p.mapsUrl) return null;
  return (
    <div className="dblock">
      <div className="dblock-head">
        <span className="bic" aria-hidden="true">
          <Icon name="pin" size={14} />
        </span>
        <span className="dblock-title">Profile</span>
        <span className="dblock-src">Google listing</span>
      </div>
      {p.rows.map((r, i) => (
        <EvidenceRow key={i} row={r} bands={bands} />
      ))}
      {p.description ? <GbpDescription text={p.description} /> : null}
      {p.mapsUrl ? (
        <a
          className="clink"
          href={p.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Maps listing ↗
        </a>
      ) : null}
    </div>
  );
}

/** GBP description clamp cutoff (chars) before the expand toggle. */
const GBP_DESC_CLAMP = 160;

/** The owner's own GBP pitch — truncated with a real expand/collapse toggle. */
function GbpDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsClamp = text.length > GBP_DESC_CLAMP;
  const shown =
    !needsClamp || expanded
      ? text
      : `${text.slice(0, GBP_DESC_CLAMP - 1).trimEnd()}…`;
  return (
    <div className="ddesc">
      <span className="microlabel">Their own pitch</span>
      {shown}{" "}
      {needsClamp ? (
        <button
          type="button"
          className="clink ddesc-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "less" : "more"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Nearby rivals — Business.peopleAlsoSearch (free discovery data): the
 * competitor set Google's own algorithm surfaces, one dense row each. Powers
 * the "you're losing to Treasure Valley (136 reviews)" pitch at zero cost.
 */
function RivalsBlock({ rivals }: { rivals: LeadRival[] }) {
  return (
    <div className="dblock">
      <div className="dblock-head">
        <span className="bic" aria-hidden="true">
          <Icon name="users" size={14} />
        </span>
        <span className="dblock-title">Nearby rivals</span>
        <span className="dblock-src">People also search</span>
      </div>
      {rivals.map((r, i) => (
        <div className="sig" key={`${r.name}-${i}`}>
          <div className="row">
            <span className="name">{r.name}</span>
            <span className="val">
              {r.rating != null ? `${r.rating.toFixed(1)}★` : "—"}
              {r.reviewCount != null
                ? ` · ${r.reviewCount.toLocaleString()} reviews`
                : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * E3 · renders a block's rows, grouping consecutive rows that share a `section`
 * under a small heading (AI research: Services · Summary · Compliance cues ·
 * Opener angle). Ungrouped rows (every other block) render flat as before.
 * Issue 13 · a segment whose rows carry `chip` renders as one wrapping `.dchips`
 * row (the Services menu) instead of key/value lines; section heads are the
 * shared `.microlabel` token, not a shrunken brand eyebrow.
 */
function DomainRows({
  rows,
  bands,
  hasListing,
}: {
  rows: LeadEvidenceRow[];
  bands?: Partial<Record<string, CellBand>>;
  hasListing: boolean;
}) {
  if (rows.length === 0) {
    return hasListing ? null : <p className="note vnote">No detail rows.</p>;
  }
  // Pure derivation: split into segments of consecutive rows sharing a section.
  const segments: { section: string | null; rows: LeadEvidenceRow[] }[] = [];
  for (const r of rows) {
    const section = r.section ?? null;
    const last = segments[segments.length - 1];
    if (last && last.section === section) last.rows.push(r);
    else segments.push({ section, rows: [r] });
  }
  return (
    <>
      {segments.map((seg, i) => (
        <div key={i}>
          {seg.section != null ? (
            <div className="microlabel">{seg.section}</div>
          ) : null}
          {seg.rows[0].chip ? (
            <div className="dchips">
              {seg.rows.map((r, j) => (
                <span
                  key={`${r.label}-${j}`}
                  // Amber `warn` variant for attention chips (compliance cues);
                  // neutral for plain facts (services menu).
                  className={`ppchip${r.tone === "a" ? " warn" : ""}`}
                  data-tip={r.value && r.value !== "—" ? r.value : undefined}
                >
                  {r.label}
                </span>
              ))}
            </div>
          ) : (
            seg.rows.map((r, j) => (
              <EvidenceRow key={j} row={r} bands={bands} />
            ))
          )}
        </div>
      ))}
    </>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function DrawerSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div className="dsec" key={i}>
          <div className="skl sm" />
          <div className="skl lg" />
          <div className="skl md" />
        </div>
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
