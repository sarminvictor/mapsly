"use client";

/**
 * URL-driven filter bar for /admin/businesses. State-as-URL pattern:
 * every filter changes the page's searchParams so the page server-
 * re-renders with the new query. Bookmarkable + shareable.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";

interface Props {
  cities: string[];
  countries: string[];
  categories: string[];
}

const STATUS_OPTIONS = [
  { value: "QUALIFIED", label: "Qualified" },
  { value: "DISQUALIFIED", label: "Disqualified" },
  { value: "UNREACHABLE", label: "Unreachable" },
  { value: "FAILED", label: "Failed" },
  { value: "NOT_QUALIFIED", label: "Not qualified" },
  { value: "ALL", label: "All" },
];

const FRESHNESS_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "NEVER", label: "Never pulled" },
  { value: "IN_FLIGHT", label: "In flight" },
  { value: "STALE_7D", label: "Stale > 7d" },
  { value: "STALE_30D", label: "Stale > 30d" },
  { value: "FRESH", label: "Fresh < 7d" },
];

export function FilterBar({ cities, countries, categories }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string | null): void {
    const next = new URLSearchParams(params);
    if (value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    next.delete("cursor"); // any filter change resets pagination
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`);
    });
  }

  const status = params.get("status") ?? "QUALIFIED";
  const freshness = params.get("freshness") ?? "ALL";
  const city = params.get("city") ?? "";
  const country = params.get("country") ?? "";
  const category = params.get("category") ?? "";
  const hasEmail = params.get("hasEmail") ?? "";
  const q = params.get("q") ?? "";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 8,
        opacity: pending ? 0.7 : 1,
        marginBottom: 18,
      }}
    >
      <Select
        label="Status"
        value={status}
        options={STATUS_OPTIONS}
        onChange={(v) => update("status", v)}
      />
      <Select
        label="Reviews"
        value={freshness}
        options={FRESHNESS_OPTIONS}
        onChange={(v) => update("freshness", v)}
      />
      <Select
        label="City"
        value={city}
        options={[
          { value: "", label: "All" },
          ...cities.map((c) => ({ value: c, label: c })),
        ]}
        onChange={(v) => update("city", v)}
      />
      <Select
        label="Country"
        value={country}
        options={[
          { value: "", label: "All" },
          ...countries.map((c) => ({ value: c, label: c })),
        ]}
        onChange={(v) => update("country", v)}
      />
      <Select
        label="Category"
        value={category}
        options={[
          { value: "", label: "All" },
          ...categories.map((c) => ({ value: c, label: c })),
        ]}
        onChange={(v) => update("category", v)}
      />
      <Select
        label="Email"
        value={hasEmail}
        options={[
          { value: "", label: "All" },
          { value: "true", label: "Has email" },
          { value: "false", label: "No email" },
        ]}
        onChange={(v) => update("hasEmail", v)}
      />
      <div
        style={{
          gridColumn: "span 2",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <label
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--admin-text-3)",
            marginBottom: 4,
          }}
        >
          Search
        </label>
        <input
          type="text"
          defaultValue={q}
          placeholder="Business or city…"
          className="admin-input"
          onBlur={(e) => update("q", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              update("q", (e.target as HTMLInputElement).value);
            }
          }}
          style={{ padding: "5px 8px", fontSize: 12 }}
        />
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <label
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--admin-text-3)",
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="admin-input"
        style={{ padding: "5px 8px", fontSize: 12 }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
