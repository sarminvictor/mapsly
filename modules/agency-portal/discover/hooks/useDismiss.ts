"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Close an open overlay (dropdown / menu / popover / panel) on **Escape** or an
 * **outside pointer-down**, and return focus to the trigger on Escape.
 *
 * Every agency-portal overlay used to hand-roll (or omit) this — most just
 * toggled a boolean and trapped the user until they clicked the trigger again.
 * This is the single shared implementation (extracted from the add-filter
 * popover) so every menu behaves consistently.
 *
 *   const menuRef = useRef<HTMLDivElement>(null);
 *   const btnRef = useRef<HTMLButtonElement>(null);
 *   const [open, setOpen] = useState(false);
 *   useDismiss(open, () => setOpen(false), menuRef, btnRef);
 *
 * @param open       whether the overlay is currently open (no-op while false)
 * @param onClose    called to close it (outside-click or Escape)
 * @param panelRef   ref to the overlay panel — clicks inside it never close
 * @param triggerRef optional ref to the toggle button — clicks on it never
 *                   close (so the toggle isn't immediately re-closed), and
 *                   Escape returns focus here
 */
export function useDismiss(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
  triggerRef?: RefObject<HTMLElement | null>,
): void {
  // Keep the latest onClose without re-subscribing the listeners every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const close = () => onCloseRef.current();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        triggerRef?.current?.focus();
      }
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef?.current?.contains(t)) return;
      close();
    }
    document.addEventListener("keydown", onKey);
    // pointerdown (not mousedown) so an outside TAP on touch/pen also dismisses.
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, panelRef, triggerRef]);
}
