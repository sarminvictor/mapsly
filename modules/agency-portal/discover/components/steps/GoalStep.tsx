"use client";

// GoalStep · "What do you sell?" — the goal-template picker (step 1 of the
// Get-leads flow). LEFT: a searchable list of goal templates, each a saved
// bundle of expert signals. RIGHT: an editable signal-detail panel showing
// exactly which signals the picked goal uses, grouped by outcome, as expandable
// cards: a collapsed row (toggle + name + badges + means + a How-it-works/Tune
// affordance) that opens into the recipe, the per-signal tune control, and (for
// composites) match-mode + per-condition toggles. Picking a goal sets the active
// signal set (the GoalState — the single source of truth read read-only later).
//
// Uses the prototype's ported classes (.goalsplit/.tplrow/.sigc/.badge-sig …
// from agency-portal.css). English-only for now (the app runs English-only).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { showToast } from "@/components/agency/Toast";
import {
  GOAL_TEMPLATES,
  OUTCOME_GROUPS,
  SIG_META,
  templateByKey,
  type OutcomeGroup,
  type SigMeta,
  type SignalSetting,
} from "../../goal-templates";
import {
  loadGoalFrom,
  type GoalFilter,
  type GoalState,
  type SignalTuneValue,
} from "../../flow-types";
import { buildDiscoverySignals } from "../../discovery-signals";
import {
  goalFromSavedTemplate,
  type SavedTemplateRow,
} from "../../saved-templates";
import {
  deleteGoalTemplateAction,
  saveGoalTemplateAction,
} from "../../template-actions";

