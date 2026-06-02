"use client";

/**
 * Client wrapper that holds bulk-selection state. Wraps the table body
 * (rows + checkboxes) and the sticky BulkActionsBar so the parent page
 * stays a server component.
 *
 * Server-rendered: header + stats + filter bar (in page.tsx)
 * Client-rendered: checkbox state + bulk bar (here)
 */

import { useState } from "react";

import { BulkActionsBar } from "./BulkActionsBar";
import { RowActionButtons } from "./RowActionButtons";
import type { BusinessRow } from "../queries";

interface Props {
  rows: BusinessRow[];
}

export function BusinessTable({ rows }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  return (
    <>
      <div className="admin-table-wrapper" style={{ overflowX: "auto" }}>
        <table
          className="admin-table"
          style={{ width: "100%", minWidth: 1100 }}
        >
          <thead>
            <tr>
              <Th style={{ width: 30 }}>
                <input
                  type="checkbox"
                  checked={selected.size === rows.length && rows.length > 0}
                  aria-label="Select all"
                  onChange={toggleAll}
                />
              </Th>
              <Th>Business</Th>
              <Th>Status</Th>
              <Th align="right">⭐</Th>
              <Th align="right">Reviews</Th>
              <Th align="right">In DB</Th>
              <Th align="right">Svcs</Th>
              <Th>Email</Th>
              <Th>Last pull</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  style={{
                    textAlign: "center",
                    padding: "32px 12px",
                    color: "var(--admin-text-2)",
                    fontSize: 13,
                  }}
                >
                  No businesses match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <BusinessRowView
                  key={r.id}
                  row={r}
                  selected={selected.has(r.id)}
                  onToggle={() => toggleOne(r.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <BulkActionsBar
        selectedIds={Array.from(selected)}
        onClear={() => setSelected(new Set())}
      />
    </>
  );
}

function BusinessRowView({
  row,
  selected,
  onToggle,
}: {
  row: BusinessRow;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <tr style={selected ? { background: "rgba(91,61,245,0.08)" } : undefined}>
      <Td>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${row.name}`}
        />
      </Td>
      <Td>
        <div
          style={{ fontWeight: 600, color: "var(--admin-text)", fontSize: 13 }}
        >
          {row.name}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--admin-text-3)",
            marginTop: 2,
          }}
        >
          {[row.city, row.country].filter(Boolean).join(" · ")} · {row.category}
        </div>
        {row.landingPath ? (
          <a
            href={row.landingPath}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block",
              marginTop: 4,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              color: "#c3553a",
              textDecoration: "none",
            }}
            title="Open this business's personalized landing page"
          >
            Landing ↗
          </a>
        ) : null}
      </Td>
      <Td>
        <span
          className="admin-pill"
          data-status={mapStatusToPill(row.qualificationStatus)}
        >
          {row.qualificationStatus}
        </span>
        {row.qualificationFlags.length > 0 ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "var(--admin-text-3)",
              marginTop: 4,
              maxWidth: 160,
            }}
          >
            {row.qualificationFlags.join(", ")}
          </div>
        ) : null}
      </Td>
      <Td align="right">{row.rating == null ? "—" : row.rating.toFixed(1)}</Td>
      <Td align="right">{row.reviewCount ?? 0}</Td>
      <Td align="right">{row.reviewsInDb}</Td>
      <Td align="right">{row.servicesCount}</Td>
      <Td>
        {row.emailDiscovered ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--admin-text-2)",
            }}
            title={row.emailDiscoverySource ?? ""}
          >
            {row.emailDiscovered}
          </span>
        ) : (
          <span style={{ color: "var(--admin-text-3)" }}>—</span>
        )}
      </Td>
      <Td>
        <PullStatusCell row={row} />
      </Td>
      <Td>
        <RowActionButtons
          businessId={row.id}
          hasInFlight={row.pendingReviewsTaskId != null}
          hasCid={row.reviewCount != null}
          hasWebsite={Boolean(row.website)}
        />
      </Td>
    </tr>
  );
}

function PullStatusCell({ row }: { row: BusinessRow }) {
  if (row.pendingReviewsTaskId) {
    return (
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--admin-gold)",
        }}
      >
        IN FLIGHT
      </span>
    );
  }
  if (row.reviewsLastDeltaAt) {
    return (
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--admin-text-2)",
        }}
        title={`Last delta: ${row.reviewsLastDeltaAt}`}
      >
        {relativeAgo(new Date(row.reviewsLastDeltaAt))}
      </span>
    );
  }
  if (row.reviewsFirstPulledAt) {
    return (
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--admin-text-2)",
        }}
        title={`First pull: ${row.reviewsFirstPulledAt}`}
      >
        Pulled once
      </span>
    );
  }
  return <span style={{ color: "var(--admin-text-3)" }}>Never</span>;
}

function mapStatusToPill(status: string): string {
  switch (status) {
    case "QUALIFIED":
      return "OK";
    case "DISQUALIFIED":
      return "WARN";
    case "UNREACHABLE":
      return "FAILED";
    case "FAILED":
      return "FAILED";
    default:
      return "PENDING";
  }
}

function relativeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) {
    const hours = Math.floor(ms / 3_600_000);
    return hours <= 1 ? "just now" : `${hours}h ago`;
  }
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function Th({
  children,
  align,
  style,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  style?: React.CSSProperties;
}) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "8px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--admin-text-3)",
        fontWeight: 600,
        borderBottom: "1px solid var(--admin-border)",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "10px",
        textAlign: align ?? "left",
        verticalAlign: "top",
        borderBottom: "1px solid var(--admin-border)",
        fontSize: 12,
        color: "var(--admin-text-2)",
      }}
    >
      {children}
    </td>
  );
}
