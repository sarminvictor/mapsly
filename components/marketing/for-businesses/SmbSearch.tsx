"use client";

/**
 * SmbSearch · hero business-name search with autosuggest (the page's single
 * CTA). The owner types their business name:
 *
 *   - HAVE a landing  → suggestions drop down; selecting one navigates to the
 *     personalized landing `/l/{slug}-{token}` (a plain nav — that route lives
 *     OUTSIDE the [locale] tree, so never the next-intl Link).
 *   - NO landing      → a "we haven't analyzed you yet · get a free report"
 *     row opens the lead-capture modal (prefilled with what they typed).
 *
 * Debounced fetch to /api/marketing/landing-search (mirrors the agency ⌘K
 * pattern: manual setTimeout + fetch-token to drop stale responses; all
 * setState deferred into the timeout to satisfy react-hooks/set-state-in-effect).
 *
 * Keeps the original custom ~5px blinking yellow caret (CSS has no caret-width
 * lever) — native caret hidden, a styled bar positioned via an off-screen
 * text mirror. a11y: ARIA combobox + listbox (`.claude/rules/accessibility.md`).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { LandingMatch } from "@/modules/landing-search/types";

import { ArrowGlyph } from "./fb-shared";
import { LeadReportModal, type LeadModalLabels } from "./LeadReportModal";

export interface SmbSearchLabels {
  placeholder: string;
  ariaLabel: string;
  /** Search button label ("Search"). */
  cta: string;
  /** aria-label for the suggestions listbox. */
  resultsLabel: string;
  /** "We haven't checked “%NAME%” yet." — %NAME% is replaced client-side.
   * Deliberately NOT an ICU `{name}` var: next-intl would treat it as a
   * required format arg and throw FORMATTING_ERROR when the server resolves
   * the label without it. %NAME% passes through untouched. */
  noMatchTitle: string;
  /** Lead-form CTA in the no-match row ("Get my free report"). */
  noMatchCta: string;
  modal: LeadModalLabels;
}

interface SmbSearchProps {
  labels: SmbSearchLabels;
  /** App locale, recorded on captured leads. */
  locale: string;
}

// Caret base x = the input's left padding (4px), so an empty field shows the
// caret right where the first character will land.
const CARET_BASE = 4;
const CARET_WIDTH = 5;
const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;
const MAX_RESULTS = 6;

