"use client";

// LeadDrawer · the rich right-side lead-detail drawer for the agency leads
// workbench — URL-driven (?lead=<businessId>).
//
// Opens when `businessId` is non-null; lazily fetches the agency-scoped detail
// payload via getLeadDetailAction (loading skeleton meanwhile; the LAST payload
// stays on screen while a new one refetches so prev/next feels instant).
//
// 2026-07-06 redesign · d7 SPLIT-RAIL (owner pick from
// docs/drawer-designs-2026-07-06.html): identity + nav collapse into a 44px
// icon RAIL (close · prev/next · logo · section anchors that scroll the body,
// with a scroll-spy active state) so 100% of the content column is data,
// served as flat 1px-divided BANDS. Small pills; contacts are deduped and
// phone display is ONE format ("(208) 965-3777" — lead-detail.ts); provenance
// is a tooltip only; report-wrong is a hover-revealed flag icon; verified-empty
// states render in the COMPLETED soft-green tone ("Scanned · none found" ✓ —
// "no ads" IS an answer). Band order puts the money first: Why → Contacts →
// Reviews (always — the listing facts are free) → enriched data domains →
// Profile → Nearby rivals → Coverage (dots + the honest not-run/failed/running
// rows) → Touches. Every block still renders off the honest run state
// (enriched / empty / failed / running / not_run — the shared loader's
// TypeState), never data presence.
//
// Per .claude/rules/cache-components.md Pattern 4: this is a client component;
// the callbacks (onClose / onNav) are owned by the client parent (LeadsWorkbench),
// so no function prop crosses a server→client boundary. Per
// .claude/rules/ui-ux-agency.md: dense, jargon-OK, numbers over adjectives.
// English-only.

