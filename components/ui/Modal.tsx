"use client";

import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Modal · accessible overlay dialog with focus trap + Escape-to-close.
 *
 * Controlled via `open` prop. Caller is responsible for state management.
 * Renders inline (caller owns its stacking-context); the dialog itself is
 * fixed-positioned, so most pages do not need a portal. If a parent applies
 * `transform`/`filter`/`will-change`, lift the Modal to a sibling of <body>.
 *
 * A11y per `.claude/rules/accessibility.md`:
 * - role="dialog" + aria-modal="true"
 * - aria-labelledby points to the title id
 * - focus moves into the modal on open, returns to trigger on close
 * - Escape closes
 * - Trap focus inside while open
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Modal title — renders as <h2>, also used for aria-labelledby. */
  title: React.ReactNode;
  /** Optional description below the title. */
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Footer slot — typically primary + secondary buttons. */
  footer?: React.ReactNode;
  /** Maximum width in px. Default 480. */
  maxWidth?: number;
  /** Click on the backdrop closes by default; set false to disable. */
  closeOnBackdrop?: boolean;
  /** Audience palette · only affects accent ring/focus color. */
  audience?: "smb" | "agency";
  /** Optional className applied to the dialog surface. */
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 480,
  closeOnBackdrop = true,
  audience = "smb",
  className,
}: ModalProps) {
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descId = React.useId();

  // Lock background scroll, restore focus on close
  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the first focusable element inside the dialog
    const focusFirst = () => {
      const node = dialogRef.current;
      if (!node) return;
      const candidates = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = candidates[0] ?? node;
      first.focus();
    };
    // Defer so portal content is in the DOM
    const tid = window.setTimeout(focusFirst, 0);

    return () => {
      window.clearTimeout(tid);
      document.body.style.overflow = originalOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Escape + Tab focus-trap
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = dialogRef.current;
      if (!node) return;
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const accent =
    audience === "agency"
      ? "0 0 0 4px rgba(91,61,245,.18)"
      : "0 0 0 4px rgba(195,85,58,.18)";

  return (
    <div
      aria-hidden={false}
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28,25,22,.50)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 100,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description != null ? descId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn("mapsly-modal", className)}
        data-audience={audience}
        style={{
          width: "100%",
          maxWidth,
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          padding: 24,
          boxShadow: `0 24px 48px rgba(28,25,22,.18), ${accent}`,
          fontFamily: "var(--font-sans)",
          color: "var(--color-text)",
          outline: "none",
          maxHeight: "calc(100vh - 32px)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2
          id={titleId}
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            lineHeight: 1.3,
            color: "var(--color-text)",
          }}
        >
          {title}
        </h2>

        {description != null ? (
          <p
            id={descId}
            style={{
              margin: 0,
              fontSize: 14,
              color: "var(--color-text-2)",
              lineHeight: 1.5,
            }}
          >
            {description}
          </p>
        ) : null}

        {children != null ? (
          <div style={{ marginTop: 4, overflow: "auto", flex: 1 }}>
            {children}
          </div>
        ) : null}

        {footer != null ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