export function SmbSearch({ labels, locale }: SmbSearchProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const fetchToken = useRef(0);

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [caretLeft, setCaretLeft] = useState(CARET_BASE);

  const [matches, setMatches] = useState<LandingMatch[]>([]);
  const [resolvedQuery, setResolvedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  /* ---------- custom caret ---------- */
  const reposition = useCallback(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    const textW = mirror.getBoundingClientRect().width;
    const x = CARET_BASE + textW - input.scrollLeft;
    setCaretLeft(Math.min(x, input.clientWidth - CARET_WIDTH));
  }, []);
  useLayoutEffect(reposition, [value, reposition]);

  /* ---------- debounced autosuggest ---------- */
  useEffect(() => {
    const q = value.trim();
    const myToken = ++fetchToken.current;
    const id = window.setTimeout(
      () => {
        if (q.length < MIN_CHARS) {
          if (fetchToken.current === myToken) {
            setMatches([]);
            setResolvedQuery("");
            setActiveIndex(-1);
          }
          return;
        }
        void (async () => {
          let data: { matches?: LandingMatch[] } = {};
          try {
            const res = await fetch(
              `/api/marketing/landing-search?q=${encodeURIComponent(q)}`,
            );
            if (res.ok)
              data = (await res.json()) as { matches?: LandingMatch[] };
          } catch {
            /* degrade to "no matches → lead form" */
          }
          if (fetchToken.current !== myToken) return; // stale response
          setMatches(
            Array.isArray(data.matches)
              ? data.matches.slice(0, MAX_RESULTS)
              : [],
          );
          setResolvedQuery(q);
          setActiveIndex(-1);
        })();
      },
      q.length < MIN_CHARS ? 0 : DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [value]);

  /* ---------- dismiss on outside click ---------- */
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDismissed(true);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  /* ---------- bfcache / back-forward restore guard ---------- */
  // Returning to this page via Back/Forward (from the separate /l/ landing
  // document) restores it with this client island's timers + fetch dead — the
  // autosuggest stops firing and the field feels stuck. Two restore paths,
  // both forced to a fresh load (after a reload navType is "reload" → no loop):
  //   1. Re-parse restore: this effect runs on mount and sees a back_forward
  //      navigation (pageshow already fired before React mounted, so a
  //      listener alone would miss it).
  //   2. True bfcache freeze: effects DON'T re-run on restore, but the
  //      pageshow listener attached here on the healthy mount survives in the
  //      frozen page and fires on the persisted restore.
  useEffect(() => {
    const navType = (
      performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined
    )?.type;
    if (navType === "back_forward") {
      window.location.reload();
      return;
    }
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) window.location.reload();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const trimmed = value.trim();
  const ready = resolvedQuery === trimmed && trimmed.length >= MIN_CHARS;
  const open = focused && !dismissed && !modalOpen && ready;
  // Combobox is "expanded" only when a real listbox of options is shown — the
  // no-match state is a plain region, not an empty listbox (a11y).
  const hasMatches = open && matches.length > 0;
  // Polite SR status when the dropdown settles. Options are read as the user
  // arrows; this covers "results appeared" and the otherwise-silent no-match.
  const liveMessage = !open
    ? ""
    : matches.length > 0
      ? labels.resultsLabel
      : labels.noMatchTitle.replace("%NAME%", trimmed);

  // A landing is followed ONLY when the visitor explicitly highlights a
  // suggestion. With nothing selected, the CTA opens the lead form — we
  // haven't confirmed which business is theirs. The button label reflects
  // that: "Search" when a suggestion is active, "Get my free report" otherwise.
  const selectionActive = matches.length > 0 && activeIndex >= 0;
  const ctaLabel =
    !selectionActive && trimmed.length >= MIN_CHARS
      ? labels.noMatchCta
      : labels.cta;

  function openLeadForm() {
    setDismissed(true);
    setModalOpen(true);
  }

  function navigateTo(match: LandingMatch) {
    window.location.href = match.landingPath;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (matches.length) {
        e.preventDefault();
        setDismissed(false);
        setActiveIndex((i) => (i + 1) % matches.length);
      }
    } else if (e.key === "ArrowUp") {
      if (matches.length) {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
      }
    } else if (e.key === "Escape") {
      setDismissed(true);
      setActiveIndex(-1);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Only follow a landing when a suggestion is explicitly highlighted.
    // Otherwise we didn't find/confirm their business → open the lead form.
    if (selectionActive) {
      navigateTo(matches[activeIndex]);
      return;
    }
    if (trimmed.length >= MIN_CHARS) openLeadForm();
  }

  return (
    <div className="fb-search-wrap" ref={wrapRef}>
      <form className="fb-search" onSubmit={onSubmit} role="search">
        <svg width="24" height="24" viewBox="0 0 18 18" aria-hidden>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.8"
            fill="none"
          />
          <path
            d="M12.2 12.2l3.6 3.6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>

        <span className="fb-search-field">
          <input
            id="fb-hero-search"
            ref={inputRef}
            type="text"
            name="business"
            placeholder={labels.placeholder}
            aria-label={labels.ariaLabel}
            autoComplete="organization"
            role="combobox"
            aria-expanded={hasMatches}
            aria-controls={hasMatches ? listboxId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              hasMatches && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setDismissed(false);
            }}
            onFocus={() => {
              setFocused(true);
              setDismissed(false);
            }}
            onBlur={() => setFocused(false)}
            onScroll={reposition}
            onKeyDown={onKeyDown}
          />
          {/* Off-screen text mirror — width drives the caret x position. */}
          <span className="fb-search-mirror" ref={mirrorRef} aria-hidden>
            {value}
          </span>
          {focused && (
            <span
              className="fb-caret"
              aria-hidden
              style={{ left: caretLeft }}
            />
          )}
        </span>

        {/* Single adaptive CTA: "Search" follows a highlighted suggestion;
            with nothing selected it's "Get my free report" → opens the popup. */}
        <button type="submit" className="fb-btn">
          {ctaLabel} <ArrowGlyph />
        </button>
      </form>

      {hasMatches && (
        <ul
          className="fb-suggest"
          id={listboxId}
          role="listbox"
          aria-label={labels.resultsLabel}
        >
          {matches.map((m, i) => (
            <li
              key={m.landingPath}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={`fb-suggest-row${i === activeIndex ? " is-active" : ""}`}
              // Keep focus in the input so the dropdown doesn't blur shut
              // before the click registers.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => navigateTo(m)}
            >
              <span className="fb-suggest-name">{m.name}</span>
              {m.city && <span className="fb-suggest-city">{m.city}</span>}
              <span className="fb-suggest-go" aria-hidden>
                <ArrowGlyph />
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* No-match: the dropdown stays empty — the adaptive Search button
          ("Get my free report") opens the lead form. The state is announced
          to screen readers via the live region below. */}

      {/* Visually-hidden polite status for screen readers. */}
      <div className="fb-sr-only" role="status" aria-live="polite">
        {liveMessage}
      </div>

      {modalOpen && (
        <LeadReportModal
          onClose={() => {
            setModalOpen(false);
            inputRef.current?.focus();
          }}
          labels={labels.modal}
          initialBusinessName={trimmed}
          locale={locale}
        />
      )}
    </div>
  );
}