import {
  useCallback,
  useEffect,
  useMemo,
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
  LeadProfile,
  LeadRival,
  LeadSignalVerdict,
  LeadTouch,
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

/** One rail anchor: a section key + its icon + tooltip label. */
interface RailAnchor {
  key: string;
  icon: IconName;
  label: string;
}

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
  // d7 · the scrollable content column — anchor scroll + scroll-spy target.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Token guards against an out-of-order resolve when the user clicks fast.
  const reqToken = useRef(0);
  // LD-1 · bumped by a 'lead-detail-changed' bus event (a touch was generated,
  // or a run enriched this lead) to force a re-fetch for the SAME businessId, so
  // "This lead's touches" stops saying "No touch yet" after a generation.
  const [refreshTick, setRefreshTick] = useState(0);
  // d7 · rail scroll-spy — which section anchor is "on".
  const [activeSec, setActiveSec] = useState("why");

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
  // (mouse-free triage — the rail buttons stay for the mouse). Tab is trapped
  // inside the drawer so focus can't fall behind the scrim to the table (a11y:
  // a role=dialog aria-modal must not leak focus). Arrow-nav is skipped while
  // the user is typing in a field (no forms in the drawer today, but defensive).
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

  // ── d7 · rail anchors — one per rendered section, in band order ────────────
  const anchors = useMemo<RailAnchor[]>(() => {
    if (!lead) return [];
    const list: RailAnchor[] = [
      { key: "why", icon: "check", label: "Why this lead qualifies" },
      { key: "contacts", icon: "phone", label: "Contacts" },
      { key: "reviews", icon: "star", label: "Reviews" },
    ];
    for (const d of lead.domains) {
      if (d.key !== "reviews" && d.state === "enriched") {
        list.push({ key: d.key, icon: d.icon, label: d.title });
      }
    }
    if (
      lead.profile.rows.length > 0 ||
      lead.profile.description ||
      lead.profile.mapsUrl
    ) {
      list.push({ key: "profile", icon: "pin", label: "Profile" });
    }
    if (lead.rivals.length > 0) {
      list.push({ key: "rivals", icon: "users", label: "Nearby rivals" });
    }
    list.push({ key: "coverage", icon: "coverage", label: "Coverage" });
    list.push({ key: "touches", icon: "mail", label: "Outreach · touches" });
    return list;
  }, [lead]);

  // d7 · scroll-spy: the LAST section whose top passed the fold is "on".
  // setState in a scroll event callback (not an effect body) — rule-safe.
  const onBodyScroll = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const secs = body.querySelectorAll<HTMLElement>("[data-sec]");
    let next = "why";
    for (const el of secs) {
      if (el.offsetTop <= body.scrollTop + 72) next = el.dataset.sec ?? next;
    }
    setActiveSec((cur) => (cur === next ? cur : next));
  }, []);

  const scrollToSec = useCallback((key: string) => {
    const body = bodyRef.current;
    const el = body?.querySelector<HTMLElement>(`[data-sec="${key}"]`);
    if (body && el) {
      body.scrollTo({ top: Math.max(0, el.offsetTop - 6), behavior: "smooth" });
      setActiveSec(key);
    }
  }, []);

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
        aria-label={lead ? `Lead detail: ${lead.name}` : "Lead detail"}
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
        {/* ── d7 rail · close / prev / next / logo / section anchors ── */}
        <nav className="ldrail" aria-label="Lead sections">
          <button
            type="button"
            className="ldarw ldx"
            ref={xBtnRef}
            onClick={onClose}
            aria-label="Close drawer"
            data-tip="Close · Esc"
          >
            ×
          </button>
          {/* WP4-8 · kbd hints in the tooltip — ↑/↓ walk prev/next lead. */}
          <button
            type="button"
            className="ldarw"
            onClick={() => navTo(-1)}
            aria-label="Previous lead (press up arrow)"
            data-tip="Previous lead · ↑"
            disabled={orderedIds.length < 2}
          >
            <Icon name="arrow-up" size={13} />
          </button>
          <button
            type="button"
            className="ldarw"
            onClick={() => navTo(1)}
            aria-label="Next lead (press down arrow)"
            data-tip="Next lead · ↓"
            disabled={orderedIds.length < 2}
          >
            <Icon name="arrow-down" size={13} />
          </button>
          <RailLogo
            key={businessId ?? "none"}
            name={lead?.name ?? null}
            logoUrl={lead?.logoUrl ?? null}
          />
          <div className="ldrdiv" aria-hidden="true" />
          <div className="ldancs">
            {anchors.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`ldanc${activeSec === a.key ? " on" : ""}`}
                data-tip={a.label}
                aria-label={`Jump to ${a.label}`}
                aria-current={activeSec === a.key ? "true" : undefined}
                onClick={() => scrollToSec(a.key)}
              >
                <Icon name={a.icon} size={13} />
              </button>
            ))}
          </div>
        </nav>

        {/* ── Content column · scrollable bands + sticky footer ── */}
        <div className="ldmain">
          <div className="dbody" ref={bodyRef} onScroll={onBodyScroll}>
            {isError && !lead ? (
              <div className="ldband">
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

// ── Rail helpers ─────────────────────────────────────────────────────────────

/**
 * The rail's identity square (d7 logo slot): the Business.logoUrl when it
 * loads, else a two-letter initials tile. Plain <img> on purpose: logo hosts
 * vary (Google-hosted CDNs), so the next/image proxy would 400 on any host
 * outside `images.remotePatterns` — and a 28px tile gains nothing from
 * optimization. Keyed by businessId in the parent so `failed` resets per lead.
 */
function RailLogo({
  name,
  logoUrl,
}: {
  name: string | null;
  logoUrl: string | null;
}) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="ldlogo-img"
        src={logoUrl}
        alt=""
        width={28}
        height={28}
        loading="lazy"
        data-tip={name ?? undefined}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="ldlogo" aria-hidden="true" data-tip={name ?? undefined}>
      {name ? railInitials(name) : ""}
    </div>
  );
}

/** "Meridian Family Acupuncture" → "MF" (first letters of the first 2 words). */
function railInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const second = words[1]?.[0] ?? words[0]?.[1] ?? "";
  return (first + second).toUpperCase();
}

// ── Header band ──────────────────────────────────────────────────────────────

function HeaderBand({ lead }: { lead: LeadDetail }) {
  const metaBits = [
    lead.category,
    lead.addressLine !== "—" ? lead.addressLine : null,
  ].filter((b): b is string => !!b);
  return (
    <section className="ldband ldhead" data-sec="top">
      <h1 className="ldname" data-tip={lead.name}>
        {lead.name}
      </h1>
      <p className="ldmeta">
        {metaBits.join(" · ")}
        {lead.openStatus !== "—" ? (
          <>
            {metaBits.length ? " · " : ""}
            <span className={`ldopen${lead.closed ? " closed" : ""}`}>
              {lead.openStatus}
            </span>
          </>
        ) : null}
      </p>
      {lead.rating != null ? (
        <p className="ldrate">
          <Icon name="star" size={12} className="ldstar" />
          <b>{lead.rating.toFixed(1)}</b>
          {lead.reviewCount != null ? (
            <span> · {lead.reviewCount.toLocaleString()} reviews</span>
          ) : null}
        </p>
      ) : null}
      <div className="ldpills">
        <Pills lead={lead} />
      </div>
    </section>
  );
}

