"use client";

// TouchpointsTab · the Touchpoints tab of the agency workbench. A business-
// grouped, expandable view over the OutreachDraft rows generated for this set,
// built on the ported prototype classes (.tpstats/.tpstat, table.wb, .tprow,
// .tpdetail/.tpstep, .tpedit, .tpsent, .statpill, .bulkbar, .wbpager).
//
// Top → bottom: a callout, a 5-tile stat strip (Reachable / Enriched / Touches /
// Contacted / Won), a toolbar (search + status segmented filter), the grouped
// table (Business + contact chips / Touches / Sent / Status / expand), numbered
// pagination, and a sticky bulk bar.
//
// Each business row expands to its drafted sequence: per-step cards with an
// editable body (saveTouchBodyAction), a Sent/Draft toggle (setTouchSentAction),
// and "why this works" pain chips grounded in the lead's flagged findings. The
// per-business status pill mutates the LEAD status (setLeadStatusAction) so the
// Leads tab stays in sync on reload.
//
// SIMPLIFIED vs prototype: the schema stores ONE OutreachDraft per business (no
// multi-step seq/of persistence) so each business shows a single step labelled
// "Touch 1 of 1". Per-step credit "Regenerate" is out of scope (no draft-regen
// action shipped). Both noted in the build summary.

import { useMemo, useOptimistic, useState, useTransition } from "react";

import { setLeadStatusAction } from "@/modules/discovery/save-list-actions";
import { saveTouchBodyAction, setTouchSentAction } from "../workbench-actions";
import { StatusPill } from "@/modules/agency-portal/components/StatusPill";
import { BulkActionBar } from "@/modules/agency-portal/components/BulkActionBar";
import {
  PAGE_SIZES,
  STATUS_ORDER,
  getPageNumbers,
  painGroupClass,
  type LeadStatus,
} from "../leads-workbench";

/** A serialized touchpoint draft + its grounding pains, resolved server-side. */
export interface WorkbenchTouch {
  draftId: string;
  businessId: string;
  businessName: string;
  /** Optional lead id (the per-business status pill mutates this). */
  leadId: string | null;
  leadStatus: LeadStatus;
  channel: string;
  subject: string | null;
  body: string;
  /** Whether the draft has been marked sent (status === "sent"). */
  sent: boolean;
  /** "why this works" pain chips (flagged findings + grounding why-strings). */
  pains: { group: string; label: string; title: string }[];
  /** Contact chips for the business row sub-line. */
  phones: string[];
  emails: string[];
}

export interface TouchpointStats {
  reachable: number;
  enriched: number;
  touches: number;
  businesses: number;
  contacted: number;
  won: number;
}

export interface TouchpointsTabProps {
  touches: WorkbenchTouch[];
  stats: TouchpointStats;
}

type StatusFilter = "all" | LeadStatus;

