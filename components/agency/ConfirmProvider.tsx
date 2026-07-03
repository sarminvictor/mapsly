"use client";

/**
 * Agency-styled confirm dialog · replaces native window.confirm() across the
 * agency portal (cool-gray/indigo system, reuses the .overlay/.modal/.btn
 * classes). Mirrors the admin ConfirmProvider API so call sites read the same:
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: 'Delete template "Custom"?',
 *     body: "Its 2 saved signals are lost.",
 *     confirmText: "Delete",
 *     danger: true,
 *   });
 *   if (!ok) return;
 *
 * Behavior (WCAG 2.1 AA · role=dialog + aria-modal + labelledby):
 *   - Focus moves to the confirm button on open; Tab/Shift+Tab are TRAPPED
 *     inside the dialog (focus can't fall behind the scrim); focus RETURNS to
 *     the element that opened the dialog on close.
 *   - Esc / backdrop / Cancel resolve false. Enter activates the FOCUSED button
 *     natively — Enter on Confirm confirms, Enter on Cancel cancels (no global
 *     Enter handler, so a stray Enter can never resolve a destructive dialog).
 *   - Page scroll is locked while open. A second open() resolves the first false.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button + destructive treatment. */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    throw new Error(
      "useConfirm() called outside <ConfirmProvider> — wrap the agency layout",
    );
  }
  return fn;
}

interface PendingState {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);

  const open = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending((prev) => {
        if (prev) prev.resolve(false);
        return { options, resolve };
      });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    setPending((prev) => {
      if (prev) prev.resolve(ok);
      return null;
    });
  }, []);

  const value = useMemo(() => open, [open]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending ? (
        <ConfirmDialog
          options={pending.options}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ConfirmDialog({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const danger = options.danger === true;
  const modalRef = useRef<HTMLDivElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Remember what to restore focus to, then move focus into the dialog.
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(
      () => confirmBtnRef.current?.focus(),
      10,
    );
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      // Tab focus-trap: keep Tab / Shift+Tab cycling within the dialog so focus
      // can't fall behind the scrim to the (non-inert) page (a11y rule: a
      // role=dialog aria-modal must not leak focus).
      if (e.key === "Tab" && modalRef.current) {
        const items = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (active && !modalRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusTimer);
      // Return focus to whatever opened the dialog (the delete/remove button).
      prevFocus?.focus?.();
    };
  }, [onCancel]);

  return (
    <div
      className="overlay center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agency-confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal confirm-modal" ref={modalRef}>
        <div className="mbody">
          <h2 id="agency-confirm-title" className="confirm-title">
            {options.title}
          </h2>
          {options.body ? <p className="confirm-body">{options.body}</p> : null}
        </div>
        <div className="mfoot" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onCancel}>
            {options.cancelText ?? "Cancel"}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`btn ${danger ? "danger" : "primary"}`}
            onClick={onConfirm}
          >
            {options.confirmText ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
