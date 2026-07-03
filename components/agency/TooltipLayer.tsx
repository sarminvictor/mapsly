"use client";

/* eslint-disable react-hooks/refs -- thin @floating-ui/react wrapper; its
 * callback refs (refs.setReference/setFloating) are misflagged by
 * react-hooks/refs as stale-render reads. This is the library's documented API. */

/**
 * TooltipLayer · ONE global, on-brand tooltip for the whole agency portal,
 * driven by `data-tip` attributes. Replaces native `title=` (unstyled OS chrome
 * that ignores the palette and can't wrap). Any element with `data-tip="…"`
 * gets a styled tooltip on hover AND keyboard focus — so the rollout is a safe
 * attribute rename (`title=` → `data-tip=`) rather than 49 JSX wrappers.
 *
 * Behavior: opens after a short hover/focus delay, auto-flips + shifts to stay
 * in the viewport (@floating-ui), closes on leave / blur / Escape / scroll, and
 * points the anchor's aria-describedby at the tooltip so screen readers get it
 * too. Mounted once in the agency layout.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";

const OPEN_DELAY_MS = 180;

export function TooltipLayer() {
  const [text, setText] = useState<string | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const tipId = "agency-tip";

  const { refs, floatingStyles, update } = useFloating({
    placement: "top",
    open: text != null,
    middleware: [offset(6), flip({ padding: 6 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hide = useCallback(() => {
    if (openTimer.current != null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    const a = anchorRef.current;
    if (a && a.getAttribute("aria-describedby") === tipId) {
      a.removeAttribute("aria-describedby");
    }
    anchorRef.current = null;
    setText(null);
  }, []);

  useEffect(() => {
    // Find the [data-tip] element under the pointer/focus and schedule a show.
    function schedule(el: HTMLElement) {
      const tip = el.getAttribute("data-tip");
      if (!tip) return;
      if (openTimer.current != null) window.clearTimeout(openTimer.current);
      const delay = el.dataset.tipInstant != null ? 0 : OPEN_DELAY_MS;
      openTimer.current = window.setTimeout(() => {
        // The anchor may have unmounted during the delay (e.g. a router.refresh
        // re-rendered the rows) — don't pin a tooltip to a detached node.
        if (!el.isConnected) return;
        anchorRef.current = el;
        refs.setReference(el);
        // Mirror the text to SR users via aria-describedby — UNLESS the element
        // already carries its own aria-label/describedby with the same text
        // (avoids a double announcement).
        if (
          !el.getAttribute("aria-describedby") &&
          !el.getAttribute("aria-label")
        ) {
          el.setAttribute("aria-describedby", tipId);
        }
        setText(tip);
        update();
      }, delay);
    }
    function onOver(e: Event) {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(
        "[data-tip]",
      );
      if (el) schedule(el);
      else if (anchorRef.current) hide();
    }
    function onOut(e: Event) {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(
        "[data-tip]",
      );
      if (el && el === anchorRef.current) hide();
      // A pending (not-yet-shown) hover that left before the delay elapsed.
      else if (el && openTimer.current != null && anchorRef.current == null)
        hide();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("focusin", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("focusout", onOut, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("focusin", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("focusout", onOut, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      if (openTimer.current != null) window.clearTimeout(openTimer.current);
    };
    // refs/update are stable from useFloating; hide is memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hide]);

  if (text == null) return null;
  return (
    <FloatingPortal id="agency-overlays">
      <div
        ref={refs.setFloating}
        id={tipId}
        role="tooltip"
        className="agency-tooltip"
        style={{ ...floatingStyles, zIndex: 100 }}
      >
        {text}
      </div>
    </FloatingPortal>
  );
}
