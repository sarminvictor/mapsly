"use client";

/**
 * Custom confirm dialog · replaces window.confirm() for admin actions.
 *
 * API:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "Remove Calgary?",
 *     body: "This deletes the cell and its run history.",
 *     confirmText: "Delete",
 *     danger: true,
 *   });
 *   if (!ok) return;
 *
 * Behavior:
 *   - Focus moves to confirm button on open
 *   - Esc cancels · backdrop click cancels · explicit Cancel cancels
 *   - Resolves with `true` on confirm · `false` on any cancel path
 *   - Disables page scroll while open
 *   - Single dialog at a time · second open() replaces the first (resolves it false)
 *   - aria-modal + role=dialog + labelledby pointing at title
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
  /** Use a red confirm button + warning visual treatment. */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    throw new Error(
      "useConfirm() called outside <ConfirmProvider> — wrap your route in the admin layout",
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
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  // If a new confirm opens while one is pending, resolve the old one false.
  const open = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending((prev) => {
        if (prev) prev.resolve(false);
        return { options, resolve };
      });
    });
  }, []);

  const close = useCallback(
    (ok: boolean) => {
      setPending((prev) => {
        if (prev) prev.resolve(ok);
        return null;
      });
    },
    [],
  );

  // Esc + scroll-lock side effects when a dialog is open
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the confirm button on next tick (after the DOM paints)
    const focusTimer = window.setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 10);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [pending, close]);

  const value = useMemo(() => open, [open]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending ? (
        <ConfirmDialog
          options={pending.options}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
          confirmRef={confirmBtnRef}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

/* ─────────────────────────────────────────────── visual */

function ConfirmDialog({
  options,
  onConfirm,
  onCancel,
  confirmRef,
}: {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
  confirmRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const danger = options.danger === true;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10_000,
        background: "rgba(11, 18, 36, 0.72)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "var(--font-sans, system-ui)",
        animation: "confirm-fade-in 140ms ease",
      }}
    >
      <div
        style={{
          background: "var(--admin-bg-1, #111a33)",
          border: `1px solid ${
            danger ? "rgba(248,113,113,.40)" : "var(--admin-border, #1f2b52)"
          }`,
          borderRadius: 12,
          padding: "22px 22px 18px",
          width: "100%",
          maxWidth: 440,
          color: "var(--admin-fg, #e5ecff)",
          boxShadow: "0 20px 60px rgba(0,0,0,.6)",
          animation: "confirm-pop-in 160ms ease",
        }}
      >
        {danger ? (
          <span
            aria-hidden
            style={{
              display: "inline-block",
              padding: "2px 8px",
              background: "rgba(248,113,113,.16)",
              color: "#fca5a5",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              borderRadius: 4,
              marginBottom: 12,
            }}
          >
            Destructive
          </span>
        ) : null}
        <h2
          id="confirm-title"
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {options.title}
        </h2>
        {options.body ? (
          <p
            style={{
              margin: "10px 0 18px",
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--admin-fg-2, #9fb0dc)",
            }}
          >
            {options.body}
          </p>
        ) : (
          <div style={{ height: 14 }} />
        )}
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="admin-btn"
            data-variant="ghost"
            style={{ padding: "8px 14px", fontSize: 12 }}
          >
            {options.cancelText ?? "Cancel"}
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            className="admin-btn"
            data-variant={danger ? "primary" : "primary"}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              ...(danger
                ? { background: "#f87171", borderColor: "#f87171", color: "#1a0a0a" }
                : {}),
            }}
          >
            {options.confirmText ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* keyframes injected once · same pattern as ToastProvider */
if (
  typeof document !== "undefined" &&
  !document.getElementById("confirm-anim")
) {
  const style = document.createElement("style");
  style.id = "confirm-anim";
  style.textContent = `
    @keyframes confirm-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes confirm-pop-in {
      from { transform: translateY(8px) scale(0.98); opacity: 0; }
      to   { transform: translateY(0)   scale(1);    opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}
