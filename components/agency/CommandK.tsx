"use client";

/**
 * Agency global ⌘K command palette (WP4-7) · client component.
 *
 * A real command palette, not just a business lookup:
 *   - Empty / short query → JUMP commands (Get leads · My research · Billing ·
 *     Settings) + the agency's RECENT researches.
 *   - Typed query (≥ 2 chars) → business matches from /api/agency/search.
 *   - Selecting a business deep-links to `/discover/[discoveryId]?lead=<id>`
 *     when the business belongs to one of the agency's researches (the drawer
 *     is URL-driven, so it opens straight on the evidence); otherwise it starts
 *     the bare Discover flow.
 *
 * Per `.claude/rules/ui-ux-agency.md`: keyboard-first (⌘K opens · ↑/↓ moves ·
 * Enter selects · Esc closes), terse copy, indigo accent, dense list, and a
 * `↑↓ ↵ esc` shortcut footer so Tom sees the mouse-free path.
 *
 * Per `.claude/rules/accessibility.md`: role="dialog" + aria-modal via Modal,
 * combobox + listbox roles, aria-activedescendant on the active option.
 *
 * Per `.claude/rules/realtime-and-optimistic.md`, the network call is debounced
 * (~150ms) with a token race-guard so a slow earlier response can't overwrite a
 * faster later one.
 *
 * Existing lookup strings still come from `agency.commandK.*` via
 * `useTranslations`; the new palette chrome (jump-command labels, section
 * headers, footer) is English-only inline, matching the surrounding agency
 * portal files (hardcoded English per the branch decision).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter as useRawRouter } from "next/navigation";

import { useRouter } from "@/i18n/navigation";
import { Modal } from "@/components/ui/Modal";
import { Icon, type IconName } from "@/components/agency/Icon";
import type { RecentResearchLink } from "@/modules/agency-portal/research/queries";
import type {
  BusinessMatch,
  BusinessSearchResponse,
} from "@/modules/business-search/types";

const DEBOUNCE_MS = 150;
const MIN_QUERY_LEN = 2;

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; matches: BusinessMatch[] }
  | { kind: "error" };

/** A selectable palette row — either a static command or a business match. */
type PaletteItem =
  | {
      kind: "command";
      id: string;
      label: string;
      icon: IconName;
      run: () => void;
    }
  | { kind: "business"; id: string; match: BusinessMatch };

export interface CommandKProps {
  /** The agency's recent researches, resolved server-side (WP4-7). */
  recentResearches?: RecentResearchLink[];
}

