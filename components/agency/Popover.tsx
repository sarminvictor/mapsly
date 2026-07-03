"use client";

/* eslint-disable react-hooks/refs -- This is a thin wrapper around
 * @floating-ui/react, whose API is callback refs (refs.setReference /
 * refs.setFloating) and ref objects passed to props (getReferenceProps /
 * getFloatingProps). The react-hooks/refs rule misflags these library patterns
 * as stale-render ref reads; they are the documented, correct usage. */

/**
 * Agency <Popover> · a portaled, viewport-aware dropdown/menu that can NEVER be
 * clipped by an `overflow:hidden` ancestor and auto-flips at screen edges
 * (@floating-ui/react). Replaces the hand-rolled absolute-positioned menus that
 * clipped inside the filters panel and needed magic-number offsets.
 *
 *   <Popover
 *     open={open}
 *     onOpenChange={setOpen}
 *     placement="bottom-start"
 *     trigger={<button className="btn sm">Fields ▾</button>}
 *   >
 *     {items}
 *   </Popover>
 *
 * The trigger is cloned to receive the reference ref + aria-haspopup/expanded.
 * Outside-click + Escape close it (floating-ui useDismiss) and focus returns to
 * the trigger; ↑/↓/Home/End move between focusable items; focus moves into the
 * panel on open (FloatingFocusManager, non-modal — it's a menu, not a modal).
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  type Placement,
} from "@floating-ui/react";

const ITEM_SELECTOR =
  'a[href], button:not([disabled]), [role="menuitem"]:not([aria-disabled="true"]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  placement = "bottom-start",
  className,
  role = "menu",
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The clickable element that opens the popover (cloned to attach the ref). */
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  placement?: Placement;
  /** Class on the floating panel (e.g. "popmenu cols" / "filter-add-popover"). */
  className?: string;
  role?: "menu" | "listbox" | "dialog";
  /** aria-label for the floating panel. */
  label?: string;
}) {
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      // Cap to the viewport; the panel scrolls inside instead of overflowing.
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`;
        },
      }),
    ],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const roleProps = useRole(context, { role });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    roleProps,
  ]);

  // ↑/↓/Home/End move focus among the panel's focusable items (keyboard-first).
  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const panel = e.currentTarget;
    const items = Array.from(
      panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR),
    );
    if (items.length === 0) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown")
      next = idx < 0 ? 0 : (idx + 1) % items.length;
    else next = idx <= 0 ? items.length - 1 : idx - 1;
    items[next]?.focus();
  }, []);

  const triggerNode = isValidElement(trigger)
    ? cloneElement(trigger, {
        ref: refs.setReference,
        ...getReferenceProps({
          "aria-haspopup": role === "dialog" ? "dialog" : true,
          "aria-expanded": open,
        }),
      })
    : trigger;

  return (
    <>
      {triggerNode}
      {open ? (
        // Portal into the agency-scoped overlay host (inside .agency-portal) so
        // the scoped CSS + design tokens + fonts apply AND it escapes any
        // overflow:hidden ancestor. Falls back to <body> if the host is absent.
        <FloatingPortal id="agency-overlays">
          <FloatingFocusManager
            context={context}
            modal={false}
            initialFocus={0}
          >
            <div
              ref={refs.setFloating}
              style={{ ...floatingStyles, zIndex: 90, overflowY: "auto" }}
              className={className}
              aria-label={label}
              onKeyDown={onKeyDown}
              {...getFloatingProps()}
            >
              {children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
