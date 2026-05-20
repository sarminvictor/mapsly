import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * FilterRow · one editable row of the Hunter filter list.
 *
 * Per `.claude/rules/ui-ux-agency.md` and per the agency Hunter design:
 *   - Checkbox left · label + jargon-help mid · comparator + value right
 *   - Dense rows · inline-edited values · live count updates downstream
 *   - Active state pops with the indigo accent palette
 *   - "info-tip" indicator carries the plain-English explanation Tom
 *     can fall back to when a signal name is unfamiliar (per copy-voice)
 *
 * The filter UI is Mapsly's moat surface (60+ signals). This component is
 * the smallest editable unit. Caller composes many of these inside signal
 * groups (Website / Reviews / Search / Ads / Profile / Competitive / Biz).
 *
 * Three value shapes are supported via discriminated union:
 *   1. `numeric` — comparator picker + numeric input (+ optional unit suffix)
 *   2. `binary` — single-value pill toggle ("YES" / "NO" / "MISSING")
 *   3. `custom` — caller renders their own `<input>` / `<select>` in
 *      `controls` (e.g. between-range, multi-select)
 *
 * Server-component-safe if `onActiveChange` + `onValueChange` are omitted
 * (read-only display). Default render keeps event handlers as undefined so
 * a server tree can include this; a `'use client'` wrapper supplies them.
 */

export type FilterComparator = "<" | "≤" | "=" | "≥" | ">" | "between";

export type FilterRowKind =
  | {
      kind: "numeric";
      /** Available comparators · default ["<", "≤", "=", "≥", "between"]. */
      comparators?: ReadonlyArray<FilterComparator>;
      /** Currently selected comparator. */
      comparator: FilterComparator;
      /** Current numeric value (or string for free-form). */
      value: string | number;
      /** Optional unit displayed after the input · "%", "sec", "★", etc. */
      valueUnit?: React.ReactNode;
      /** HTML input width hint · "narrow" (64px) | "wide" (84px). */
      inputWidth?: "narrow" | "wide";
      onComparatorChange?: (next: FilterComparator) => void;
      onValueChange?: (next: string) => void;
    }
  | {
      kind: "binary";
      /** The binary value · displayed inside a pill ("YES", "NO", "MISSING"). */
      value: string;
    }
  | {
      kind: "custom";
      /** Caller-supplied controls. Inline-styled font, mono. */
      controls: React.ReactNode;
    };

export interface FilterRowProps {
  /** Stable id · used as React key when used inside .map. */
  id: string;
  /** Whether the filter is currently applied to the query. */
  active: boolean;
  /** Filter label · the signal's human-readable name. */
  label: React.ReactNode;
  /** Plain-English help · explains what this signal measures. Tom-friendly. */
  helpTip?: string;
  /** Discriminated union of value-shape variants. */
  value: FilterRowKind;
  /** Caller wires checkbox toggle (typically updates URL params or state). */
  onActiveChange?: (next: boolean) => void;
  /** Optional id for the checkbox input (a11y). */
  checkboxId?: string;
  className?: string;
  style?: React.CSSProperties;
}

const DEFAULT_COMPARATORS: ReadonlyArray<FilterComparator> = [
  "<",
  "≤",
  "=",
  "≥",
  "between",
];

const monoFont = "var(--font-mono)";

function FilterHelp({ tip }: { tip: string }) {
  return (
    <button
      type="button"
      aria-label={tip}
      title={tip}
      data-tip={tip}
      className="info-tip"
      tabIndex={0}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: "var(--color-bg-3)",
        color: "var(--color-text-3)",
        fontSize: 9,
        fontWeight: 700,
        cursor: "help",
        border: "none",
        padding: 0,
        flexShrink: 0,
        fontFamily: monoFont,
      }}
    >
      i
    </button>
  );
}