export function CommandK({ recentResearches = [] }: CommandKProps) {
  const t = useTranslations("agency.commandK");
  const router = useRouter();
  // Recent-research hrefs are pre-built raw paths (buildResearchHref) that the
  // typed i18n router can't accept — push them via the plain Next router. The
  // href already carries the locale-neutral pathname the flow expects.
  const rawRouter = useRawRouter();

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [state, setState] = React.useState<FetchState>({ kind: "idle" });
  const [activeIdx, setActiveIdx] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const fetchTokenRef = React.useRef(0);
  const listboxId = React.useId();

  const closeModal = React.useCallback(() => {
    setOpen(false);
    setQuery("");
    setState({ kind: "idle" });
    setActiveIdx(0);
  }, []);

  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

  // ─── Global ⌘K / Ctrl+K shortcut ─────────────────────────────────────
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isModK =
        (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (!isModK) return;
      if (e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (openRef.current) {
        closeModal();
      } else {
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeModal]);

  // ─── Focus the input when the modal opens ────────────────────────────
  React.useEffect(() => {
    if (!open) return;
    const tid = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(tid);
  }, [open]);

  // ─── Debounced fetch (only when the query is long enough) ────────────
  React.useEffect(() => {
    const trimmed = query.trim();
    const token = ++fetchTokenRef.current;
    if (trimmed.length < MIN_QUERY_LEN) {
      const itid = window.setTimeout(() => {
        if (token === fetchTokenRef.current) setState({ kind: "idle" });
      }, 0);
      return () => window.clearTimeout(itid);
    }
    const tid = window.setTimeout(async () => {
      if (token !== fetchTokenRef.current) return;
      setState({ kind: "loading" });
      try {
        const res = await fetch(
          `/api/agency/search?q=${encodeURIComponent(trimmed)}`,
          { headers: { Accept: "application/json" } },
        );
        if (token !== fetchTokenRef.current) return;
        if (!res.ok) {
          setState({ kind: "error" });
          return;
        }
        const data = (await res.json()) as BusinessSearchResponse;
        if (token !== fetchTokenRef.current) return;
        setState({ kind: "ready", matches: data.matches });
        setActiveIdx(0);
      } catch {
        if (token !== fetchTokenRef.current) return;
        setState({ kind: "error" });
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(tid);
  }, [query]);

  // ─── Selection ───────────────────────────────────────────────────────
  // Deep-link a business to its containing research's workbench with the
  // drawer pre-opened (?lead=<id>); fall back to the bare Discover flow when
  // no research contains it yet (WP4-7).
  const selectBusiness = React.useCallback(
    (match: BusinessMatch) => {
      closeModal();
      if (match.discoveryId) {
        router.push({
          pathname: "/discover/[discoveryId]",
          params: { discoveryId: match.discoveryId },
          query: { lead: match.id },
        });
      } else {
        router.push({ pathname: "/discover" });
      }
    },
    [router, closeModal],
  );

  // ─── The command list (jump + recents), shown for empty/short queries ─
  const commands = React.useMemo<PaletteItem[]>(() => {
    const jump = (
      id: string,
      label: string,
      icon: IconName,
      go: () => void,
    ): PaletteItem => ({
      kind: "command",
      id,
      label,
      icon,
      run: () => {
        closeModal();
        go();
      },
    });
    const items: PaletteItem[] = [
      jump("jump-get-leads", "Get leads", "search", () =>
        router.push({ pathname: "/discover" }),
      ),
      jump("jump-research", "My research", "coverage", () =>
        router.push({ pathname: "/research" }),
      ),
      jump("jump-billing", "Billing", "link", () =>
        router.push({ pathname: "/team/billing" }),
      ),
      jump("jump-settings", "Settings", "chevron-down", () =>
        router.push({ pathname: "/agency-settings" }),
      ),
    ];
    for (const r of recentResearches) {
      items.push({
        kind: "command",
        id: `research-${r.id}`,
        label: r.title,
        icon: "clock",
        run: () => {
          closeModal();
          rawRouter.push(r.href);
        },
      });
    }
    return items;
  }, [recentResearches, router, rawRouter, closeModal]);

  // The currently visible, selectable rows — commands when idle, matches when
  // a query resolved. Keyboard nav + Enter operate over this unified list.
  const showingCommands = query.trim().length < MIN_QUERY_LEN;
  const businessItems: PaletteItem[] =
    state.kind === "ready"
      ? state.matches.map((m) => ({ kind: "business", id: m.id, match: m }))
      : [];
  const items = showingCommands ? commands : businessItems;

  const runItem = React.useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      if (item.kind === "command") item.run();
      else selectBusiness(item.match);
    },
    [selectBusiness],
  );

  // ─── Keyboard navigation over the visible list ───────────────────────
  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (items.length === 0) return; // let Modal handle Esc/Tab
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(items[activeIdx]);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(items.length - 1);
    }
  }

  const hasOptions = items.length > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="kbtn"
        onClick={() => setOpen(true)}
        aria-label={t("triggerAriaLabel")}
        data-testid="agency-commandk-trigger"
      >
        <Icon name="search" size={14} />
        <span className="kbtn-lbl">{t("trigger")}</span>
        <kbd>⌘K</kbd>
      </button>

      <Modal
        open={open}
        onClose={closeModal}
        title={t("title")}
        description={t("description")}
        audience="agency"
        maxWidth={520}
        className="commandk-modal"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label
            htmlFor={`${listboxId}-input`}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-3)",
            }}
          >
            {t("inputLabel")}
          </label>
          <input
            id={`${listboxId}-input`}
            ref={inputRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder={t("placeholder")}
            aria-controls={listboxId}
            aria-expanded={hasOptions}
            aria-activedescendant={
              hasOptions ? `${listboxId}-opt-${activeIdx}` : undefined
            }
            aria-autocomplete="list"
            role="combobox"
            data-testid="agency-commandk-input"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              outline: "none",
              boxShadow: "0 0 0 0 transparent",
              transition: "box-shadow .12s ease",
            }}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(91,61,245,.18)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = "0 0 0 0 transparent";
            }}
          />

          {showingCommands ? (
            <CommandList
              listboxId={listboxId}
              items={commands}
              activeIdx={activeIdx}
              onRun={runItem}
              onHover={setActiveIdx}
              hasRecent={recentResearches.length > 0}
            />
          ) : (
            <ResultList
              listboxId={listboxId}
              state={state}
              activeIdx={activeIdx}
              onSelect={selectBusiness}
              onHover={setActiveIdx}
              t={t}
            />
          )}

          {/* Keyboard footer — the mouse-free path Tom expects. */}
          <div
            style={{
              display: "flex",
              gap: 12,
              paddingTop: 2,
              fontSize: 11,
              color: "var(--color-text-3)",
            }}
            aria-hidden="true"
          >
            <span className="ckhint">
              <kbd>↑</kbd>
              <kbd>↓</kbd> move
            </span>
            <span className="ckhint">
              <kbd>↵</kbd> open
            </span>
            <span className="ckhint">
              <kbd>esc</kbd> close
            </span>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Command list (jump + recents) ─────────────────────────────────────────

