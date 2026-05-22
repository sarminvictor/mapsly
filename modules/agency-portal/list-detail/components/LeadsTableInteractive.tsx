"use client";

/**
 * LeadsTableInteractive · client island that owns:
 *
 *   - Row-level selection (checkbox state · "select all in view"
 *     header behaviour delegated to the parent table semantics)
 *   - Status-pill cycle-on-click with `useOptimistic` so Maria / Tom
 *     see the new pill instantly per
 *     `.claude/rules/realtime-and-optimistic.md`
 *   - BulkActionBar mounting + per-bulk-action dispatch
 *
 * The page passes in pre-shaped LeadRowData[] · keeps the data
 * pipeline server-side and the interactive bits client-side. This
 * is the same pattern we use elsewhere (ShareLinkButton, etc.).
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Bulk-action bar appears the moment ≥ 1 row is selected
 *   - Status pill cycles: NEW → CONTACTED → REPLIED → WON
 *   - LOST and HIDDEN reachable from the bulk bar only
 *
 * Per `.claude/rules/accessibility.md`:
 *   - Each interactive cell is keyboard-reachable
 *   - aria-live="polite" on the bulk bar via the underlying
 *     `BulkActionBar` component
 *   - Status pills carry aria-label with the destination state
 */

import {
  startTransition,
  useCallback,
  useMemo,
  useOptimistic,
  useState,
} from "react";

import { Link } from "@/i18n/navigation";
import { BulkActionBar } from "@/modules/agency-portal/components/BulkActionBar";
import {
  LeadRow,
  type LeadRowSignal,
} from "@/modules/agency-portal/components/LeadRow";
import {
  LeadsTable,
  LeadsTableBody,
  LeadsTableHeader,
  LeadsTableHeaderCell,
  LeadsTableRow,
} from "@/modules/agency-portal/components/LeadsTable";
import type { LeadStatusValue } from "@/modules/agency-portal/components/StatusPill";

import { bulkSetLeadStatusAction, setLeadStatusAction } from "../actions";

/* ============================================================ types */

export interface InteractiveLeadRowData {
  id: string;
  businessId: string;
  businessName: string;
  meta?: string;
  avatar: string;
  avatarTone: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  signals: LeadRowSignal[];
  status: LeadStatusValue;
  statusDwell?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export interface LeadsTableInteractiveLabels {
  selectAria: string;
  business: string;
  whyQualified: string;
  status: string;
  contact: string;
  actions: string;
  caption: string;
  openLabel: string;
  openAria: (business: string) => string;
  noContact: string;
  selectedNoun: (count: number) => string;
  bulkMarkContacted: string;
  bulkMarkReplied: string;
  bulkMarkLost: string;
  bulkHide: string;
  bulkClear: string;
  statusError: string;
}

export interface LeadsTableInteractiveProps {
  leads: InteractiveLeadRowData[];
  labels: LeadsTableInteractiveLabels;
}

/* =================================================== component */

/** Next state in the cycle: NEW → CONTACTED → REPLIED → WON → NEW. */
function nextStatus(current: LeadStatusValue): LeadStatusValue {
  switch (current) {
    case "NEW":
      return "CONTACTED";
    case "CONTACTED":
      return "REPLIED";
    case "REPLIED":
      return "WON";
    case "WON":
      return "NEW";
    // LOST + HIDDEN don't cycle on click; they're set via the
    // BulkActionBar. Clicking a LOST/HIDDEN pill resets to NEW so
    // accidental misclicks are recoverable in one more click.
    case "LOST":
    case "HIDDEN":
    default:
      return "NEW";
  }
}

interface OptimisticStatusMap {
  [leadId: string]: LeadStatusValue;
}

export function LeadsTableInteractive({
  leads,
  labels,
}: LeadsTableInteractiveProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusOverrides, applyOverride] = useOptimistic<
    OptimisticStatusMap,
    { leadId: string; newStatus: LeadStatusValue }
  >({}, (state, action) => ({
    ...state,
    [action.leadId]: action.newStatus,
  }));
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const handleStatusClick = useCallback(
    (leadId: string, currentStatus: LeadStatusValue) => {
      const newStatus = nextStatus(currentStatus);
      setError(null);
      startTransition(async () => {
        applyOverride({ leadId, newStatus });
        const res = await setLeadStatusAction({ leadId, status: newStatus });
        if (res.status !== "ok") {
          // The optimistic update auto-reverts on transition rejection.
          // Surface a status note for screen readers + UI.
          setError(labels.statusError);
        }
      });
    },
    [applyOverride, labels.statusError],
  );

