"use client";

/**
 * Free weekly-score CTA (plan #7) — the low-commitment second option inside
 * the $29 pricing card. Visually SECONDARY by design: a quiet text trigger
 * that expands into a one-field email form. No card required.
 *
 * - The trigger carries `data-landing-cta="free-weekly"` so the existing
 *   LandingAnalytics click listener auto-beacons CTA_CLICKED (funnel
 *   "engaged" signal) — no new client analytics code.
 * - Submit calls the `subscribeWeeklyScore` server action (Zod + rate limit +
 *   transaction live server-side). The FREE_SIGNUP event is emitted THERE,
 *   never from this client.
 * - `visitorId` is read from the same localStorage key LandingAnalytics
 *   mints, so the conversion joins the visitor's funnel events.
 * - Email field starts EMPTY on purpose: the landing payload never includes
 *   the discovered business email, and printing one the page doesn't already
 *   show would leak it into HTML.
 *
 * Copy per `.claude/rules/copy-voice.md` SMB register: warm, short, sentence
 * case, no exclamation marks in errors.
 */

import { useState, useTransition, type CSSProperties } from "react";

import {
  subscribeWeeklyScore,
  type SubscribeWeeklyScoreResult,
} from "../subscribe-action";

/** Same key LandingAnalytics uses — joins this signup to the funnel events. */
const VID_KEY = "mapsly_l_vid";

const ERROR_COPY: Record<
  Exclude<SubscribeWeeklyScoreResult, { ok: true }>["error"],
  string
> = {
  invalid: "That email doesn't look right. Check it and try again.",
  rate_limited: "Too many tries. Wait a minute and try again.",
  unavailable: "We couldn't save that right now. Try again in a minute.",
};

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function readVisitorId(): string | undefined {
  try {
    return localStorage.getItem(VID_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function FreeWeeklyCta({ token }: { token: string }) {
  const [phase, setPhase] = useState<"idle" | "open" | "done">("idle");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (phase === "done") {
    return (
      <p className="landing-free-weekly" role="status">
        Done. First score email arrives Monday.
      </p>
    );
  }

  if (phase === "idle") {
    return (
      <div className="landing-free-weekly">
        <button
          type="button"
          data-landing-cta="free-weekly"
          className="landing-free-weekly-trigger"
          onClick={() => setPhase("open")}
        >
          Not ready? Get your score by email every week — free.
        </button>
      </div>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await subscribeWeeklyScore({
        token,
        email,
        visitorId: readVisitorId(),
      });
      if (result.ok) {
        setPhase("done");
      } else {
        setError(ERROR_COPY[result.error]);
      }
    });
  };

  return (
    <form
      className="landing-free-weekly"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isPending) submit();
      }}
    >
      <p className="landing-free-weekly-lead">
        Your score by email every week — free, no card.
      </p>
      <div className="landing-free-weekly-row">
        <label htmlFor="free-weekly-email" style={VISUALLY_HIDDEN}>
          Email
        </label>
        <input
          id="free-weekly-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@yourbusiness.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="landing-free-weekly-input"
          disabled={isPending}
        />
        <button
          type="submit"
          className="landing-free-weekly-submit"
          disabled={isPending}
          style={isPending ? { opacity: 0.6 } : undefined}
        >
          {isPending ? "Sending…" : "Send it weekly"}
        </button>
      </div>
      {error ? (
        <p className="landing-free-weekly-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
