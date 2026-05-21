"use client";

/**
 * Agency global ⌘K quick-lookup (F.11) · client component.
 *
 * Mounts a small trigger button in the agency portal header AND the
 * modal that opens on ⌘K / Ctrl+K. Type → debounced fetch → keyboard-
 * navigable results → Enter opens the prospect detail page.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Keyboard-first (⌘K opens · ↑/↓ moves · Enter selects · Esc closes)
 *   - Terse copy ("Search businesses…", not "Find a business to look up")
 *   - Indigo accent · Inter font · dense list
 *
 * Per `.claude/rules/accessibility.md`:
 *   - role="dialog" + aria-modal="true" + labeled input
 *   - Visible focus ring · Escape closes · focus returns to trigger
 *   - aria-activedescendant for the highlighted result (works under VO)
 *
 * Per `.claude/rules/realtime-and-optimistic.md`, debounce the network
 * call (~150ms) so quick typing doesn't spam the API. The active query
 * token is captured in a ref so a slow earlier response can't overwrite
 * a faster later one (race-condition guard).
 *
 * Per `.claude/rules/i18n.md`, all strings come from
 * `agency.commandK.*` via `useTranslations`. Navigation uses the
 * locale-aware `useRouter` from `@/i18n/navigation` so `/prospect/:id`
 * routes to `/es/prospecto/:id` etc.
 *
 * Per `.claude/rules/conventions.md`, this is a leaf client component;
 * the agency layout (server) renders it once for the whole subtree.
 */

import * as React from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { Modal } from "@/components/ui/Modal";
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

export function CommandK() {
  const t = useTranslations("agency.commandK");
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [state, setState] = React.useState<FetchState>({ kind: "idle" });
  const [activeIdx, setActiveIdx] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Token guarding against stale responses (slow earlier fetch races a
  // newer one). We compare the captured token at resolve time against
  // the latest token and discard if they don't match.
  const fetchTokenRef = React.useRef(0);
  const listboxId = React.useId();

  // closeModal is the canonical "close + reset" path. Called from ⌘K
  // toggle, Esc/onClose (Modal primitive), and select(). We do not use
  // an effect-on-[open] reset (would violate react-hooks/set-state-in-effect).
  const closeModal = React.useCallback(() => {
    setOpen(false);
    setQuery("");
    setState({ kind: "idle" });
    setActiveIdx(0);
  }, []);

  // Sync ref so the empty-deps ⌘K listener can read current open without
  // re-registering on every open/close transition.
  const openRef = React.useRef(open);
  openRef.current = open;

  // ─── Global ⌘K / Ctrl+K shortcut ─────────────────────────────────────
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isModK =
        (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (!isModK) return;
      // Don't fight the browser's built-in shortcuts (DevTools cmd+shift+K
      // on Firefox sets shiftKey; we treat shifted variants as not-ours).
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
  // Modal's own focus-first logic targets the first focusable, which is
  // the input — but its setTimeout(0) can race with our state update on
  // some renders, so we explicitly nudge the input on the next tick.
  React.useEffect(() => {
    if (!open) return;
    const tid = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(tid);
  }, [open]);

  // ─── Debounced fetch ─────────────────────────────────────────────────
  React.useEffect(() => {
    const trimmed = query.trim();
    const token = ++fetchTokenRef.current;
    if (trimmed.length < MIN_QUERY_LEN) {
      // Defer setState out of the effect body to satisfy
      // react-hooks/set-state-in-effect. setTimeout(0) is sufficient;
      // the token check skips state update if a newer keystroke landed.
      const itid = window.setTimeout(() => {
        if (token === fetchTokenRef.current) setState({ kind: "idle" });
      }, 0);
      return () => window.clearTimeout(itid);
    }
    // Loading state and fetch are both inside an async timeout, so they
    // happen outside the effect body — satisfies the lint rule.
    const tid = window.setTimeout(async () => {
      // Stale-token check first (a newer keystroke may have superseded us).
      if (token !== fetchTokenRef.current) return;
      setState({ kind: "loading" });
      try {
        const res = await fetch(
          `/api/agency/search?q=${encodeURIComponent(trimmed)}`,
          { headers: { Accept: "application/json" } },
        );
        // Discard stale responses (the user typed more since we fired).
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

  // ─── Selection (Enter / click) ───────────────────────────────────────
  const select = React.useCallback(
    (match: BusinessMatch) => {
      closeModal();
      router.push({
        pathname: "/prospect/[businessId]",
        params: { businessId: match.id },
      });
    },
    [router, closeModal],
  );

  // ─── List keyboard navigation ────────────────────────────────────────
  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (state.kind !== "ready" || state.matches.length === 0) {
      // Let Modal's keydown handler handle Esc/Tab.
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(state.matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = state.matches[activeIdx];
      if (match) select(match);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(state.matches.length - 1);
    }
  }

  const matches = state.kind === "ready" ? state.matches : [];
  const hasResults = state.kind === "ready" && matches.length > 0;
  const noMatches = state.kind === "ready" && matches.length === 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("triggerAriaLabel")}
        data-testid="agency-commandk-trigger"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          background: "var(--color-bg)",
          color: "var(--color-text-2)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        <span aria-hidden style={{ fontSize: 13 }}>
          ⌘K
        </span>
        <span>{t("trigger")}</span>
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
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t("placeholder")}
            aria-controls={listboxId}
            aria-expanded={hasResults}
            aria-activedescendant={
              hasResults ? `${listboxId}-opt-${activeIdx}` : undefined
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

          <ResultList
            listboxId={listboxId}
            state={state}
            activeIdx={activeIdx}
            onSelect={select}
            onHover={setActiveIdx}
            t={t}
          />
        </div>
      </Modal>
    </>
  );
}

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
  if (state.kind === "idle") {
    return (
      <p
        style={{
          margin: 0,
          padding: "8px 4px",
          fontSize: 12,
          color: "var(--color-text-3)",
        }}
      >
        {t("hint")}
      </p>
    );
  }
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
  // ready
  if (state.matches.length === 0) {
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
              // Prevent the input from losing focus before we navigate.
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