export function GoalStep({
  goal,
  myTemplates = [],
  onChange,
  onContinue,
}: {
  goal: GoalState | null;
  /** The agency's saved templates (WP5-12) — rendered above the built-ins. */
  myTemplates?: SavedTemplateRow[];
  onChange: (next: GoalState) => void;
  onContinue: () => void;
}) {
  const [search, setSearch] = useState("");
  const [libOpen, setLibOpen] = useState(false);
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  // A signature of the goal AT THE MOMENT IT WAS SAVED — collapses the Save
  // button into a "Saved ✓" beat only while the goal is UNCHANGED. Keyed on the
  // content (name + signal set), not just the name, so editing a signal after
  // saving correctly flips the button back to "Save/Update" (never a false
  // "Saved ✓" over unsaved edits).
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const goalSig = goal ? `${goal.name} ${JSON.stringify(goal.filters)}` : "";

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

  // "My templates" honors the same search box (name + signal titles).
  const filteredMine = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myTemplates;
    return myTemplates.filter((t) => {
      const hay = [
        t.name,
        ...t.signals.map((s) => SIG_META[s.key]?.title ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [search, myTemplates]);

  function pick(key: string) {
    const tpl = templateByKey(key);
    if (!tpl) return;
    onChange(loadGoalFrom(tpl));
  }

  /** Load a saved template — pre-seeds the goal exactly like a built-in. */
  function pickMine(row: SavedTemplateRow) {
    onChange(goalFromSavedTemplate(row));
  }

  function saveAsTemplate() {
    if (!goal || saving) return;
    const { signals } = buildDiscoverySignals(goal.filters);
    if (signals.length === 0) {
      showToast("Turn on at least one signal to save a template", "error");
      return;
    }
    const payload = {
      name: goal.name,
      basedOnTemplate: goal.base === "custom" ? null : goal.base,
      signals,
    };
    startSaving(async () => {
      // Re-saving a LOADED template updates it in place (no duplicate); a fresh
      // goal creates. If the loaded row was deleted elsewhere (not_found), fall
      // back to a create so the user never loses their save.
      let wasUpdate = Boolean(goal.templateId);
      let r = await saveGoalTemplateAction({
        ...payload,
        templateId: goal.templateId,
      });
      if (r.status === "not_found") {
        r = await saveGoalTemplateAction(payload);
        wasUpdate = false;
      }
      if (r.status === "ok") {
        setSavedSig(goalSig);
        // Remember the row id so the NEXT save updates it instead of duplicating
        // (covers "saved a brand-new goal, then click Save again").
        if (goal.templateId !== r.templateId) {
          onChange({ ...goal, templateId: r.templateId });
        }
        showToast(
          wasUpdate
            ? `Updated "${goal.name}"`
            : `Saved "${goal.name}" to My templates`,
        );
        // The gallery lists server-loaded rows — refresh pulls the change in.
        router.refresh();
      } else if (r.status === "limit_reached") {
        showToast(
          `Template limit reached (${r.max}) — delete one first`,
          "error",
        );
      } else {
        showToast("Couldn't save the template — try again", "error");
      }
    });
  }

  function deleteMine(row: SavedTemplateRow) {
    if (
      !window.confirm(
        `Delete template "${row.name}"? Its ${row.signals.length} saved signal${row.signals.length === 1 ? "" : "s"} are lost.`,
      )
    ) {
      return;
    }
    startSaving(async () => {
      const r = await deleteGoalTemplateAction({ templateId: row.id });
      if (r.status === "ok") {
        showToast(`Deleted "${row.name}"`);
        router.refresh();
      } else {
        showToast("Couldn't delete the template", "error");
      }
    });
  }

  const activeCount = goal ? goal.filters.filter((f) => f.on).length : 0;
  // A saved-template row reads as selected when the working goal came from it.
  // Prefer the id (exact — survives a rename); fall back to name+base for legacy
  // goals loaded before templateId tracking shipped.
  const mineSelected = (t: SavedTemplateRow): boolean =>
    goal != null &&
    goal.customized &&
    (goal.templateId != null
      ? goal.templateId === t.id
      : goal.name === t.name && goal.base === (t.basedOnTemplate ?? "custom"));

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
          {/* WP5-12 · the agency's own saved playbooks, above the built-ins. */}
          {filteredMine.length > 0 ? (
            <>
              <div className="tpllist-sub">My templates</div>
              {filteredMine.map((t) => {
                const sel = mineSelected(t);
                return (
                  // Wrapper so the delete control is a REAL sibling button (not
                  // an interactive span nested inside the row button — invalid +
                  // undiscoverable). The `.tplrow-del` class gives it a clear
                  // coral-on-hover affordance and a keyboard focus ring.
                  <div key={t.id} className="tplrow-wrap">
                    <button
                      type="button"
                      className={`tplrow${sel ? " sel" : ""}`}
                      aria-pressed={sel}
                      onClick={() => pickMine(t)}
                    >
                      <span className="tplrow-ic" aria-hidden="true">
                        {t.basedOnTemplate
                          ? (templateByKey(t.basedOnTemplate)?.icon ?? "💾")
                          : "💾"}
                      </span>
                      <span className="tplrow-body">
                        <span className="tplrow-name">
                          {t.name}
                          <span className="badge-data">saved</span>
                        </span>
                        <span className="tplrow-who">
                          {t.basedOnTemplate
                            ? `Your tuned "${templateByKey(t.basedOnTemplate)?.title ?? t.basedOnTemplate}"`
                            : "Your saved signal bundle"}
                        </span>
                      </span>
                      <span className="tplrow-meta">
                        {t.signals.length} signals
                      </span>
                    </button>
                    <button
                      type="button"
                      className="tplrow-del"
                      aria-label={`Delete template ${t.name}`}
                      title="Delete template"
                      onClick={() => deleteMine(t)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </>
          ) : null}
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
              <GoalNameInput
                key={goal.base}
                value={goal.name}
                onCommit={(name) =>
                  onChange({ ...goal, name, customized: true })
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

          <button
            type="button"
            className="btn"
            style={{ marginTop: 6 }}
            onClick={() => setLibOpen(true)}
          >
            ＋ Add signal or raw data
          </button>

          {libOpen ? (
            <SignalLibrary
              goal={goal}
              onChange={onChange}
              onClose={() => setLibOpen(false)}
            />
          ) : null}

          <div className="gd-reassure">
            ✓ No pressure — the preset is a great start. Tune signals here, or
            later on your leads table.
          </div>

          <div className="gd-actions">
            <button type="button" className="btn primary" onClick={onContinue}>
              Choose your market →
            </button>
            {/* WP5-12 · save the tuned bundle as a personal template. Enabled
                once the goal is customized (a pristine preset is already a
                template — nothing to save). */}
            <button
              type="button"
              className="btn"
              disabled={!goal.customized || saving}
              title={
                !goal.customized
                  ? "Tune the preset first — the built-in is already saved"
                  : goal.templateId
                    ? "Save changes to this template (updates it in place)"
                    : "Save this tuned signal set to My templates"
              }
              onClick={saveAsTemplate}
            >
              {saving
                ? "Saving…"
                : savedSig === goalSig
                  ? "Saved ✓"
                  : goal.templateId
                    ? "Update template"
                    : "Save as template"}
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

/**
 * Goal-name field — buffered locally so typing stays smooth even though the goal
 * round-trips through the URL (every edit re-serializes the whole goal). Commits
 * on blur / Enter. Adopts an external value change (switching template) without
 * clobbering in-progress typing, and ignores the echo of its own commit so a
 * laggy URL update can never revert what the user just typed.
 */
function GoalNameInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (name: string) => void;
}) {
  // `value` seeds the buffer; the call site keys this component by `goal.base`,
  // so switching template remounts it with the new name. Within a goal, typing
  // stays local (smooth — no per-keystroke URL write) and commits to the
  // URL-backed goal on blur / Enter.
  const [local, setLocal] = useState(value);
  return (
    <input
      className="gd-nameinput"
      value={local}
      aria-label="Goal name"
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal-card helpers · faithfully ported from the prototype's
// isComposite / confDots / dataStatusBadge / defaultTune / setting renderers.
// (docs/portal-prototype.html ~10097–13012). The prototype keyed everything by
// the signal TITLE and used positional option arrays; here we key by SIG_META
// key and read the typed `{value,label,desc}` option objects.
// ─────────────────────────────────────────────────────────────────────────────

/** A SIGNAL is a composite — ≥2 recipe inputs, or it declares a defaultMatch. */
function isComposite(meta: SigMeta): boolean {
  return (
    (Array.isArray(meta.recipe) && meta.recipe.length >= 2) ||
    !!meta.defaultMatch
  );
}

/** Confidence dots, capped to the recipe length so a 1-input read can't show 3. */
function confDots(meta: SigMeta): number {
  const recipeLen = Array.isArray(meta.recipe) ? meta.recipe.length : 1;
  return Math.max(1, Math.min(meta.conf || 1, recipeLen, 3));
}

/** The effective setting for a signal — defaults to a plain strictness slider. */
function settingFor(meta: SigMeta): SignalSetting {
  return meta.setting ?? { type: "strictness" };
}

/** Lazily seed the tune value from the setting's default (prototype defaultSset). */
function defaultTune(setting: SignalSetting): SignalTuneValue {
  switch (setting.type) {
    case "scale":
      return { kind: "scale", bands: (setting.def ?? []).slice() };
    case "platform":
      return { kind: "platform", values: (setting.def ?? []).slice() };
    case "mode":
      return { kind: "mode", value: setting.def };
    case "presence":
      return { kind: "presence", value: setting.def ?? "has" };
    case "strictness":
    default: {
      const lvl =
        setting.type === "strictness" && setting.def ? setting.def : "balanced";
      return { kind: "strictness", level: lvl };
    }
  }
}

/** Does a recipe carry a numeric cutoff a strictness slider can move? */
function hasNumericThreshold(meta: SigMeta): boolean {
  const joined = (meta.recipe ?? []).join(" · ");
  return /([<>≥≤])\s*[0-9]/.test(joined);
}

/** The data-status badge — computed / needs data / live data (prototype). */
function DataStatusBadge({ status }: { status: SigMeta["status"] }) {
  if (status === "deriv")
    return (
      <span className="ds ds-deriv" title="Computed from data we have">
        computed
      </span>
    );
  if (status === "roadmap")
    return (
      <span
        className="ds ds-road"
        title="Needs an enrichment we don’t run yet — shown for planning"
      >
        needs data
      </span>
    );
  return (
    <span className="ds ds-real" title="Backed by live data for this market">
      live data
    </span>
  );
}

/** Render the active filters grouped by OUTCOME bucket as expandable cards. */
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

  function remove(key: string) {
    onChange({
      ...goal,
      customized: true,
      filters: goal.filters.filter((f) => f.key !== key),
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
          {(byGroup.get(g.key) ?? []).map((f) => (
            <SignalCard
              key={f.key}
              filter={f}
              meta={SIG_META[f.key]!}
              onToggle={() => toggle(f.key)}
              onRemove={() => remove(f.key)}
              onChange={(next) =>
                onChange({
                  ...goal,
                  customized: true,
                  filters: goal.filters.map((x) =>
                    x.key === f.key ? next : x,
                  ),
                })
              }
            />
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * One expandable signal card — collapsed row (toggle + name + badges + means +
 * a How-it-works/Tune affordance) and, when open, the recipe, the per-type
 * setting control, (composites) match-mode + per-condition toggles, the 🔒
 * expertise note, and a Remove button. Mirrors the prototype's `sigCardHtml`.
 */
function SignalCard({
  filter,
  meta,
  onToggle,
  onRemove,
  onChange,
}: {
  filter: GoalFilter;
  meta: SigMeta;
  onToggle: () => void;
  onRemove: () => void;
  onChange: (next: GoalFilter) => void;
}) {
  const [open, setOpen] = useState(false);

  const on = filter.on !== false;
  const setting = settingFor(meta);
  const composite = isComposite(meta);
  const recipe =
    meta.recipe.length > 0 ? meta.recipe : [meta.comparator + " " + meta.value];

  // The control is empty for "none"-style settings (e.g. a pure boolean signal
  // with no numeric cutoff). When empty, the recipe block teaches what it reads.
  const hasControl = setting.type !== "strictness" || hasNumericThreshold(meta);
  const showRecipe = composite || !hasControl;
  const howLabel = open
    ? "Hide details"
    : composite || !hasControl
      ? "How it works"
      : "Tune signal";

  // Seed tune lazily (prototype ensureSetState) without mutating during render.
  const tune = filter.tune ?? defaultTune(setting);
  const match: "all" | "any" = filter.match ?? meta.defaultMatch ?? "all";

  return (
    <div className={`sigc ${on ? "" : "sigc-off"}`}>
      <div className="sigc-row">
        <button
          type="button"
          className={`sigc-sw ${on ? "on" : ""}`}
          role="switch"
          aria-checked={on}
          aria-label={`Toggle ${meta.title}`}
          onClick={onToggle}
        />
        <button
          type="button"
          className="sigc-main"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sigc-head">
            <span className="sigc-name">{meta.title}</span>{" "}
            {meta.kind === "signal" ? (
              <span className="badge-sig">SIGNAL</span>
            ) : (
              <span className="badge-data">DATA</span>
            )}{" "}
            <DataStatusBadge status={meta.status} />{" "}
            {composite ? (
              <span
                className="conf"
                aria-label={`confidence ${confDots(meta)} of 3`}
              >
                {[1, 2, 3].map((n) => (
                  <i key={n} className={n <= confDots(meta) ? "on" : ""} />
                ))}
              </span>
            ) : null}
          </span>
          <span className="sigc-mean">{meta.means || filter.why || ""}</span>
          <span className="sigc-how">
            {howLabel}{" "}
            <span
              className={`sigc-chev ${open ? "open" : ""}`}
              aria-hidden="true"
            >
              ▾
            </span>
          </span>
        </button>
      </div>

      {open ? (
        <div className="sigc-exp">
          {showRecipe ? (
            <>
              <div className="sigc-exp-h">How it works</div>
              {composite ? (
                <>
                  <MatchModeControl
                    value={match}
                    onChange={(m) => onChange({ ...filter, match: m })}
                  />
                  <ConditionLines
                    recipe={recipe}
                    conds={filter.conds}
                    onToggle={(idx) => {
                      const cur: Record<string, boolean> = { ...filter.conds };
                      const isOn = cur[String(idx)] !== false;
                      const next = { ...cur, [String(idx)]: !isOn };
                      // keep ≥1 condition on
                      const anyOn = recipe.some(
                        (_, j) => next[String(j)] !== false,
                      );
                      if (anyOn) onChange({ ...filter, conds: next });
                    }}
                  />
                </>
              ) : (
                <RecipeInputs recipe={recipe} />
              )}
            </>
          ) : null}

          {composite ? (
            <div className="sigc-lock">
              🔒 What it’s built from is our expertise — you choose which
              conditions count, not the recipe itself.
            </div>
          ) : null}

          {hasControl ? (
            <SettingControl
              setting={setting}
              value={tune}
              onChange={(t) => onChange({ ...filter, tune: t })}
            />
          ) : null}

          <button
            type="button"
            className="sigc-remove"
            aria-label={`Remove ${meta.title}`}
            onClick={onRemove}
          >
            Remove signal
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe rendering · plain-English condition lines + read-only recipe inputs.
// ─────────────────────────────────────────────────────────────────────────────

/** Wrap operator glyphs in <span class="op"> for accent, as the prototype does. */
function recipeCode(code: string) {
  const parts = code.split(/([<>≥≤=∈↑↓])/g);
  return parts.map((p, i) =>
    /^[<>≥≤=∈↑↓]$/.test(p) ? (
      <span className="op" key={i}>
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/** Read-only recipe inputs (single-input cards). Mirrors recipeInputsHtml. */
function RecipeInputs({ recipe }: { recipe: string[] }) {
  return (
    <div className="ingrid">
      {recipe.map((r, i) => (
        <div className="ingred" key={i}>
          <span className="igtext">
            {r}
            <span className="igcode">{recipeCode(r)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Composite per-condition toggle rows. Mirrors condLinesHtml. */
function ConditionLines({
  recipe,
  conds,
  onToggle,
}: {
  recipe: string[];
  conds: Record<string, boolean> | undefined;
  onToggle: (idx: number) => void;
}) {
  return (
    <div className="ingrid">
      {recipe.map((r, idx) => {
        const cur = conds ?? {};
        const lineOn = cur[String(idx)] !== false;
        return (
          <div className={`condline ${lineOn ? "" : "off"}`} key={idx}>
            <button
              type="button"
              className={`condtog ${lineOn ? "on" : ""}`}
              role="switch"
              aria-checked={lineOn}
              aria-label={`Use condition: ${r}`}
              onClick={() => onToggle(idx)}
            />
            <div className="ingred">
              <span className="igtext">
                {r}
                <span className="igcode">{recipeCode(r)}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Composite match-mode (all / any). Mirrors matchModeHtml. */
function MatchModeControl({
  value,
  onChange,
}: {
  value: "all" | "any";
  onChange: (v: "all" | "any") => void;
}) {
  return (
    <div className="setrow">
      <span className="setl">Match</span>
      <span className="seg2" role="radiogroup" aria-label="Match mode">
        <button
          type="button"
          role="radio"
          aria-checked={value === "all"}
          className={value === "all" ? "on" : ""}
          onClick={() => onChange("all")}
        >
          All conditions
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "any"}
          className={value === "any" ? "on" : ""}
          onClick={() => onChange("any")}
        >
          Any condition
        </button>
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingControl · renders one of the 6 setting types (strictness / scale /
// mode / platform / presence / none). Mirrors settingControlHtml + its
// per-type renderers. Bound to the GoalFilter.tune value; emits a typed update.
// ─────────────────────────────────────────────────────────────────────────────

const STRICTNESS_STOPS: {
  key: "loose" | "balanced" | "strict";
  label: string;
}[] = [
  { key: "loose", label: "Looser" },
  { key: "balanced", label: "Balanced" },
  { key: "strict", label: "Stricter" },
];

function SettingControl({
  setting,
  value,
  onChange,
}: {
  setting: SignalSetting;
  value: SignalTuneValue;
  onChange: (next: SignalTuneValue) => void;
}) {
  // ── scale · 5-band multi-select chips ──
  if (setting.type === "scale") {
    const sel = value.kind === "scale" ? value.bands : (setting.def ?? []);
    const labels = sel
      .map((k) => setting.bands.find((b) => b.value === k)?.label ?? k)
      .join(" + ");
    const band =
      sel.length === 1
        ? setting.bands.find((b) => b.value === sel[0])?.desc
        : "pick more bands to widen, fewer to narrow.";
    function pick(k: string) {
      const arr = sel.slice();
      const at = arr.indexOf(k);
      if (at >= 0) {
        if (arr.length > 1) arr.splice(at, 1); // keep ≥1 selected
      } else arr.push(k);
      onChange({ kind: "scale", bands: arr });
    }
    return (
      <div className="setrow">
        <span className="setl">{setting.label ?? "Position vs market"}</span>
        <div className="chipset">
          {setting.bands.map((b) => {
            const isOn = sel.indexOf(b.value) >= 0;
            return (
              <button
                type="button"
                key={b.value}
                className={`ch ${isOn ? "on" : ""}`}
                title={b.desc}
                aria-pressed={isOn}
                onClick={() => pick(b.value)}
              >
                {b.label}
              </button>
            );
          })}
        </div>
        <div className="sethint">
          Targeting: <b>{labels || "—"}</b> — {band}{" "}
          <span className="sethint-note">Wider = more leads.</span>
        </div>
      </div>
    );
  }

  // ── mode · N-option single-select with descriptions ──
  if (setting.type === "mode") {
    const cur = value.kind === "mode" ? value.value : setting.def;
    const hint =
      setting.options.find((o) => o.value === cur)?.desc ??
      "Pick the state that fits your pitch.";
    return (
      <div className="setrow">
        <span className="setl">{setting.label ?? "State"}</span>
        <div className="chipset">
          {setting.options.map((o) => {
            const isOn = o.value === cur;
            return (
              <button
                type="button"
                key={o.value}
                className={`ch ${isOn ? "on" : ""}`}
                title={o.desc}
                aria-pressed={isOn}
                onClick={() => onChange({ kind: "mode", value: o.value })}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <div className="sethint">{hint}</div>
      </div>
    );
  }

  // ── platform · multi-select chips + optional Any / None ──
  if (setting.type === "platform") {
    const sel = value.kind === "platform" ? value.values : (setting.def ?? []);
    const ANY = "__any__";
    const NONE = "__none__";
    function toggle(k: string) {
      let arr = sel.slice();
      if (k === NONE) {
        arr = arr.indexOf(NONE) >= 0 ? [] : [NONE];
        if (!arr.length) arr = [NONE];
      } else if (k === ANY) {
        arr = arr.indexOf(ANY) >= 0 ? [] : [ANY];
        if (!arr.length) arr = [ANY];
      } else {
        arr = arr.filter((x) => x !== NONE && x !== ANY);
        const at = arr.indexOf(k);
        if (at >= 0) {
          if (arr.length > 1) arr.splice(at, 1);
        } else arr.push(k);
      }
      onChange({ kind: "platform", values: arr });
    }
    let hint: ReactNode;
    if (setting.allowAny && sel.indexOf(ANY) >= 0) {
      hint = "Matches if ANY tool is detected.";
    } else if (setting.allowNone && sel.indexOf(NONE) >= 0) {
      hint = "Matches when none is found.";
    } else {
      const labels = sel
        .map((k) => setting.options.find((o) => o.value === k)?.label ?? k)
        .join(", ");
      const hasOther = setting.options.some((o) => o.value === "other");
      hint = (
        <>
          Matches: <b>{labels || "—"}</b>.{" "}
          <span className="sethint-note">
            Add more{hasOther ? " (or ‘Other’)" : ""} to widen.
          </span>
        </>
      );
    }
    return (
      <div className="setrow">
        <span className="setl">{setting.label ?? "Built on"}</span>
        <div className="chipset">
          {setting.allowAny ? (
            <button
              type="button"
              className={`ch any ${sel.indexOf(ANY) >= 0 ? "on" : ""}`}
              title="Matches if ANY tool is detected."
              aria-pressed={sel.indexOf(ANY) >= 0}
              onClick={() => toggle(ANY)}
            >
              Any
            </button>
          ) : null}
          {setting.options.map((o) => {
            const isOn = sel.indexOf(o.value) >= 0;
            return (
              <button
                type="button"
                key={o.value}
                className={`ch ${isOn ? "on" : ""}`}
                title={o.desc}
                aria-pressed={isOn}
                onClick={() => toggle(o.value)}
              >
                {o.label}
              </button>
            );
          })}
          {setting.allowNone ? (
            <button
              type="button"
              className={`ch none ${sel.indexOf(NONE) >= 0 ? "on" : ""}`}
              title="Matches when none is found."
              aria-pressed={sel.indexOf(NONE) >= 0}
              onClick={() => toggle(NONE)}
            >
              Not detected
            </button>
          ) : null}
        </div>
        <div className="sethint">{hint}</div>
      </div>
    );
  }

  // ── presence · has / hasn't toggle with a per-side hint ──
  if (setting.type === "presence") {
    const cur =
      value.kind === "presence" ? value.value : (setting.def ?? "has");
    const hint =
      cur === "hasnt"
        ? (setting.presenceHint?.hasnt ??
          `Matches businesses that are “${setting.hasntLabel}”.`)
        : (setting.presenceHint?.has ??
          `Matches businesses that are “${setting.hasLabel}”.`);
    return (
      <div className="setrow">
        <span className="setl">{setting.label ?? "Presence"}</span>
        <span
          className="seg2"
          role="radiogroup"
          aria-label={setting.label ?? "Presence"}
        >
          <button
            type="button"
            role="radio"
            aria-checked={cur === "has"}
            className={cur === "has" ? "on" : ""}
            onClick={() => onChange({ kind: "presence", value: "has" })}
          >
            {setting.hasLabel ?? "Has one"}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={cur === "hasnt"}
            className={cur === "hasnt" ? "on" : ""}
            onClick={() => onChange({ kind: "presence", value: "hasnt" })}
          >
            {setting.hasntLabel ?? "Doesn’t have one"}
          </button>
        </span>
        <div className="sethint">{hint}</div>
      </div>
    );
  }

  // ── strictness (default) · only when there's a numeric cutoff to move ──
  if (!stricEligible(setting)) return null;
  const level = value.kind === "strictness" ? value.level : "balanced";
  return (
    <div className="setrow">
      <span className="setl">How strict</span>
      <div className="seg3" role="radiogroup" aria-label="Signal sensitivity">
        {STRICTNESS_STOPS.map((s) => (
          <button
            type="button"
            key={s.key}
            role="radio"
            aria-checked={s.key === level}
            className={s.key === level ? "on" : ""}
            onClick={() => onChange({ kind: "strictness", level: s.key })}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="sethint">
        <b>Looser</b> = wider net, more leads; <b>Stricter</b> = higher bar,
        fewer but stronger.{" "}
        <span className="sethint-note">Same data — we only move the line.</span>
      </div>
    </div>
  );
}

/**
 * Strictness controls render only when the SettingControl is wrapped by a card
 * whose recipe has a numeric cutoff. The card decides this via
 * {@link hasNumericThreshold}; this guard is a belt-and-suspenders default so a
 * `strictness` setting passed without a numeric recipe shows nothing rather
 * than a no-op slider (mirrors the prototype's `hasNumericThreshold` gate).
 */
function stricEligible(setting: SignalSetting): boolean {
  return setting.type === "strictness";
}

/**
 * SignalLibrary · the "＋ Add signal or raw data" picker. A centered dialog
 * listing every SIG_META entry NOT already in the goal, grouped by outcome
 * (collapsible sections; the first is open + all auto-open while searching).
 * Adding a row appends it to the goal (ON) — the row then disappears since the
 * list is derived from `goal.filters`. Stays open for multi-add. Closes via the
 * ✕ button, Escape, or clicking the scrim. The search input is focused on open.
 */
function SignalLibrary({
  goal,
  onChange,
  onClose,
}: {
  goal: GoalState;
  onChange: (next: GoalState) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus the search on open + close on Escape.
  useEffect(() => {
    searchRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function add(key: string) {
    const meta = SIG_META[key];
    if (!meta) return;
    onChange({
      ...goal,
      customized: true,
      filters: [
        ...goal.filters,
        { key, on: true, why: meta.pitch || meta.means },
      ],
    });
  }

  // The catalog: every SIG_META key not already in the goal, bucketed by group.
  const inGoal = new Set(goal.filters.map((f) => f.key));
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const byGroup = new Map<OutcomeGroup, { key: string; meta: SigMeta }[]>();
  for (const [key, meta] of Object.entries(SIG_META)) {
    if (inGoal.has(key)) continue;
    if (searching) {
      const hay = `${meta.title} ${meta.means} ${key}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const arr = byGroup.get(meta.group) ?? [];
    arr.push({ key, meta });
    byGroup.set(meta.group, arr);
  }

  const groups = OUTCOME_GROUPS.filter((g) => byGroup.has(g.key));
  const available = Array.from(byGroup.values()).reduce(
    (n, rows) => n + rows.length,
    0,
  );

  return (
    <div
      className="overlay center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sigLibTitle"
      >
        <div className="mhead">
          <h2 id="sigLibTitle">Signal &amp; field library</h2>
          <span className="note">Every signal &amp; raw field — your moat</span>
          <button
            type="button"
            className="x"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="mbody">
          <input
            ref={searchRef}
            className="msearch"
            placeholder="Search signals — pixel, slow, reviews, rankings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            aria-label="Search signals"
          />
          <p className="note" style={{ margin: "11px 0 2px" }}>
            A <span className="badge-sig">SIGNAL</span> is an expert read on a
            business. A <span className="badge-data">DATA</span> field is a
            single raw fact. Open a section to browse, or search across all of
            them.
          </p>

          <div className="siglib siglib-compact">
            {groups.length === 0 ? (
              <div className="note" style={{ padding: "30px 2px" }}>
                {searching
                  ? `No signals match “${query}”.`
                  : "Every signal is already in this goal."}
              </div>
            ) : (
              groups.map((g, gi) => {
                const rows = byGroup.get(g.key) ?? [];
                return (
                  <details
                    className="siglib-grp"
                    key={g.key}
                    open={searching || gi === 0}
                  >
                    <summary className="siglib-head">
                      <span className="siglib-gname">{g.label}</span>
                      <span className="siglib-count">{rows.length}</span>
                      <span className="siglib-chev" aria-hidden="true">
                        ▾
                      </span>
                    </summary>
                    <div className="siglib-rows">
                      {rows.map(({ key, meta }) => {
                        const isSig = meta.kind === "signal";
                        return (
                          <div
                            className={`siglib-row ${isSig ? "is-sig" : "is-data"}`}
                            key={key}
                          >
                            <div className="siglib-meta">
                              <span className="siglib-name">{meta.title}</span>
                              <span
                                className={isSig ? "badge-sig" : "badge-data"}
                              >
                                {isSig ? "SIGNAL" : "DATA"}
                              </span>
                              <span className="siglib-desc">{meta.means}</span>
                            </div>
                            <button
                              type="button"
                              className="siglib-add"
                              aria-label={`Add ${meta.title}`}
                              onClick={() => add(key)}
                            >
                              ＋ Add
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })
            )}
          </div>
        </div>

        <div className="mfoot">
          <span className="note">
            {available} available{searching ? ` · matching “${query}”` : ""}
          </span>
          <button
            type="button"
            className="btn primary"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