export function TouchpointsTab({ touches, stats }: TouchpointsTabProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Optimistic lead status (mirrors the Leads tab pattern).
  const [committed, setCommitted] = useState<Record<string, LeadStatus>>(() =>
    Object.fromEntries(
      touches
        .filter((t) => t.leadId)
        .map((t) => [t.leadId as string, t.leadStatus]),
    ),
  );
  const [optimistic, applyOptimistic] = useOptimistic(
    committed,
    (state, change: { leadId: string; status: LeadStatus }) => ({
      ...state,
      [change.leadId]: change.status,
    }),
  );
  const [isPending, startTransition] = useTransition();

  // Sent-state (optimistic, local; the server persists OutreachDraft.status).
  const [sentMap, setSentMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(touches.map((t) => [t.draftId, t.sent])),
  );

  // Group touches by business name.
  const groups = useMemo(() => {
    const map = new Map<string, WorkbenchTouch[]>();
    for (const t of touches) {
      const arr = map.get(t.businessName);
      if (arr) arr.push(t);
      else map.set(t.businessName, [t]);
    }
    return [...map.entries()].map(([name, ts]) => ({ name, touches: ts }));
  }, [touches]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      const status = leadStatusOf(g.touches, optimistic);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        g.touches.some((t) => t.body.toLowerCase().includes(q))
      );
    });
  }, [groups, search, statusFilter, optimistic]);

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageGroups = filteredGroups.slice(
    (curPage - 1) * pageSize,
    curPage * pageSize,
  );

  function leadStatusOf(
    ts: WorkbenchTouch[],
    opt: Record<string, LeadStatus>,
  ): LeadStatus {
    const withLead = ts.find((t) => t.leadId);
    if (!withLead?.leadId) return ts[0]?.leadStatus ?? "NEW";
    return opt[withLead.leadId] ?? withLead.leadStatus;
  }

  function setBizStatus(ts: WorkbenchTouch[], status: LeadStatus) {
    const leadId = ts.find((t) => t.leadId)?.leadId;
    if (!leadId) return;
    setError(null);
    startTransition(async () => {
      applyOptimistic({ leadId, status });
      const r = await setLeadStatusAction({ leadId, status });
      if (r.status === "ok") setCommitted((p) => ({ ...p, [leadId]: status }));
      else setError("Couldn't update the lead. Try again.");
    });
  }

  function cycleBizStatus(ts: WorkbenchTouch[]) {
    const current = leadStatusOf(ts, optimistic);
    const i = STATUS_ORDER.indexOf(current);
    setBizStatus(ts, STATUS_ORDER[(i + 1) % STATUS_ORDER.length]);
  }

  function toggleOpen(name: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function setSent(draftId: string, sent: boolean) {
    setSentMap((p) => ({ ...p, [draftId]: sent }));
    startTransition(async () => {
      const r = await setTouchSentAction({ draftId, sent });
      if (r.status !== "ok") {
        setSentMap((p) => ({ ...p, [draftId]: !sent }));
        setError("Couldn't update the touch. Try again.");
      }
    });
  }

  function bulkSetStatus(status: LeadStatus) {
    const ids = pageGroups
      .filter((g) => selected.has(g.name))
      .map((g) => g.touches.find((t) => t.leadId)?.leadId)
      .filter((x): x is string => Boolean(x));
    setError(null);
    startTransition(async () => {
      for (const id of ids) applyOptimistic({ leadId: id, status });
      const results = await Promise.all(
        ids.map((id) => setLeadStatusAction({ leadId: id, status })),
      );
      const okIds = ids.filter((_, i) => results[i]?.status === "ok");
      if (okIds.length)
        setCommitted((p) => {
          const next = { ...p };
          for (const id of okIds) next[id] = status;
          return next;
        });
    });
  }

  function markAllSent() {
    const drafts = filteredGroups
      .filter((g) => selected.has(g.name))
      .flatMap((g) => g.touches.map((t) => t.draftId));
    for (const id of drafts) setSent(id, true);
  }

  return (
    <div>
      <div className="callout section">
        ✍️ Touches are grouped by business — each card is the full sequence we
        drafted for that lead, grounded in real signals. Open a card to read
        every step.
      </div>

      {/* ── Stat strip ────────────────────────────────────────────────────── */}
      <div className="tpstats" aria-label="Outreach summary">
        <Tile num={stats.reachable} label="Reachable" sub="have a contact" />
        <Tile num={stats.enriched} label="Enriched" sub="in this workspace" />
        <Tile
          num={stats.touches}
          label="Touches"
          sub={`${stats.businesses} ${stats.businesses === 1 ? "business" : "businesses"} · avg ${avg(
            stats.touches,
            stats.businesses,
          )}/biz`}
        />
        <Tile num={stats.contacted} label="Contacted" sub="reached out" />
        <Tile
          num={stats.won}
          label="Won"
          sub={`new retainer${stats.won === 1 ? "" : "s"}`}
          win
        />
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="wb-toolbar">
        <div className="wb-search">
          <span className="si" aria-hidden="true">
            🔎
          </span>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search businesses or messages…"
            aria-label="Search touchpoints"
          />
        </div>
        <div className="seg sm" role="group" aria-label="Filter by status">
          {(["all", ...STATUS_ORDER] as StatusFilter[])
            .filter((s) => s !== "HIDDEN")
            .map((s) => (
              <button
                key={s}
                type="button"
                className={statusFilter === s ? "on" : undefined}
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
              >
                {s === "all" ? "All" : titleCase(s)}
              </button>
            ))}
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--red)", fontSize: 12 }}>
          {error}
        </p>
      ) : null}

      {/* ── Grouped table ─────────────────────────────────────────────────── */}
      <div className="wbtable-wrap">
        <table className="wb">
          <thead>
            <tr>
              <th className="sel" style={{ width: 34 }}>
                <input
                  type="checkbox"
                  className="ck"
                  aria-label="Select all on this page"
                  checked={
                    pageGroups.length > 0 &&
                    pageGroups.every((g) => selected.has(g.name))
                  }
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const g of pageGroups)
                        if (e.target.checked) next.add(g.name);
                        else next.delete(g.name);
                      return next;
                    })
                  }
                />
              </th>
              <th>Business</th>
              <th className="num">Touches</th>
              <th className="num">Sent</th>
              <th>Status</th>
              <th className="num" aria-label="Expand" />
            </tr>
          </thead>
          <tbody>
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div
                    className="empty"
                    style={{
                      textAlign: "center",
                      padding: "32px 0",
                      color: "var(--faint)",
                    }}
                  >
                    ✉️ No sequences match. Generate touches from selected leads.
                  </div>
                </td>
              </tr>
            ) : (
              pageGroups.flatMap((g) => {
                const isOpen = open.has(g.name);
                const status = leadStatusOf(g.touches, optimistic);
                const sentCount = g.touches.filter(
                  (t) => sentMap[t.draftId],
                ).length;
                const contactChips = g.touches[0];
                const rows = [
                  <tr
                    key={g.name}
                    className={`tprow${isOpen ? " open" : ""}${
                      selected.has(g.name) ? " selrow" : ""
                    }`}
                    onClick={() => toggleOpen(g.name)}
                  >
                    <td className="sel" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="ck rowck"
                        aria-label={`Select ${g.name}`}
                        checked={selected.has(g.name)}
                        onChange={() => toggleSelect(g.name)}
                      />
                    </td>
                    <td className="biz">
                      <span className="bizname" title={g.name}>
                        {g.name}
                      </span>
                      <div className="addr">
                        {contactChips &&
                        (contactChips.phones.length ||
                          contactChips.emails.length) ? (
                          <span className="tpc-line">
                            {contactChips.phones[0] ? (
                              <a
                                className="clink"
                                href={`tel:${contactChips.phones[0]}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {contactChips.phones[0]}
                              </a>
                            ) : null}
                            {contactChips.emails[0] ? (
                              <a
                                className="clink"
                                href={`mailto:${contactChips.emails[0]}`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ marginLeft: 8 }}
                              >
                                {contactChips.emails[0]}
                              </a>
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </div>
                    </td>
                    <td className="num">{g.touches.length}</td>
                    <td className="num">
                      {sentCount}/{g.touches.length}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <StatusPill
                        status={status}
                        disabled={isPending}
                        title="Click to advance · status"
                        onClick={() => cycleBizStatus(g.touches)}
                      />
                    </td>
                    <td className="num">
                      <span className="tpcard-chv" aria-hidden="true">
                        ▾
                      </span>
                    </td>
                  </tr>,
                ];
                if (isOpen) {
                  rows.push(
                    <tr key={`${g.name}-detail`} className="tpdetailrow">
                      <td colSpan={6}>
                        <div className="tpdetail">
                          {g.touches.map((t, i) => (
                            <TouchStep
                              key={t.draftId}
                              touch={t}
                              seq={i + 1}
                              of={g.touches.length}
                              sent={sentMap[t.draftId] ?? false}
                              onSent={(s) => setSent(t.draftId, s)}
                            />
                          ))}
                        </div>
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      {filteredGroups.length > 0 ? (
        <div
          className="wbpager"
          role="navigation"
          aria-label="Table pagination"
        >
          <div className="pg-left">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span>of {filteredGroups.length}</span>
            <span className="pg-range">
              {(curPage - 1) * pageSize + 1}–
              {Math.min(curPage * pageSize, filteredGroups.length)} of{" "}
              {filteredGroups.length}
            </span>
          </div>
          {totalPages > 1 ? (
            <div className="pg-pages">
              <button
                type="button"
                className="pgnav"
                onClick={() => setPage(curPage - 1)}
                disabled={curPage <= 1}
                aria-label="Previous page"
              >
                ‹
              </button>
              {getPageNumbers(curPage, totalPages).map((p, i) =>
                p === "ellipsis" ? (
                  <span key={`e${i}`} className="pgnum ell" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={`pgnum${p === curPage ? " on" : ""}`}
                    onClick={() => setPage(p)}
                    aria-current={p === curPage ? "page" : undefined}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                type="button"
                className="pgnav"
                onClick={() => setPage(curPage + 1)}
                disabled={curPage >= totalPages}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Bulk bar ──────────────────────────────────────────────────────── */}
      <BulkActionBar
        selectedCount={selected.size}
        countLabel={(n) =>
          `${n} ${n === 1 ? "business" : "businesses"} selected`
        }
      >
        <span style={{ position: "relative" }}>
          <BulkStatusButton onPick={bulkSetStatus} />
        </span>
        <button type="button" className="bb" onClick={markAllSent}>
          Mark all sent
        </button>
        <button
          type="button"
          className="bb"
          onClick={() => setSelected(new Set())}
        >
          Clear
        </button>
      </BulkActionBar>
    </div>
  );
}

function Tile({
  num,
  label,
  sub,
  win,
}: {
  num: number;
  label: string;
  sub: string;
  win?: boolean;
}) {
  return (
    <div className={`tpstat${win ? " win" : ""}`}>
      <div className="num">{num.toLocaleString()}</div>
      <div className="lbl">{label}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

/** One grounded step card: editable body, Sent toggle, why-this-works chips. */
function TouchStep({
  touch,
  seq,
  of,
  sent,
  onSent,
}: {
  touch: WorkbenchTouch;
  seq: number;
  of: number;
  sent: boolean;
  onSent: (sent: boolean) => void;
}) {
  const [body, setBody] = useState(touch.body);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const r = await saveTouchBodyAction({
        draftId: touch.draftId,
        body,
        subject: touch.subject ?? undefined,
      });
      if (r.status === "ok") {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    });
  }

  return (
    <div className="tpstep">
      <div className="tpstep-head">
        <span className="tpstep-no">
          Touch {seq} of {of}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <button
            type="button"
            className={`tpsent${sent ? " on" : ""}`}
            onClick={() => onSent(!sent)}
          >
            {sent ? "Sent ✓" : "Mark sent"}
          </button>
        </span>
      </div>
      {touch.subject ? (
        <div className="tpstep-no" style={{ marginBottom: 4 }}>
          {touch.subject}
        </div>
      ) : null}
      <textarea
        className="tpedit"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label={`Touch ${seq} body for ${touch.businessName}`}
      />
      {touch.pains.length > 0 ? (
        <div className="tpstep-chips">
          {touch.pains.map((p, i) => (
            <span
              key={i}
              className={`ppchip ${painGroupClass(p.group)}`}
              title={p.title}
            >
              {p.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="tpstep-actions">
        <button type="button" className="lk" onClick={save}>
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </div>
  );
}

function BulkStatusButton({ onPick }: { onPick: (s: LeadStatus) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="bb primary"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Set status ▾
      </button>
      {open ? (
        <div
          className="popmenu"
          role="menu"
          style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0 }}
        >
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                margin: "2px 0",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
            >
              <span className={`statpill st-${s}`}>{titleCase(s)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function avg(touches: number, businesses: number): string {
  if (businesses === 0) return "0";
  return (touches / businesses).toFixed(1);
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