function Pills({ lead }: { lead: LeadDetail }) {
  const reachTone = reachabilityTone(lead.reachability);
  return (
    <>
      {/* This pill is the ONE match surface. The tooltip carries the
          measured-vs-derived framing. */}
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
      <span className={`pill ${reachTone} dot`}>
        Reachable · {lead.reachability.toLowerCase()}
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
  const reviewsBlock = lead.domains.find((d) => d.key === "reviews");
  const enrichedOthers = lead.domains.filter(
    (d) => d.key !== "reviews" && d.state === "enriched",
  );
  const hasProfile =
    lead.profile.rows.length > 0 ||
    lead.profile.description != null ||
    lead.profile.mapsUrl != null;

  return (
    <div className={dimmed ? "ddim" : undefined} aria-busy={dimmed}>
      <HeaderBand lead={lead} />
      <WhyBand lead={lead} bands={bands} />
      <ContactsBand lead={lead} />
      {/* Reviews band ALWAYS renders — the GBP listing facts are free discovery
          data (E1); the pull half is state-gated inside. */}
      {reviewsBlock ? (
        <ReviewsBand
          block={reviewsBlock}
          bands={bands}
          businessId={lead.businessId}
        />
      ) : null}
      {enrichedOthers.map((d) => (
        <DataBand key={d.key} block={d} bands={bands} />
      ))}
      {hasProfile ? <ProfileBand profile={lead.profile} bands={bands} /> : null}
      {lead.rivals.length > 0 ? <RivalsBand rivals={lead.rivals} /> : null}
      <CoverageBand lead={lead} />
      <TouchesBand touches={lead.touches} />
    </div>
  );
}

// ── 1 · Why this lead qualifies ──────────────────────────────────────────────

/**
 * Tom's money, first. The d7 density block leads: big fired-count + the FIRED
 * signal titles inline with checks; the not-yet/didn't verdicts follow as
 * compact honest rows (P3 — "Scanned · no data" wears the completed soft-green
 * tone, "Enrich to unlock" stays amber, never a fake match). Fired composites
 * (evidence + vs-cell bars + dispute), angle chips, expert findings, and the
 * verified-claims note all live here too.
 */
function WhyBand({
  lead,
  bands,
}: {
  lead: LeadDetail;
  bands?: Partial<Record<string, CellBand>>;
}) {
  const verdicts = lead.signalVerdicts;
  const fired = verdicts.filter((v) => v.matched === true);
  // null (not computable) before false (didn't fire) — pending beats dead.
  const rest = verdicts
    .filter((v) => v.matched !== true)
    .sort(
      (a, b) => (a.matched === null ? 0 : 1) - (b.matched === null ? 0 : 1),
    );

  return (
    <section className="ldband" data-sec="why">
      <div className="ldcap">
        <span className="ldcap-t">Why this lead qualifies</span>
        {verdicts.length > 0 ? (
          <i>
            {fired.length}/{verdicts.length} fired
          </i>
        ) : null}
      </div>

      {verdicts.length > 0 ? (
        <>
          <div className="ldwhy">
            <div className="ldwhyn">
              {fired.length}/{verdicts.length}
            </div>
            <div className="ldwhyl">
              {fired.length === 0 ? (
                <span className="note">None of your signals fired yet</span>
              ) : (
                fired.map((v) => (
                  <span key={v.key} data-tip={v.means}>
                    <Icon name="check" size={11} />
                    {v.title}
                  </span>
                ))
              )}
            </div>
          </div>
          {rest.length > 0 ? (
            <div className="sigverdicts">
              {rest.map((v) => (
                <SignalVerdictRow key={v.key} verdict={v} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {lead.firedSignals.length === 0 ? (
        lead.signalVerdicts.length === 0 ? (
          <p className="note m0">
            No composite signals fired — this lead matched on raw qualifiers
            only. See the data bands below for the raw evidence.
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
    </section>
  );
}

/**
 * One non-fired verdict row (P3 honesty, Wave-3 split):
 *   - didn't fire        · neutral tag (evaluated, no match)
 *   - Scanned · no data  · COMPLETED soft-green tag (the backing researches
 *     RAN — verified-absent is an answer, never a re-pay invite)
 *   - Enrich to unlock   · amber tag (truly unscanned)
 */
function SignalVerdictRow({ verdict }: { verdict: LeadSignalVerdict }) {
  const tag =
    verdict.matched === true ? (
      <span className="ldtag g">Fired</span>
    ) : verdict.matched === null ? (
      verdict.scanned ? (
        <span className="ldtag done">
          <Icon name="check" size={9} />
          Scanned · no data
        </span>
      ) : (
        <span className="ldtag amber">Enrich to unlock</span>
      )
    ) : (
      <span className="ldtag">Didn’t fire</span>
    );
  return (
    <div className="sig">
      <span className="name" data-tip={verdict.means}>
        {verdict.title}
      </span>
      {tag}
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

// ── 2 · Contacts ─────────────────────────────────────────────────────────────

/** Per-group cap before the "+N more" toggle (issue 5). */
const CONTACT_GROUP_CAP = 4;

/**
 * d7 contact rows: icon · ONE-format value · micro-tags (verified / role /
 * primary / listing) · a hover-revealed report-wrong flag. Provenance
 * ("tel: link · 95%") is a TOOLTIP on the value, never an inline tag (owner
 * fix b). The GBP listing scalars render as rows tagged "listing" (already
 * digit-deduped against the scrape in lead-detail.ts); the website joins as a
 * row too (d7). Socials render as compact linked chips.
 *
 * Truth unification (2026-07-06): the scraped rows render only off the honest
 * `contactsState` (the shared loader's CONTACTS run state), never data
 * presence. Listing rows + website are free discovery facts — every state.
 */
function ContactsBand({ lead }: { lead: LeadDetail }) {
  const enriched = lead.contactsState === "enriched";
  const listingPhones = lead.listingContacts.filter((c) =>
    c.href.startsWith("tel:"),
  );
  const listingEmails = lead.listingContacts.filter((c) =>
    c.href.startsWith("mailto:"),
  );
  const channelCount =
    (enriched
      ? lead.phones.length + lead.emails.length + lead.socials.length
      : 0) + lead.listingContacts.length;

  return (
    <section className="ldband" data-sec="contacts">
      <div className="ldcap">
        <span className="ldcap-t">Contacts</span>
        {channelCount > 0 ? (
          <i>
            {channelCount} channel{channelCount === 1 ? "" : "s"} · deduped
          </i>
        ) : null}
      </div>
      <ContactRows
        icon="phone"
        groupLabel="Phone numbers"
        scraped={enriched ? lead.phones : []}
        listing={listingPhones}
        businessId={lead.businessId}
        reportReason="wrong_number"
      />
      <ContactRows
        icon="mail"
        groupLabel="Email addresses"
        scraped={enriched ? lead.emails : []}
        listing={listingEmails}
        businessId={lead.businessId}
        reportReason="wrong_email"
      />
      {lead.website ? <WebsiteRow url={lead.website} /> : null}
      {!enriched ? <ContactsStateRow lead={lead} /> : null}
      {enriched && lead.socials.length > 0 ? (
        <SocialChips socials={lead.socials} />
      ) : null}
    </section>
  );
}

/**
 * One channel group (phones / emails): scraped values first (loader orders
 * primary-first), then the GBP listing rows tagged "listing". Capped at 4 with
 * a real "+N more" toggle. WP6-13 · the per-value flag lives INSIDE each row —
 * reporting the 3rd email disputes the 3rd email, not [0].
 */
function ContactRows({
  icon,
  groupLabel,
  scraped,
  listing,
  businessId,
  reportReason,
}: {
  icon: IconName;
  groupLabel: string;
  scraped: LeadContact[];
  listing: LeadContact[];
  businessId: string;
  reportReason: "wrong_number" | "wrong_email";
}) {
  const [expanded, setExpanded] = useState(false);
  const all = [
    ...scraped.map((c) => ({ c, listing: false })),
    ...listing.map((c) => ({ c, listing: true })),
  ];
  if (all.length === 0) return null;
  const overflow = all.length - CONTACT_GROUP_CAP;
  const shown =
    expanded || overflow <= 0 ? all : all.slice(0, CONTACT_GROUP_CAP);
  return (
    <div role="group" aria-label={groupLabel}>
      {shown.map((u, i) => (
        <ContactRow
          key={`${u.c.href}-${i}`}
          icon={icon}
          contact={u.c}
          listing={u.listing}
          businessId={businessId}
          reportReason={reportReason}
        />
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          className="ldmore"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "less" : `+${overflow} more`}
        </button>
      ) : null}
    </div>
  );
}

function ContactRow({
  icon,
  contact,
  listing,
  businessId,
  reportReason,
}: {
  icon: IconName;
  contact: LeadContact;
  listing: boolean;
  businessId: string;
  reportReason: "wrong_number" | "wrong_email";
}) {
  // Owner fix b · provenance is a TOOLTIP only ("Found via tel: link ·
  // confidence 95%") — trust before a cold dial, zero row noise.
  const tip = listing
    ? "From the Google listing"
    : contact.provenance
      ? `Found via ${contact.provenance.replace(" · ", " · confidence ")}`
      : undefined;
  return (
    <div className="ldcrow">
      <span className="ci" aria-hidden="true">
        <Icon name={icon} size={13} />
      </span>
      <a className="ldcval" href={contact.href} data-tip={tip}>
        {contact.value}
      </a>
      {contact.verified ? <span className="ldtag g">verified</span> : null}
      {contact.role ? <span className="ldtag">{contact.role}</span> : null}
      {contact.primary ? <span className="ldtag">primary</span> : null}
      {listing ? (
        <span className="ldtag" data-tip="From the Google listing">
          listing
        </span>
      ) : (
        <ReportWrongButton
          variant="flag"
          businessId={businessId}
          reason={reportReason}
          value={contact.value}
          ariaLabel={`Report ${contact.value} as wrong`}
        />
      )}
    </div>
  );
}

/** The site as a contact row (d7) — free discovery data, every state. */
function WebsiteRow({ url }: { url: string }) {
  const display = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <div className="ldcrow">
      <span className="ci" aria-hidden="true">
        <Icon name="link" size={13} />
      </span>
      <a
        className="ldcval"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-tip={url}
      >
        {display}
      </a>
    </div>
  );
}

/**
 * The honest CONTACTS run state when the scan hasn't produced a strip:
 *   not_run → "Enrich contacts →" CTA · empty → COMPLETED soft-green
 *   "Scanned · none found" (✓ — an answer, owner fix c) · failed → retry ·
 *   running → in-flight tag.
 */
function ContactsStateRow({ lead }: { lead: LeadDetail }) {
  const st = lead.contactsState;
  const openSheet = () =>
    openEnrichSheet({
      enrichments: ["contacts"],
      preselect: true,
      scope: { selectedBusinessIds: [lead.businessId] },
    });
  return (
    <div className="ldnr">
      <span className={`ldnr-dot ${st}`} aria-hidden="true" />
      <span className="ldnr-title">Contact scan</span>
      {st === "empty" ? (
        <span
          className="ldtag done"
          data-tip="The contact scan ran — no phone, email, or social found beyond the listing."
        >
          <Icon name="check" size={9} />
          Scanned · none found
        </span>
      ) : st === "running" ? (
        <span
          className="ldtag run"
          data-tip="Scan in progress — contacts land here when it finishes."
        >
          enriching…
        </span>
      ) : st === "failed" ? (
        <>
          <span
            className="ldtag bad"
            data-tip="The contact scan errored on the last run."
          >
            Failed
          </span>
          <button
            type="button"
            className="ldcta"
            onClick={openSheet}
            aria-label="Retry contacts enrichment"
          >
            Retry →
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ldcta"
          data-tip="Scan the site for phones, emails, and socials — with per-value provenance."
          onClick={openSheet}
          aria-label="Enrich contacts"
        >
          Enrich contacts →
        </button>
      )}
    </div>
  );
}

/** E6 · socials as compact linked chips (platform prefix + handle). */
function SocialChips({ socials }: { socials: LeadContact[] }) {
  const [expanded, setExpanded] = useState(false);
  const overflow = socials.length - CONTACT_GROUP_CAP;
  const shown =
    expanded || overflow <= 0 ? socials : socials.slice(0, CONTACT_GROUP_CAP);
  return (
    <div className="ldsoc" role="group" aria-label="Social profiles">
      {shown.map((c, i) => (
        <a
          key={`${c.href}-${i}`}
          className="ldschip"
          href={c.href}
          target="_blank"
          rel="noopener noreferrer"
          data-tip={c.href}
        >
          <span className="cplat">{socialPlatformLabel(c.channel)}</span>
          {c.value}
        </a>
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          className="ldmore"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "less" : `+${overflow} more`}
        </button>
      ) : null}
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

// ── Report-wrong (one-shot, WP6-13 / WP7-3) ──────────────────────────────────

/**
 * WP6-13 / WP7-3 · "report wrong" affordance. Flags the datum as wrong → hides
 * it from every shared artifact (dispute-actions). Contact-data reasons ALSO
 * auto-refund the family credit; a `wrong_finding` dispute hides the finding
 * but doesn't refund (findings aren't independently billed). One-shot:
 * disables + shows "Reported ✓" once fired. Two skins (owner fix b): the
 * default text link (finding disputes) and a small hover-revealed FLAG icon on
 * contact rows.
 */
function ReportWrongButton({
  businessId,
  reason,
  value,
  signalKey,
  label = "report wrong",
  ariaLabel = "Report wrong data",
  variant = "link",
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
  /** "flag" renders the hover-revealed icon (contact rows); "link" the text. */
  variant?: "link" | "flag";
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
  const onClick = () =>
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
    });
  if (variant === "flag") {
    return (
      <button
        type="button"
        className="ldflag"
        disabled={pending}
        data-tip={title}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        <FlagIcon />
      </button>
    );
  }
  return (
    <button
      type="button"
      className="report-link"
      disabled={pending}
      data-tip={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** The d7 report-wrong flag glyph (not in the shared Icon set — drawer-only). */
function FlagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

// ── 3 · Data bands ───────────────────────────────────────────────────────────

/**
 * The Reviews band — ALWAYS rendered: the GBP listing facts (total / rating /
 * distribution / last review) are free discovery data (E1), honestly labelled
 * as the listing. The pull half renders off the honest state: enriched → the
 * reply-rate / unanswered / lifecycle / quote rows under "From the reviews
 * pull"; anything else → the compact state row (ghost CTA / verified-empty ✓ /
 * retry / running). Carries the vs-cell InfoTip — toned values and bars start
 * here.
 */
function ReviewsBand({
  block,
  bands,
  businessId,
}: {
  block: LeadDomainBlock;
  bands?: Partial<Record<string, CellBand>>;
  businessId: string;
}) {
  return (
    <section className="ldband" data-sec="reviews">
      <div className="ldcap">
        <span className="ldcap-t">
          {block.title}
          <InfoTip
            text={VS_CELL_EXPLAINER}
            triggerLabel="What the green/red values mean"
          />
        </span>
        <i>
          {block.state === "enriched" && block.source
            ? `${block.source}${block.asOf ? ` · ${block.asOf}` : ""}`
            : "Google listing"}
        </i>
      </div>
      {block.listingRows.length > 0 ? (
        <>
          <div className="microlabel">From the Google listing</div>
          {block.listingRows.map((r, i) => (
            <EvidenceRow key={`l-${i}`} row={r} bands={bands} />
          ))}
        </>
      ) : null}
      {block.state === "enriched" ? (
        block.rows.length > 0 ? (
          <>
            <div className="microlabel">From the reviews pull</div>
            <DomainRows rows={block.rows} bands={bands} hasListing />
          </>
        ) : null
      ) : (
        <DomainStateRow
          block={block}
          businessId={businessId}
          title="Review pull"
        />
      )}
    </section>
  );
}

/**
 * An ENRICHED non-reviews domain: one flat band — cap (title + right-aligned
 * "source · as-of" provenance, WP6-9) over 3–8 dense rows. No accordion: the
 * paid evidence is never behind a click.
 */
function DataBand({
  block,
  bands,
}: {
  block: LeadDomainBlock;
  bands?: Partial<Record<string, CellBand>>;
}) {
  return (
    <section className="ldband" data-sec={block.key}>
      <div className="ldcap">
        <span className="ldcap-t">{block.title}</span>
        {block.source ? (
          <i>
            {block.source}
            {block.asOf ? ` · ${block.asOf}` : ""}
          </i>
        ) : null}
      </div>
      <DomainRows rows={block.rows} bands={bands} hasListing={false} />
    </section>
  );
}

/**
 * The always-free GBP Profile band: photos · claimed · years (tenure band) ·
 * open-days · notable attributes, plus the owner's own GBP description
 * (truncated, expandable) and the direct Maps listing link. Listing-labelled —
 * free discovery data, never proof an enrichment ran.
 */
function ProfileBand({
  profile,
  bands,
}: {
  profile: LeadProfile;
  bands?: Partial<Record<string, CellBand>>;
}) {
  return (
    <section className="ldband" data-sec="profile">
      <div className="ldcap">
        <span className="ldcap-t">Profile</span>
        <i>Google listing</i>
      </div>
      {profile.rows.map((r, i) => (
        <EvidenceRow key={i} row={r} bands={bands} />
      ))}
      {profile.description ? (
        <GbpDescription text={profile.description} />
      ) : null}
      {profile.mapsUrl ? (
        <a
          className="ldlink"
          href={profile.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Maps listing ↗
        </a>
      ) : null}
    </section>
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
          className="ldmore"
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
 * competitor set Google's own algorithm surfaces, one dense d7 row each.
 * Powers the "you're losing to Treasure Valley (136 reviews)" pitch at zero
 * cost.
 */
function RivalsBand({ rivals }: { rivals: LeadRival[] }) {
  return (
    <section className="ldband" data-sec="rivals">
      <div className="ldcap">
        <span className="ldcap-t">Nearby rivals</span>
        <i>People also search</i>
      </div>
      {rivals.map((r, i) => (
        <div className="ldriv" key={`${r.name}-${i}`}>
          <em>{r.name}</em>
          <span>
            {r.rating != null ? `${r.rating.toFixed(1)}★` : "—"}
            {r.reviewCount != null
              ? ` · ${r.reviewCount.toLocaleString()}`
              : ""}
          </span>
        </div>
      ))}
    </section>
  );
}

// ── 4 · Coverage (the honest not-yet-enriched rail) ──────────────────────────

/**
 * The d7 coverage band: one dot per data domain (filled = enriched, soft-green
 * = verified empty, red = failed) + a compact honest state row for every
 * non-enriched domain (reviews excluded — its own band carries its state):
 *   not_run · "Enrich →" CTA (ghostNote in the tooltip)
 *   empty   · COMPLETED soft-green "Scanned · none found" ✓ (owner fix c —
 *             never a re-pay CTA; "no ads" IS an answer)
 *   failed  · red "Failed" + "Retry →"
 *   running · indigo "enriching…" (paid for — no CTA)
 */
function CoverageBand({ lead }: { lead: LeadDetail }) {
  const enrichedCount = lead.domains.filter(
    (d) => d.state === "enriched",
  ).length;
  const ghosts = lead.domains.filter(
    (d) => d.key !== "reviews" && d.state !== "enriched",
  );
  return (
    <section className="ldband" data-sec="coverage">
      <div className="ldcap">
        <span className="ldcap-t">Coverage</span>
        <i>
          {enrichedCount} of {lead.domains.length} enriched
        </i>
      </div>
      <div className="lddots" aria-hidden="true">
        {lead.domains.map((d) => (
          <span
            key={d.key}
            className={`lddot ${d.state}`}
            data-tip={`${d.title} · ${typeStateLabel(d.state)}`}
          />
        ))}
      </div>
      {ghosts.map((d) => (
        <DomainStateRow key={d.key} block={d} businessId={lead.businessId} />
      ))}
    </section>
  );
}

/** Human label for a domain's TypeState (dot tooltips). */
function typeStateLabel(state: LeadDomainBlock["state"]): string {
  switch (state) {
    case "enriched":
      return "enriched";
    case "empty":
      return "scanned · none found";
    case "failed":
      return "failed";
    case "running":
      return "enriching…";
    default:
      return "not enriched";
  }
}

/**
 * One compact honest state row: state dot + title + tag/CTA. Used by the
 * coverage band and by the Reviews band's pull half.
 */
function DomainStateRow({
  block,
  businessId,
  title,
}: {
  block: LeadDomainBlock;
  businessId: string;
  /** Override the row title (Reviews band says "Review pull"). */
  title?: string;
}) {
  return (
    <div className="ldnr">
      <span className={`ldnr-dot ${block.state}`} aria-hidden="true" />
      <span className="ldnr-title">{title ?? block.title}</span>
      <StateTagCta block={block} businessId={businessId} />
    </div>
  );
}

/** The state tag / CTA half of a {@link DomainStateRow}. */
function StateTagCta({
  block,
  businessId,
}: {
  block: LeadDomainBlock;
  businessId: string;
}) {
  const enrichments = enrichTypesForDomainKey(block.key);
  const openSheet = () =>
    openEnrichSheet({
      enrichments,
      // AUDIT D1 · a drawer single-domain CTA → pre-select its enrichment.
      preselect: true,
      scope: { selectedBusinessIds: [businessId] },
    });
  if (block.state === "empty") {
    return (
      <span
        className="ldtag done"
        data-tip={
          block.emptyNote ?? "Enrichment ran — nothing found for this lead."
        }
      >
        <Icon name="check" size={9} />
        Scanned · none found
      </span>
    );
  }
  if (block.state === "running") {
    return (
      <span
        className="ldtag run"
        data-tip="Scan in progress — results land here when it finishes."
      >
        enriching…
      </span>
    );
  }
  if (block.state === "failed") {
    return (
      <>
        <span
          className="ldtag bad"
          data-tip="Enrichment errored on the last run."
        >
          Failed
        </span>
        {enrichments.length > 0 ? (
          <button
            type="button"
            className="ldcta"
            onClick={openSheet}
            aria-label={`Retry ${block.title} enrichment`}
          >
            Retry →
          </button>
        ) : null}
      </>
    );
  }
  // not_run — WP5-3 · the CTA's promise made real: opens the in-workbench
  // enrich sheet pre-seeded with this domain's families, scoped to this lead.
  return enrichments.length > 0 ? (
    <button
      type="button"
      className="ldcta"
      data-tip={block.ghostNote}
      onClick={openSheet}
      aria-label={`Enrich ${block.title}`}
    >
      Enrich →
    </button>
  ) : (
    <span className="ldtag" data-tip={block.ghostNote}>
      Not enriched
    </span>
  );
}

// ── 5 · Touches ──────────────────────────────────────────────────────────────

function TouchesBand({ touches }: { touches: LeadTouch[] }) {
  return (
    <section className="ldband" data-sec="touches">
      <div className="ldcap">
        <span className="ldcap-t">Outreach · touches</span>
        <i>{touches.length > 0 ? touches.length : "none yet"}</i>
      </div>
      {touches.length === 0 ? (
        <div className="note">
          No touch yet. Generate touch below — grounded in this lead&rsquo;s
          signals.
        </div>
      ) : (
        touches.map((t) => (
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
    </section>
  );
}

// ── Evidence rows (shared by why + data bands) ───────────────────────────────

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
  painIndex,
}: {
  row: LeadEvidenceRow;
  bands?: Partial<Record<string, CellBand>>;
  /** d7 · 1-based number badge for an Opener-angle pain line. */
  painIndex?: number;
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
  // Reviews band cap's InfoTip explains them once for every toned value.
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
  // `pain` lines (the outreach pain hypotheses) get the amber-rule highlight +
  // a d7 number badge — the issues must stand out from neutral prose.
  if (row.prose) {
    return (
      <div className={`sig kv prose${row.pain ? " pain" : ""}`}>
        {painIndex != null ? (
          <b className="ldang-n" aria-hidden="true">
            {painIndex}
          </b>
        ) : null}
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

/**
 * E3 · renders a block's rows, grouping consecutive rows that share a `section`
 * under a small heading (AI research: Services · Summary · Compliance cues ·
 * Opener angle). Ungrouped rows (every other block) render flat as before.
 * Issue 13 · a segment whose rows carry `chip` renders as one wrapping `.dchips`
 * row (the Services menu) instead of key/value lines; section heads are the
 * shared `.microlabel` token. Pain prose lines get 1-based d7 number badges.
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
      {segments.map((seg, i) => {
        // d7 · number the pain lines within their segment (Opener angle 1/2/3).
        let painN = 0;
        return (
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
                <EvidenceRow
                  key={j}
                  row={r}
                  bands={bands}
                  painIndex={r.prose && r.pain ? ++painN : undefined}
                />
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function DrawerSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div className="ldband" key={i}>
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
