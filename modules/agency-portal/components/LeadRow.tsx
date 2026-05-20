import * as React from "react";
import { cn } from "@/lib/ui/cn";
import {
  LeadsTableCell,
  LeadsTableRow,
  BusinessCell,
  SignalChip,
  SignalChipGroup,
  type SignalChipTone,
} from "./LeadsTable";
import { StatusPill, type LeadStatusValue } from "./StatusPill";

/**
 * LeadRow · the canonical lead-table row.
 *
 * Composes the agency-portal primitives (BusinessCell, SignalChipGroup,
 * StatusPill, LeadsTableCell, LeadsTableRow) into the row layout that
 * matches `_design/agency/list-detail.html`. Use this for the common
 * "qualified leads" listing on `/(agency)/lists/[id]`.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Avatar + business name (left)
 *   - "Why qualified" signal chips (mid · max 4 chips by convention)
 *   - Status pill (right of mid)
 *   - Contact mono block (next)
 *   - Action button (far right · indigo primary)
 *
 * Caller composes:
 *
 *   <LeadsTable density="comfortable">
 *     <LeadsTableHeader>...</LeadsTableHeader>
 *     <LeadsTableBody>
 *       <LeadRow
 *         business={{ name: "Solea Brickell Spa",
 *                     meta: "5 yrs · 4.4★ · 342 reviews · added 3d ago",
 *                     avatar: "SO", avatarTone: 5 }}
 *         signals={[
 *           { tone: "warn", label: "Perf 58" },
 *           { tone: "alert", label: "LCP 3.4s" },
 *           { tone: "teal", label: "no schema" }
 *         ]}
 *         status="NEW"
 *         contact={<>{"maria@…"}<br/>{"(786) …"}</>}
 *         action={<Link href="/prospect/.">Open →</Link>}
 *       />
 *     </LeadsTableBody>
 *   </LeadsTable>
 *
 * Server-component-safe (no event handlers in default render). Optional
 * `onSelectChange` makes the leading checkbox interactive — wire from a
 * client wrapper that holds the selection state.
 */

export interface LeadRowSignal {
  tone?: SignalChipTone;
  label: React.ReactNode;
  /** Optional hover tooltip · explains the signal trigger. */
  title?: string;
}

export interface LeadRowProps {
  /** Stable id · used as React key (caller maps lead.id). */
  id?: string;
  /** Business display block · name + meta + avatar. */
  business: {
    name: React.ReactNode;
    meta?: React.ReactNode;
    avatar?: React.ReactNode;
    avatarTone?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  };
  /** "Why qualified" signal chips. Caller picks 2–4 most impactful. */
  signals?: ReadonlyArray<LeadRowSignal>;
  /** Lead status (Prisma LeadStatus enum). */
  status: LeadStatusValue;
  /** Optional dwell suffix for status pill ("3d", "interested"). */
  statusDwell?: React.ReactNode;
  /** Click handler on the status pill (cycle / popover). */
  onStatusClick?: React.MouseEventHandler<HTMLButtonElement>;
  /** Contact block · typically mono email + phone. */
  contact?: React.ReactNode;
  /** Trailing action button · typically the "Open →" Link. */
  action?: React.ReactNode;
  /** Row is part of a multi-select. Pair with checked + onSelectChange. */
  selectable?: boolean;
  /** Whether the row is currently selected. */
  checked?: boolean;
  /** Caller wires multi-select state. */
  onSelectChange?: (next: boolean) => void;
  /** Optional id for the checkbox input (a11y). */
  checkboxId?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function LeadRow({
  id,
  business,
  signals,
  status,
  statusDwell,
  onStatusClick,
  contact,
  action,
  selectable = true,
  checked = false,
  onSelectChange,
  checkboxId,
  className,
  style,
}: LeadRowProps) {
  const inputId = checkboxId ?? (id ? `lead-${id}` : undefined);

  return (
    <LeadsTableRow
      selected={checked}
      data-lead-id={id}
      className={cn("mapsly-lead-row", className)}
      style={style}
    >
      {selectable ? (
        <LeadsTableCell select>
          <input
            id={inputId}
            type="checkbox"
            checked={checked}
            onChange={
              onSelectChange
                ? (e) => onSelectChange(e.target.checked)
                : undefined
            }
            aria-label={
              typeof business.name === "string"
                ? `Select ${business.name}`
                : "Select lead"
            }
            style={{
              width: 14,
              height: 14,
              cursor: onSelectChange ? "pointer" : "default",
            }}
          />
        </LeadsTableCell>
      ) : null}

      <LeadsTableCell>
        <BusinessCell
          name={business.name}
          meta={business.meta}
          avatar={business.avatar}
          avatarTone={business.avatarTone}
        />
      </LeadsTableCell>

      <LeadsTableCell>
        {signals != null && signals.length > 0 ? (
          <SignalChipGroup>
            {signals.map((s, i) => (
              <SignalChip key={i} tone={s.tone ?? "neutral"} title={s.title}>
                {s.label}
              </SignalChip>
            ))}
          </SignalChipGroup>
        ) : (
          <span style={{ color: "var(--color-text-3)", fontSize: 12 }}>—</span>
        )}
      </LeadsTableCell>

      <LeadsTableCell>
        <StatusPill
          status={status}
          dwell={statusDwell}
          onClick={onStatusClick}
          as={onStatusClick ? "button" : "span"}
          showDisclosure={onStatusClick != null}
        />
      </LeadsTableCell>

      <LeadsTableCell>
        {contact != null ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--color-text-2)",
              lineHeight: 1.5,
            }}
          >
            {contact}
          </div>
        ) : (
          <span style={{ color: "var(--color-text-3)", fontSize: 12 }}>—</span>
        )}
      </LeadsTableCell>

      <LeadsTableCell align="right">{action}</LeadsTableCell>
    </LeadsTableRow>
  );
}
