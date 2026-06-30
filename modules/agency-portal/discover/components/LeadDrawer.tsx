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
  type CSSProperties,
} from "react";

import { StatusPill } from "@/modules/agency-portal/components/StatusPill";
import {
  getLeadDetailAction,
  type GetLeadDetailResult,
} from "../lead-detail-actions";
import type {
  LeadDetail,
  LeadDomainBlock,
  LeadEvidenceRow,
  LeadFiredSignal,
} from "../lead-detail";

export interface LeadDrawerProps {
  /** The open lead's businessId, or null when the drawer is closed. */
  businessId: string | null;
  /** The CURRENT visible (filtered + sorted, flattened if grouped) row ids. */
  orderedIds: string[];
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
  orderedIds,
  onClose,
  onNav,
}: LeadDrawerProps) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "none" });
  // The last successfully-loaded lead, kept visible while a sibling refetches.
  const [lastLead, setLastLead] = useState<LeadDetail | null>(null);
  const xBtnRef = useRef<HTMLButtonElement | null>(null);
  // Token guards against an out-of-order resolve when the user clicks fast.
  const reqToken = useRef(0);

  const open = businessId != null;

  // ── Fetch on businessId change (setState only in async callbacks) ──────────
  useEffect(() => {
    if (businessId == null) return;
    const token = ++reqToken.current;
    getLeadDetailAction(businessId)
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
  }, [businessId]);

  // ── Escape closes · focus the close button on open ─────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => xBtnRef.current?.focus(), 60);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

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
        className={`drawer${open ? " show" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leadDrawerName"
        aria-hidden={!open}
      >
        {/* ── Header ── */}
        <div className="dhead">
          <div className="nav-arrows">
            <button
              type="button"
              className="ab"
              onClick={() => navTo(-1)}
              aria-label="Previous lead"
              title="Previous lead"
              disabled={orderedIds.length < 2}
            >
              ↑
            </button>
            <button
              type="button"
              className="ab"
              onClick={() => navTo(1)}
              aria-label="Next lead"
              title="Next lead"
              disabled={orderedIds.length < 2}
            >
              ↓
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
            <DrawerBody lead={lead} dimmed={isLoading} />
          ) : (
            <DrawerSkeleton />
          )}
        </div>

        {/* ── Footer ── */}
        <div className="dfoot">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              // No single-business generate path exists — generateTouchpointsAction
              // is agency-pool/bulk only (see summary). Direct Tom to the tab.
              showToast(
                "Generate touches from the Touchpoints tab — single-lead generation isn't wired yet.",
              );
            }}
          >
            Generate touch
          </button>
        </div>
      </aside>
      <ToastHost />
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

function DrawerBody({ lead, dimmed }: { lead: LeadDetail; dimmed: boolean }) {
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
        {lead.firedSignals.length === 0 ? (
          <p className="note" style={{ margin: 0 }}>
            No composite signals fired — this lead matched on raw qualifiers
            only. Open the data sections below for the raw evidence.
          </p>
        ) : (
          lead.firedSignals.map((s) => <FiredSignal key={s.key} signal={s} />)
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
      </div>

      {/* 6. Data-domain accordions */}
      {lead.domains.map((d) => (
        <DomainAccordion key={d.key} block={d} />
      ))}

      {/* 7. Expert findings */}
      {lead.expertFindings.length > 0 ? (
        <div className="dacc open" style={{ marginBottom: 8 }}>
          <div className="dacc-head" style={{ cursor: "default" }}>
            <span className="dacc-ic" aria-hidden="true">
              🎓
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
                <span aria-hidden="true">⚠️</span>
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
        <h2>
          <span aria-hidden="true">✉️</span> This lead&rsquo;s touches
        </h2>
        {lead.touches.length === 0 ? (
          <div className="note">
            No touch yet. Generate from the Touchpoints tab.
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
          📞
        </span>
        {lead.phones.length ? (
          <ContactLinks contacts={lead.phones} />
        ) : (
          <span className="note">—</span>
        )}
      </span>
      <span className="dcontact">
        <span className="ci" aria-hidden="true">
          ✉️
        </span>
        {lead.emails.length ? (
          <ContactLinks contacts={lead.emails} />
        ) : (
          <span className="note">—</span>
        )}
      </span>
      <span className="dcontact">
        <span className="ci" aria-hidden="true">
          🔗
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

function ContactLinks({
  contacts,
  external,
}: {
  contacts: { value: string; href: string }[];
  external?: boolean;
}) {
  const first = contacts[0];
  const rest = contacts.slice(1);
  return (
    <>
      <a
        className="clink"
        href={first.href}
        title={first.value}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {first.value}
      </a>
      {rest.length ? (
        <span
          className="cmore"
          title={contacts.map((c) => c.value).join(" · ")}
        >
          +{rest.length}
        </span>
      ) : null}
    </>
  );
}

// ── Fired composite signal (collapsible) ─────────────────────────────────────

function FiredSignal({ signal }: { signal: LeadFiredSignal }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`fsig${open ? " open" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((o) => !o);
        }
      }}
    >
      <div className="fsig-head">
        <span className="fsig-name">{signal.title}</span>
        <ConfidencePill confidence={signal.confidence} />
        <span className="fsig-chv" aria-hidden="true">
          ▾
        </span>
      </div>
      {signal.summary ? <div className="fsig-sum">{signal.summary}</div> : null}
      {open ? (
        <div className="fsig-body" onClick={(e) => e.stopPropagation()}>
          {signal.pitch ? (
            <div className="fsig-pitch">{signal.pitch}</div>
          ) : null}
          {signal.evidence.length ? (
            <div className="fsig-ev">
              <div className="elabel">What we found</div>
              {signal.evidence.map((ev, i) => (
                <EvidenceRow key={i} row={ev} />
              ))}
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

function EvidenceRow({ row }: { row: LeadEvidenceRow }) {
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

function DomainAccordion({ block }: { block: LeadDomainBlock }) {
  const [open, setOpen] = useState(false);

  if (!block.enriched) {
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
            block.rows.map((r, i) => <EvidenceRow key={i} row={r} />)
          ) : (
            <p className="note" style={{ margin: "6px 0 0" }}>
              No detail rows.
            </p>
          )}
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

// ── Minimal toast (self-contained · matches the .toast prototype class) ───────
// A module-scoped event so the host inside the drawer can render it without
// threading a callback through every child.

const TOAST_EVENT = "mapsly:lead-drawer-toast";

function showToast(message: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setMsg(detail);
      window.setTimeout(() => setMsg(null), 3200);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);
  if (!msg) return null;
  return (
    <div className="toast show" role="status" aria-live="polite">
      {msg}
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
