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

interface ToastDetail {
  message: string;
  tone: ToastTone;
}

const TOAST_EVENT = "mapsly:toast";
const INFO_MS = 2600;
const ERROR_MS = 5000;

/**
 * Fire a toast from any client component in the agency portal. Safe to call
 * during SSR (no-op when `window` is undefined). The single `<ToastHost />`
 * in the layout renders it.
 */
export function showToast(message: string, tone: ToastTone = "info"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { message, tone } }),
  );
}

interface HostState {
  message: string;
  tone: ToastTone;
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
      setToast({ message: detail.message, tone: detail.tone, key: keySeq });
      // Fade in on the next frame so the opacity transition runs.
      window.requestAnimationFrame(() => setVisible(true));

      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
      const dwell = detail.tone === "error" ? ERROR_MS : INFO_MS;
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

  return (
    <div
      key={toast.key}
      className={`toast${visible ? " show" : ""}${
        toast.tone === "error" ? " toast-error" : ""
      }`}
      role={toast.tone === "error" ? "alert" : "status"}
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
    >
      {toast.message}
    </div>
  );
}
