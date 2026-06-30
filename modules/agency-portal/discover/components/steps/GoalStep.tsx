"use client";

// GoalStep · "What do you sell?" — the goal-template picker (step 1 of the
// Get-leads flow). LEFT: a searchable list of goal templates, each a saved
// bundle of expert signals. RIGHT: an editable signal-detail panel showing
// exactly which signals the picked goal uses, grouped by outcome, with on/off
// switches + the recipe behind each. Picking a goal sets the active signal set
// (the GoalState — the single source of truth read read-only downstream).
//
// Uses the prototype's ported classes (.goalsplit/.tplrow/.sigcard/.badge-sig …
// from agency-portal.css). English-only for now (the app runs English-only).

import { useMemo, useState } from "react";

import {
  GOAL_TEMPLATES,
  OUTCOME_GROUPS,
  SIG_META,
  templateByKey,
  type OutcomeGroup,
} from "../../goal-templates";
import { loadGoalFrom, type GoalState } from "../../flow-types";

export function GoalStep({
  goal,
  onChange,
  onContinue,
}: {
  goal: GoalState | null;
  onChange: (next: GoalState) => void;
  onContinue: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return GOAL_TEMPLATES.filter((t) => t.key !== "custom");
    return GOAL_TEMPLATES.filter((t) => {
      if (t.key === "custom") return false;
      const hay = [
        t.title,
        t.who,
        t.out,
        t.category,
        ...t.filters.map((f) => SIG_META[f.key]?.title ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [search]);

  function pick(key: string) {
    const tpl = templateByKey(key);
    if (!tpl) return;
    onChange(loadGoalFrom(tpl));
  }

  const activeCount = goal ? goal.filters.filter((f) => f.on).length : 0;

  return (
    <div className="goalsplit">
      {/* LEFT · searchable template list */}
      <div className="goalleft">
        <div className="tpl-search">
          <span className="si" aria-hidden="true">
            🔎
          </span>
          <input
            id="tplSearch"
            placeholder="Search goals — web, ads, SEO, reputation, booking…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            aria-label="Search goal templates"
          />
        </div>

        <div className="tpllist" id="tplGrid">
          <div className="tpllist-sub">Templates</div>
          {filtered.length === 0 ? (
            <div className="note" style={{ padding: "12px 2px" }}>
              No goals match “{search}”. Try web, ads, SEO, or reputation.
            </div>
          ) : (
            filtered.map((t) => {
              const count = t.filters.filter((f) => f.on).length;
              const sel = goal?.base === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  className={`tplrow${sel ? " sel" : ""}`}
                  aria-pressed={sel}
                  onClick={() => pick(t.key)}
                >
                  <span className="tplrow-ic" aria-hidden="true">
                    {t.icon}
                  </span>
                  <span className="tplrow-body">
                    <span className="tplrow-name">
                      {t.title}
                      <span className="badge-data">{t.category}</span>
                    </span>
                    <span className="tplrow-who">{t.who}</span>
                  </span>
                  <span className="tplrow-meta">{count} signals</span>
                </button>
              );
            })
          )}
        </div>

        {/* always-visible Custom row */}
        <div
          className={`tpl-custom${goal?.base === "custom" ? " sel" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => pick("custom")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") pick("custom");
          }}
        >
          <span className="tplic" aria-hidden="true">
            ⚙️
          </span>
          <span className="tplrow-body">
            <span className="tplrow-name">
              Custom <span className="badge-data">blank</span>
            </span>
            <span className="tplrow-who">
              Start from scratch — pick exactly the signals you want.
            </span>
          </span>
        </div>
      </div>

      {/* RIGHT · sticky detail / empty state */}
      {goal ? (
        <aside className="goalright" id="tplDetail" aria-live="polite">
          <div className="gd-head">
            <span className="gd-ic" aria-hidden="true">
              {templateByKey(goal.base)?.icon ?? "⚙️"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                className="gd-nameinput"
                value={goal.name}
                aria-label="Goal name"
                onChange={(e) =>
                  onChange({ ...goal, name: e.target.value, customized: true })
                }
              />
              <div className="gd-sub">
                {goal.customized ? (
                  <span className="gd-custom">Customized</span>
                ) : (
                  "Preset signal bundle"
                )}{" "}
                · {activeCount} active signal{activeCount === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          <p className="gd-intro">
            These <b>expert signals</b> decide who we target. The preset already
            works — keep it as-is, or toggle signals on and off as you like.
          </p>

          <div id="filters" className="gd-sigs">
            <SignalGroups goal={goal} onChange={onChange} />
          </div>

          <div className="gd-reassure">
            ✓ No pressure — the preset is a great start. Tune signals here, or
            later on your leads table.
          </div>

          <div className="gd-actions">
            <button type="button" className="btn primary" onClick={onContinue}>
              Choose your market →
            </button>
            <span className="note">
              Set signals once here — next is just where to look.
            </span>
          </div>
        </aside>
      ) : (
        <aside className="goalright empty" id="tplDetail" aria-live="polite">
          <div className="goalempty">
            <div className="ge-ic" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0f172a"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="12" cy="12" r="0.5" fill="#0f172a" />
              </svg>
            </div>
            <h3>Pick a goal to see who it finds</h3>
            <p>
              This panel shows exactly which expert signals each goal uses, the
              recipe behind each, and lets you tune them right here.
            </p>
            <ul className="ge-tips">
              <li>
                <b>Most agencies start</b> with Website redesign or Local SEO.
              </li>
              <li>
                <b>Selling a tool?</b> Try the Booking-tool SaaS goal.
              </li>
              <li>
                <b>Want full control?</b> Start from Custom.
              </li>
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}

/** Render the active filters grouped by OUTCOME bucket. */
function SignalGroups({
  goal,
  onChange,
}: {
  goal: GoalState;
  onChange: (next: GoalState) => void;
}) {
  function toggle(key: string) {
    onChange({
      ...goal,
      customized: true,
      filters: goal.filters.map((f) =>
        f.key === key ? { ...f, on: !f.on } : f,
      ),
    });
  }

  // Bucket the goal's filters by SIG_META group, preserving group order.
  const byGroup = new Map<OutcomeGroup, typeof goal.filters>();
  for (const f of goal.filters) {
    const meta = SIG_META[f.key];
    if (!meta) continue;
    const arr = byGroup.get(meta.group) ?? [];
    arr.push(f);
    byGroup.set(meta.group, arr);
  }

  return (
    <>
      {OUTCOME_GROUPS.filter((g) => byGroup.has(g.key)).map((g) => (
        <div className="outgrp" key={g.key}>
          <div className="ohead">
            <h4>{g.label}</h4>
            <span className="ov">{g.value}</span>
          </div>
          {(byGroup.get(g.key) ?? []).map((f) => {
            const meta = SIG_META[f.key]!;
            return (
              <div className={`sigcard${f.on ? " added" : ""}`} key={f.key}>
                <div className="sctop">
                  <div className="scname">
                    {meta.title}
                    <span
                      className={
                        meta.kind === "signal" ? "badge-sig" : "badge-data"
                      }
                    >
                      {meta.kind === "signal" ? "SIGNAL" : "DATA"}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={f.on}
                    aria-label={`Toggle ${meta.title}`}
                    className={`sigc-sw${f.on ? " on" : ""}`}
                    style={{ marginLeft: "auto" }}
                    onClick={() => toggle(f.key)}
                  />
                </div>
                <div className="scmeans">{meta.means}</div>
                <div className="scpitch">{meta.pitch}</div>
                <div className="screcipe">
                  <span className="rlabel">How it works</span>
                  {meta.recipe.map((r, i) => (
                    <span className="rchip" key={i}>
                      {r}
                    </span>
                  ))}
                </div>
                <div className="scfoot">
                  <span className="scstrength">
                    Confidence
                    <span className="conf">
                      {[1, 2, 3].map((n) => (
                        <i key={n} className={n <= meta.conf ? "on" : ""} />
                      ))}
                    </span>
                  </span>
                  <span className="note" style={{ marginLeft: "auto" }}>
                    {f.why}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
