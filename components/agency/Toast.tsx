"use client";

/**
 * Agency portal toast system (WP4-11) · one host, one motion.
 *
 * Before this, the portal had THREE disjoint feedback mechanisms: the
 * GetLeadsFlow inline flow toast, the LeadDrawer module-scoped CustomEvent
 * toast, and the LeadsWorkbench inline red `role="alert"` for optimistic
 * reverts. They never shared markup, motion, or a mount point.
 *
 * This consolidates them: a single `<ToastHost />` mounts once in the agency
 * layout (app/[locale]/(agency)/layout.tsx) and stays mounted for the whole
 * subtree. Any client component fires a toast by calling `showToast(message)`
 * — a module-scoped CustomEvent dispatch, so no callback has to thread through
 * the tree (and no function prop crosses a server→client boundary, per
 * `.claude/rules/cache-components.md` Pattern 4).
 *
 * Motion: the `.toast` / `.toast.show` classes (agency-portal.css) fade in via
 * opacity; the host toggles `.show` a tick after mount so the transition runs.
 *
 * Tones: "info" (default, dark chip) and "error" (red edge) — the workbench
 * optimistic-revert routes through the error tone so a failed status write is
 * visible, not silently swallowed. Per `.claude/rules/copy-voice.md`: terse,
 * no emoji, ≤ 15 words for errors.
 */

import { useEffect, useState } from "react";

export type ToastTone = "info" | "error";

/** U18 · an optional in-toast action button (e.g. "Undo"). The `onClick` runs
 *  in the client (this is a client-only CustomEvent — no server boundary is
 *  crossed, so a function in the detail is safe, unlike a server→client prop). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastDetail {
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

const TOAST_EVENT = "mapsly:toast";
const INFO_MS = 2600;
const ERROR_MS = 5000;
// U18 · an action toast (Undo) dwells longer so the user has time to click it.
const ACTION_MS = 7000;

/**
 * Fire a toast from any client component in the agency portal. Safe to call
 * during SSR (no-op when `window` is undefined). The single `<ToastHost />`
 * in the layout renders it. Pass an optional `action` ({ label, onClick }) to
 * render an inline button — used by the bulk-status Undo (U18).
 */
export function showToast(
  message: string,
  tone: ToastTone = "info",
  action?: ToastAction,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, {
      detail: { message, tone, action },
    }),
  );
}

interface HostState {
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  /** Bumped per toast so re-firing the same message re-triggers the animation. */
  key: number;
}

export function ToastHost() {
  const [toast, setToast] = useState<HostState | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let hideTimer: number | undefined;
    let clearTimer: number | undefined;
    let keySeq = 0;

    function onToast(e: Event) {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      if (!detail?.message) return;
      keySeq += 1;
      setToast({
        message: detail.message,
        tone: detail.tone,
        action: detail.action,
        key: keySeq,
      });
      // Fade in on the next frame so the opacity transition runs.
      window.requestAnimationFrame(() => setVisible(true));

      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
      const dwell = detail.action
        ? ACTION_MS
        : detail.tone === "error"
          ? ERROR_MS
          : INFO_MS;
      hideTimer = window.setTimeout(() => setVisible(false), dwell);
      // Unmount after the fade-out completes (matches the .2s CSS transition).
      clearTimer = window.setTimeout(() => setToast(null), dwell + 250);
    }

    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, []);

  if (!toast) return null;

  const action = toast.action;

  return (
    <div
      key={toast.key}
      className={`toast${visible ? " show" : ""}${
        toast.tone === "error" ? " toast-error" : ""
      }${action ? " toast-action" : ""}`}
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
    >
      <span className="toast-msg">{toast.message}</span>
      {action ? (
        <button
          type="button"
          className="toast-btn"
          onClick={() => {
            action.onClick();
            // Dismiss right after the action fires (fade out, then unmount).
            setVisible(false);
            window.setTimeout(() => setToast(null), 250);
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