interface CommandListProps {
  listboxId: string;
  items: PaletteItem[];
  activeIdx: number;
  onRun: (item: PaletteItem) => void;
  onHover: (i: number) => void;
  hasRecent: boolean;
}

function CommandList({
  listboxId,
  items,
  activeIdx,
  onRun,
  onHover,
  hasRecent,
}: CommandListProps) {
  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label="Commands"
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        maxHeight: 360,
        overflowY: "auto",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        background: "var(--color-bg)",
      }}
    >
      {items.map((item, i) => {
        if (item.kind !== "command") return null;
        const active = i === activeIdx;
        // First recent research row gets a section header above it.
        const firstRecent =
          hasRecent && item.id === `research-${firstRecentId(items)}`;
        return (
          <React.Fragment key={item.id}>
            {firstRecent ? (
              <li
                role="presentation"
                style={{
                  padding: "8px 12px 4px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--color-text-3)",
                }}
              >
                Recent research
              </li>
            ) : null}
            <li
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={active}
              onMouseDown={(e) => {
                e.preventDefault();
                onRun(item);
              }}
              onMouseEnter={() => onHover(i)}
              data-testid={`agency-commandk-cmd-${i}`}
              style={{
                cursor: "pointer",
                padding: "9px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: active ? "rgba(91,61,245,.10)" : "transparent",
                color: "var(--color-text)",
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <Icon
                name={item.icon}
                size={15}
                style={{ flex: "none", opacity: 0.7 }}
              />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </span>
            </li>
          </React.Fragment>
        );
      })}
    </ul>
  );
}

/** The id of the first recent-research command (for the section header). */
function firstRecentId(items: PaletteItem[]): string | null {
  const first = items.find(
    (it) => it.kind === "command" && it.id.startsWith("research-"),
  );
  return first ? first.id.slice("research-".length) : null;
}

// ─── Business result list ───────────────────────────────────────────────────

interface ResultListProps {
  listboxId: string;
  state: FetchState;
  activeIdx: number;
  onSelect: (m: BusinessMatch) => void;
  onHover: (i: number) => void;
  t: (key: string) => string;
}

function ResultList({
  listboxId,
  state,
  activeIdx,
  onSelect,
  onHover,
  t,
}: ResultListProps) {
  if (state.kind === "loading") {
    return (
      <p
        style={{
          margin: 0,
          padding: "8px 4px",
          fontSize: 12,
          color: "var(--color-text-3)",
        }}
        aria-live="polite"
      >
        {t("loading")}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p
        role="alert"
        style={{
          margin: 0,
          padding: "8px 4px",
          fontSize: 12,
          color: "var(--color-text-2)",
        }}
      >
        {t("errorState")}
      </p>
    );
  }
  if (state.kind === "idle" || state.matches.length === 0) {
    return (
      <p
        style={{
          margin: 0,
          padding: "8px 4px",
          fontSize: 12,
          color: "var(--color-text-2)",
        }}
        aria-live="polite"
      >
        {t("empty")}
      </p>
    );
  }
  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label={t("listAriaLabel")}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        maxHeight: 360,
        overflowY: "auto",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        background: "var(--color-bg)",
      }}
    >
      {state.matches.map((m, i) => {
        const active = i === activeIdx;
        const secondaryParts = [m.city, m.category].filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        );
        const secondary = secondaryParts.join(" · ");
        return (
          <li
            key={m.id}
            id={`${listboxId}-opt-${i}`}
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(m);
            }}
            onMouseEnter={() => onHover(i)}
            data-testid={`agency-commandk-option-${i}`}
            style={{
              cursor: "pointer",
              padding: "10px 12px",
              borderBottom:
                i === state.matches.length - 1
                  ? "none"
                  : "1px solid var(--color-border)",
              background: active ? "rgba(91,61,245,.10)" : "transparent",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--color-text)",
                lineHeight: 1.3,
              }}
            >
              {m.name}
            </span>
            {secondary !== "" || m.website != null ? (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--color-text-3)",
                  lineHeight: 1.4,
                }}
              >
                {secondary}
                {m.website != null && secondary !== "" ? " · " : null}
                {m.website != null ? m.website : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