  const handleBulkStatus = useCallback(
    (newStatus: LeadStatusValue) => {
      const ids = Array.from(selected);
      if (ids.length === 0) return;
      setError(null);
      startTransition(async () => {
        ids.forEach((id) => applyOverride({ leadId: id, newStatus }));
        const res = await bulkSetLeadStatusAction({
          leadIds: ids,
          status: newStatus,
        });
        if (res.status === "ok") {
          setSelected(new Set());
        } else {
          setError(labels.statusError);
        }
      });
    },
    [applyOverride, labels.statusError, selected],
  );

  const rows = useMemo(
    () =>
      leads.map((lead) => {
        const effectiveStatus = statusOverrides[lead.id] ?? lead.status;
        return { lead, effectiveStatus };
      }),
    [leads, statusOverrides],
  );

  return (
    <>
      <LeadsTable density="comfortable" caption={labels.caption}>
        <LeadsTableHeader>
          <LeadsTableRow>
            <LeadsTableHeaderCell select aria-label={labels.selectAria} />
            <LeadsTableHeaderCell>{labels.business}</LeadsTableHeaderCell>
            <LeadsTableHeaderCell>{labels.whyQualified}</LeadsTableHeaderCell>
            <LeadsTableHeaderCell>{labels.status}</LeadsTableHeaderCell>
            <LeadsTableHeaderCell>{labels.contact}</LeadsTableHeaderCell>
            <LeadsTableHeaderCell align="right">
              {labels.actions}
            </LeadsTableHeaderCell>
          </LeadsTableRow>
        </LeadsTableHeader>
        <LeadsTableBody>
          {rows.map(({ lead, effectiveStatus }) => {
            const isSelected = selected.has(lead.id);
            return (
              <LeadRow
                key={lead.id}
                id={lead.id}
                business={{
                  name: lead.businessName,
                  meta: lead.meta,
                  avatar: lead.avatar,
                  avatarTone: lead.avatarTone,
                }}
                signals={lead.signals}
                status={effectiveStatus}
                statusDwell={lead.statusDwell ?? undefined}
                onStatusClick={() =>
                  handleStatusClick(lead.id, effectiveStatus)
                }
                contact={
                  lead.contactEmail || lead.contactPhone ? (
                    <>
                      {lead.contactEmail ? (
                        <span>{lead.contactEmail}</span>
                      ) : null}
                      {lead.contactEmail && lead.contactPhone ? <br /> : null}
                      {lead.contactPhone ? (
                        <span>{lead.contactPhone}</span>
                      ) : null}
                    </>
                  ) : (
                    <span style={{ color: "var(--color-text-3)" }}>
                      {labels.noContact}
                    </span>
                  )
                }
                action={
                  <Link
                    href={{
                      pathname: "/prospect/[businessId]",
                      params: { businessId: lead.businessId },
                    }}
                    data-testid={`lead-open-${lead.id}`}
                    aria-label={labels.openAria(lead.businessName)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "6px 10px",
                      borderRadius: 6,
                      fontSize: 11.5,
                      fontWeight: 600,
                      background: "var(--color-agency-indigo)",
                      color: "#fff",
                      border: "1px solid var(--color-agency-indigo)",
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {labels.openLabel}
                  </Link>
                }
                checked={isSelected}
                onSelectChange={() => toggle(lead.id)}
                selectable
              />
            );
          })}
        </LeadsTableBody>
      </LeadsTable>

      {error ? (
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: "10px 0 0",
            fontSize: 12,
            color: "var(--color-alert)",
          }}
        >
          {error}
        </p>
      ) : null}

      <BulkActionBar
        selectedCount={selected.size}
        meta={labels.selectedNoun(selected.size)}
      >
        <button
          type="button"
          onClick={() => handleBulkStatus("CONTACTED")}
          style={bulkButton()}
          data-testid="bulk-mark-contacted"
        >
          {labels.bulkMarkContacted}
        </button>
        <button
          type="button"
          onClick={() => handleBulkStatus("REPLIED")}
          style={bulkButton()}
          data-testid="bulk-mark-replied"
        >
          {labels.bulkMarkReplied}
        </button>
        <button
          type="button"
          onClick={() => handleBulkStatus("LOST")}
          style={bulkButton()}
          data-testid="bulk-mark-lost"
        >
          {labels.bulkMarkLost}
        </button>
        <button
          type="button"
          onClick={() => handleBulkStatus("HIDDEN")}
          style={bulkButton()}
          data-testid="bulk-hide"
        >
          {labels.bulkHide}
        </button>
        <button
          type="button"
          onClick={clear}
          style={{
            ...bulkButton(),
            background: "transparent",
            border: "1px solid rgba(255,255,255,.25)",
          }}
          data-testid="bulk-clear"
        >
          {labels.bulkClear}
        </button>
      </BulkActionBar>
    </>
  );
}

function bulkButton(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    background: "rgba(255,255,255,.10)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,.18)",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}
