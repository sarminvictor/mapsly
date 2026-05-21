"use client";

/**
 * Share-link button · F.8 · agency prospect detail.
 *
 * Renders next to "Generate one-pager" in `ProspectHero`. On click it
 * calls `createShareLinkAction` (server action) which either creates
 * a fresh share row OR returns the existing non-expired one for the
 * (agency, business) pair. Either way, the user sees a URL + a
 * "Copy" affordance.
 *
 * Per `.claude/rules/realtime-and-optimistic.md`:
 *
 *   - `useTransition` so the button stays interactive but disables
 *     during the action.
 *   - No optimistic guess of the URL — generation requires a server
 *     round-trip (DB write + cross-agency check).
 *
 * Per `.claude/rules/copy-voice.md` (Agency · Tom):
 *
 *   - Imperative actions, jargon-OK, short labels.
 *   - Error states are terse and actionable.
 */

import { useState, useTransition } from "react";

import { createShareLinkAction } from "@/modules/reports/share-link-action";
import type { CreateShareLinkResult } from "@/modules/reports/share-link-action";

export interface ShareLinkButtonLabels {
  /** Idle CTA · "Share with prospect". */
  cta: string;
  /** While the server action is in flight · "Creating share link…". */
  busy: string;
  /** Copy-to-clipboard button label · "Copy". */
  copy: string;
  /** Right after copy · "Copied!". */
  copied: string;
  /** Expiration hint template · "Expires {date}". `{date}` is replaced. */
  expires: string;
  /** Error · unauthorized · "Sign in to share." */
  errorUnauthorized: string;
  /** Error · forbidden · "You don't have access to this prospect." */
  errorForbidden: string;
  /** Error · generic · "Couldn't create a share link. Try again." */
  errorGeneric: string;
}

export interface ShareLinkButtonProps {
  businessId: string;
  labels: ShareLinkButtonLabels;
  /** Optional locale string for date formatting · defaults to "en". */
  locale?: string;
}

interface SuccessState {
  kind: "success";
  url: string;
  expiresAt: string;
}

interface ErrorState {
  kind: "error";
  message: string;
}

type ResultState = SuccessState | ErrorState | null;

export function ShareLinkButton({
  businessId,
  labels,
  locale = "en",
}: ShareLinkButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ResultState>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  function handleClick() {
    setCopyState("idle");
    startTransition(async () => {
      const res = (await createShareLinkAction({
        businessId,
      })) as CreateShareLinkResult;

      if (res.status === "ok") {
        setResult({ kind: "success", url: res.url, expiresAt: res.expiresAt });
        return;
      }

      const message =
        res.status === "unauthorized"
          ? labels.errorUnauthorized
          : res.status === "forbidden"
            ? labels.errorForbidden
            : labels.errorGeneric;
      setResult({ kind: "error", message });
    });
  }

  async function handleCopy(url: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("idle");
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
        maxWidth: 320,
      }}
      data-testid="share-link-button"
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "8px 14px",
          borderRadius: 8,
          background: "var(--color-bg-2, #ffffff)",
          color: "var(--color-agency-indigo, #5b3df5)",
          border: "1px solid var(--color-agency-indigo, #5b3df5)",
          fontSize: 13,
          fontWeight: 600,
          cursor: isPending ? "wait" : "pointer",
          opacity: isPending ? 0.7 : 1,
        }}
        data-testid="share-link-cta"
      >
        {isPending ? labels.busy : labels.cta}
      </button>

      {result?.kind === "success" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: 4,
            width: "100%",
            marginTop: 2,
          }}
          data-testid="share-link-success"
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "var(--color-bg, #f6f7fb)",
              border: "1px solid var(--color-border, #e5e7eb)",
              borderRadius: 6,
              padding: "4px 8px",
            }}
          >
            <input
              type="text"
              readOnly
              value={result.url}
              onFocus={(e) => e.target.select()}
              aria-label="Share link URL"
              style={{
                flex: 1,
                background: "transparent",
                border: 0,
                outline: "none",
                fontFamily:
                  "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
                fontSize: 11,
                color: "var(--color-text-2, #475569)",
                minWidth: 0,
              }}
              data-testid="share-link-url"
            />
            <button
              type="button"
              onClick={() => handleCopy(result.url)}
              style={{
                background: "var(--color-agency-indigo, #5b3df5)",
                color: "#fff",
                border: 0,
                borderRadius: 4,
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
              data-testid="share-link-copy"
            >
              {copyState === "copied" ? labels.copied : labels.copy}
            </button>
          </div>
          <p
            style={{
              fontFamily:
                "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
              fontSize: 10.5,
              color: "var(--color-text-3, #94a3b8)",
              margin: 0,
              textAlign: "right",
            }}
          >
            {labels.expires.replace(
              "{date}",
              new Intl.DateTimeFormat(locale, {
                year: "numeric",
                month: "short",
                day: "numeric",
              }).format(new Date(result.expiresAt)),
            )}
          </p>
        </div>
      ) : null}

      {result?.kind === "error" ? (
        <p
          role="status"
          style={{
            fontSize: 11,
            color: "var(--color-danger, #c3553a)",
            margin: 0,
            textAlign: "right",
          }}
          data-testid="share-link-error"
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
