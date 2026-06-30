"use client";

// WorkbenchShell · the tabbed client shell for the leads workbench. Renders the
// prototype `.wtabs` tablist (Leads / Touchpoints with live counts) and switches
// between the two tab components, which share the same saved-list set. State is
// per-tab inside each component; this shell only owns which tab is visible.
//
// Per .claude/rules/cache-components.md Pattern 4: it receives only plain
// serialized rows/touches/stats — no function props cross the boundary.

import { useState } from "react";

import { LeadsWorkbench, type LeadsWorkbenchProps } from "./LeadsWorkbench";
import { TouchpointsTab, type TouchpointsTabProps } from "./TouchpointsTab";

export interface WorkbenchShellProps {
  leads: LeadsWorkbenchProps;
  touchpoints: TouchpointsTabProps;
}

export function WorkbenchShell({ leads, touchpoints }: WorkbenchShellProps) {
  const [tab, setTab] = useState<"leads" | "touch">("leads");

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
          Leads <span className="ct">{leads.rows.length}</span>
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
    </div>
  );
}
