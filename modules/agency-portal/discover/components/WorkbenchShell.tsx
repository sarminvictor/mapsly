"use client";

// WorkbenchShell · the tabbed client shell for the leads workbench. Renders the
// prototype `.wtabs` tablist (Leads / Touchpoints with live counts) and switches
// between the two tab components, which share the same saved-list set. State is
// per-tab inside each component; this shell only owns which tab is visible.
//
// WP5-1/2 · the visible tab is URL-driven (`?tab=touch`, absent = Leads) so
// touch generation can deep-link to the Touchpoints tab after drafting, and a
// copied URL restores the view. router.replace without scroll — no history
// spam, no RSC data change (only `?page=` is server-read).
//
// Per .claude/rules/cache-components.md Pattern 4: it receives only plain
// serialized rows/touches/stats — no function props cross the boundary.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { LeadsWorkbench, type LeadsWorkbenchProps } from "./LeadsWorkbench";
import { TouchpointsTab, type TouchpointsTabProps } from "./TouchpointsTab";
import { EnrichMoreHost } from "./EnrichMoreHost";

export interface WorkbenchShellProps {
  leads: LeadsWorkbenchProps;
  touchpoints: TouchpointsTabProps;
}

export function WorkbenchShell({ leads, touchpoints }: WorkbenchShellProps) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: "leads" | "touch" = sp.get("tab") === "touch" ? "touch" : "leads";

  const setTab = useCallback(
    (next: "leads" | "touch") => {
      const params = new URLSearchParams(sp.toString());
      if (next === "leads") params.delete("tab");
      else params.set("tab", "touch");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  return (
    <div>
      <div className="wtabs" role="tablist" aria-label="Workspace tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "leads"}
          className={tab === "leads" ? "on" : undefined}
          onClick={() => setTab("leads")}
        >
          {/* Whole-set count when server-paginated (WP4-4) — the tab count is
              the honest total, not the loaded window. */}
          Leads{" "}
          <span className="ct">{leads.totalRows ?? leads.rows.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "touch"}
          className={tab === "touch" ? "on" : undefined}
          onClick={() => setTab("touch")}
        >
          Touchpoints <span className="ct">{touchpoints.touches.length}</span>
        </button>
      </div>

      {tab === "leads" ? (
        <LeadsWorkbench {...leads} />
      ) : (
        <TouchpointsTab {...touchpoints} />
      )}

      {/* WP5-3 · the in-workbench enrich sheet — opened via the enrich-sheet
          bus by the coverage CTA, drawer ghost accordions, and locked Fields
          rows. Mounted once at the shell so it survives tab switches. The same
          per-lead type-state map the table reads is threaded in so the sheet
          shows "N have · M to get" per data group over the scope. */}
      <EnrichMoreHost
        discoveryId={leads.discoveryId}
        coverageTypeStates={leads.coverageTypeStates}
      />
    </div>
  );
}