function NumericControls({
  comparator,
  comparators,
  value,
  valueUnit,
  inputWidth,
  active,
  onComparatorChange,
  onValueChange,
}: {
  comparator: FilterComparator;
  comparators: ReadonlyArray<FilterComparator>;
  value: string | number;
  valueUnit?: React.ReactNode;
  inputWidth?: "narrow" | "wide";
  active: boolean;
  onComparatorChange?: (next: FilterComparator) => void;
  onValueChange?: (next: string) => void;
}) {
  const accent = active ? "var(--color-agency-indigo)" : "var(--color-text)";
  const bg = active ? "#fff" : "var(--color-bg-2)";
  const border = active ? "rgba(91,61,245,.30)" : "var(--color-border)";
  const inputW = inputWidth === "wide" ? 84 : 64;
  const inputAlign = inputWidth === "wide" ? "left" : "right";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: monoFont,
        fontSize: 12,
      }}
    >
      <select
        value={comparator}
        onChange={
          onComparatorChange
            ? (e) => onComparatorChange(e.target.value as FilterComparator)
            : undefined
        }
        aria-label="Comparator"
        style={{
          padding: "4px 8px",
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 5,
          fontSize: 12,
          fontFamily: monoFont,
          fontWeight: 600,
          color: accent,
          cursor: "pointer",
        }}
      >
        {comparators.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={String(value)}
        onChange={
          onValueChange ? (e) => onValueChange(e.target.value) : undefined
        }
        aria-label="Filter value"
        style={{
          width: inputW,
          padding: "4px 8px",
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 5,
          fontSize: 12,
          fontFamily: monoFont,
          fontWeight: 600,
          color: accent,
          textAlign: inputAlign,
        }}
      />
      {valueUnit != null ? (
        <span
          style={{
            fontSize: 11,
            color: active ? accent : "var(--color-text-3)",
            fontWeight: 600,
            minWidth: 14,
          }}
        >
          {valueUnit}
        </span>
      ) : null}
    </div>
  );
}

function BinaryControl({ value, active }: { value: string; active: boolean }) {
  const bg = active ? "var(--color-agency-indigo)" : "var(--color-bg-3)";
  const fg = active ? "#fff" : "var(--color-text-3)";
  return (
    <span
      data-binary-value={value}
      style={{
        padding: "5px 11px",
        background: bg,
        borderRadius: 5,
        fontSize: 11,
        fontFamily: monoFont,
        fontWeight: 700,
        color: fg,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  );
}

export function FilterRow({
  id,
  active,
  label,
  helpTip,
  value,
  onActiveChange,
  checkboxId,
  className,
  style,
}: FilterRowProps) {
  const rootStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "24px 1fr auto",
    gap: 14,
    alignItems: "center",
    padding: "10px 14px",
    background: active ? "rgba(91,61,245,.10)" : "var(--color-bg-2)",
    border: `1px solid ${
      active ? "var(--color-agency-indigo)" : "var(--color-border)"
    }`,
    borderRadius: 9,
    transition: "background 150ms ease, border-color 150ms ease",
    ...style,
  };

  // Render the value column based on discriminant.
  let valueContent: React.ReactNode = null;
  if (value.kind === "numeric") {
    valueContent = (
      <NumericControls
        comparator={value.comparator}
        comparators={value.comparators ?? DEFAULT_COMPARATORS}
        value={value.value}
        valueUnit={value.valueUnit}
        inputWidth={value.inputWidth}
        active={active}
        onComparatorChange={value.onComparatorChange}
        onValueChange={value.onValueChange}
      />
    );
  } else if (value.kind === "binary") {
    valueContent = <BinaryControl value={value.value} active={active} />;
  } else {
    valueContent = (
      <span
        style={{
          fontFamily: monoFont,
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {value.controls}
      </span>
    );
  }

  const inputId = checkboxId ?? `filter-${id}`;

  return (
    <div
      className={cn("mapsly-filter-row", className)}
      data-filter-id={id}
      data-active={active ? "true" : "false"}
      data-audience="agency"
      style={rootStyle}
    >
      <label
        htmlFor={inputId}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          borderRadius: 4,
          background: active
            ? "var(--color-agency-indigo)"
            : "var(--color-bg-2)",
          border: `1.5px solid ${
            active ? "var(--color-agency-indigo)" : "var(--color-border)"
          }`,
          cursor: onActiveChange ? "pointer" : "default",
          flexShrink: 0,
        }}
      >
        <input
          id={inputId}
          type="checkbox"
          checked={active}
          onChange={
            onActiveChange ? (e) => onActiveChange(e.target.checked) : undefined
          }
          style={{
            opacity: 0,
            width: 0,
            height: 0,
            margin: 0,
            position: "absolute",
          }}
        />
        {active ? (
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 5,
              borderLeft: "2px solid #fff",
              borderBottom: "2px solid #fff",
              transform: "rotate(-45deg) translate(1px, -1px)",
            }}
          />
        ) : null}
      </label>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: active ? "var(--color-text)" : "var(--color-text-2)",
          }}
        >
          {label}
        </span>
        {helpTip ? <FilterHelp tip={helpTip} /> : null}
      </div>

      <div style={{ flexShrink: 0 }}>{valueContent}</div>
    </div>
  );
}
