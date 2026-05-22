"use client";

/**
 * HunterPreviewBarLive · client island that wraps `HunterPreviewBar`
 * with a debounced live-count fetch.
 *
 * Reads filter state from the URL (`useSearchParams`) so the bar
 * stays in lock-step with the page's URL-as-source-of-truth model.
 * Whenever `category`, `city`, or `radius` change, a 250ms-debounced
 * GET hits `/api/agency/hunter/count`. Stale-token guard prevents an
 * earlier-but-slower response from clobbering a newer one.
 *
 * Per `.claude/rules/realtime-and-optimistic.md`:
 *   - Debounce on input · 250ms balances responsiveness vs Neon load
 *   - Race-condition guard via a token ref captured at request time
 *   - `aria-live="polite"` on the underlying bar so screen-readers
 *     announce the new count without stealing focus
 *
 * Per `.claude/rules/conventions.md`:
 *   - Leaf client component, no useEffect-set-state-in-effect lint
 *     violations · all state writes happen inside async callbacks or
 *     setTimeout callbacks, never directly in the effect body
 *
 * Per `.claude/rules/copy-voice.md` Agency voice:
 *   - "0 match" / "47 matches" — terse · mono · indigo accent
 *   - Loading uses an em-dash ("—") so the bar height doesn't shift
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";

import {
  HunterPreviewBar,
  type HunterPreviewBarLabels,
} from "./HunterPreviewBar";

const DEBOUNCE_MS = 250;

export interface HunterPreviewBarLiveProps {
  currentStep: 1 | 2 | 3;
  labels: HunterPreviewBarLabels;
}

type CountState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; count: number; truncated: boolean }
  | { kind: "error" };

interface CountResponse {
  count: number;
  ms: number;
  truncated?: boolean;
}

export function HunterPreviewBarLive({
  currentStep,
  labels,
}: HunterPreviewBarLiveProps) {
  const searchParams = useSearchParams();
  const category = searchParams.get("category");
  const city = searchParams.get("city");
  const radius = searchParams.get("radius");

  const [state, setState] = React.useState<CountState>({ kind: "idle" });
  const tokenRef = React.useRef(0);

  React.useEffect(() => {
    // Only request a count once we have something to filter against.
    // Step 1 (template only) has no geo / category yet — show the
    // idle placeholder until Tom advances.
    if (!category && !city) {
      const token = ++tokenRef.current;
      const tid = window.setTimeout(() => {
        if (token === tokenRef.current) setState({ kind: "idle" });
      }, 0);
      return () => window.clearTimeout(tid);
    }

    const token = ++tokenRef.current;
    const tid = window.setTimeout(async () => {
      if (token !== tokenRef.current) return;
      setState({ kind: "loading" });
      try {
        const url = new URL("/api/agency/hunter/count", window.location.origin);
        if (category) url.searchParams.set("category", category);
        if (city) url.searchParams.set("city", city);
        if (radius) url.searchParams.set("radius", radius);
        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
        });
        if (token !== tokenRef.current) return;
        if (!res.ok) {
          setState({ kind: "error" });
          return;
        }
        const data = (await res.json()) as CountResponse;
        if (token !== tokenRef.current) return;
        setState({
          kind: "ready",
          count: data.count,
          truncated: data.truncated === true,
        });
      } catch {
        if (token !== tokenRef.current) return;
        setState({ kind: "error" });
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(tid);
  }, [category, city, radius]);

  // Map state → matchCount for the underlying presentational bar.
  // Loading/error states fall back to 0 so the bar shows the
  // "countPlaceholder" string (em-dash by default).
  const matchCount =
    state.kind === "ready" && state.count > 0 ? state.count : 0;

  return (
    <HunterPreviewBar
      matchCount={matchCount}
      currentStep={currentStep}
      labels={labels}
    />
  );
}
