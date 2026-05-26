"use client";

/**
 * Toast system · stackable transient notifications for the /admin
 * surface. Inspired by sonner / react-hot-toast but self-contained
 * (no new dep). Lives in the admin layout so every page has access
 * via useToast().
 *
 * Behavior:
 *   - Toasts stack top-right · newest at top
 *   - Auto-dismiss · success 4s · info 5s · error 8s · keep forever for `duration: 0`
 *   - Click any toast to dismiss it immediately
 *   - Visible progress bar shows time remaining
 *   - Slide-in / fade-out animation
 *   - aria-live polite for screen readers
 *
 * API:
 *   const toast = useToast();
 *   toast.success("Queued 25 businesses");
 *   toast.error("Worker unreachable");
 *   toast.info("Long message...");
 *   toast.show({ kind: "success", title: "Done", description: "More detail", duration: 6000 });
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** ms · 0 means stay until dismissed manually. */
  duration: number;
}

const DURATIONS: Record<ToastKind, number> = {
  success: 4_000,
  info: 5_000,
  warning: 6_000,
  error: 8_000,
};

interface ToastContextValue {
  show: (
    toast: Omit<Toast, "id" | "duration"> & {
      id?: string;
      duration?: number;
    },
  ) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error(
      "useToast() called outside <ToastProvider> — wrap your route in the admin layout",
    );
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastContextValue["show"]>((t) => {
    const id = t.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const duration = t.duration ?? DURATIONS[t.kind];
    setToasts((prev) => [
      { id, kind: t.kind, title: t.title, description: t.description, duration },
      ...prev,
    ].slice(0, 6)); // cap at 6 visible
    return id;
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    show,
    success: (title, description) => show({ kind: "success", title, description }),
    error: (title, description) => show({ kind: "error", title, description }),
    info: (title, description) => show({ kind: "info", title, description }),
    warning: (title, description) => show({ kind: "warning", title, description }),
    dismiss,
  }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/* ────────────────────────────────────────── viewport + single toast */

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "none", // children re-enable
        maxWidth: 420,
        width: "100%",
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (toast.duration === 0) return; // sticky
    const start = Date.now();
    const tick = window.setInterval(() => {
      setElapsed(Date.now() - start);
    }, 50);
    const timer = window.setTimeout(() => {
      setLeaving(true);
      window.setTimeout(onDismiss, 180); // match fade-out anim
    }, toast.duration);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(timer);
    };
  }, [toast.duration, onDismiss]);

  const pct =
    toast.duration === 0
      ? 0
      : Math.min(100, (elapsed / toast.duration) * 100);

  const palette = COLOR_BY_KIND[toast.kind];

  return (
    <div
      role="status"
      onClick={() => {
        setLeaving(true);
        window.setTimeout(onDismiss, 180);
      }}
      style={{
        pointerEvents: "auto",
        cursor: "pointer",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        borderRadius: 10,
        padding: "12px 14px",
        fontSize: 13,
        lineHeight: 1.4,
        fontFamily: "var(--font-sans, system-ui)",
        boxShadow:
          "0 4px 18px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.02) inset",
        position: "relative",
        overflow: "hidden",
        animation: leaving
          ? "toast-out 180ms ease forwards"
          : "toast-in 180ms ease forwards",
        opacity: leaving ? 0 : 1,
        transform: leaving ? "translateX(8px)" : "translateX(0)",
        transition: "transform 180ms ease, opacity 180ms ease",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span aria-hidden style={{ flexShrink: 0, marginTop: 1 }}>
          {ICON_BY_KIND[toast.kind]}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{toast.title}</div>
          {toast.description ? (
            <div
              style={{
                marginTop: 4,
                color: palette.fgMuted,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {toast.description}
            </div>
          ) : null}
        </div>
      </div>
      {toast.duration > 0 ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            background: palette.border,
            transform: `scaleX(${1 - pct / 100})`,
            transformOrigin: "right",
          }}
        />
      ) : null}
    </div>
  );
}

const COLOR_BY_KIND: Record<
  ToastKind,
  { bg: string; border: string; fg: string; fgMuted: string }
> = {
  success: {
    bg: "rgba(74, 222, 128, 0.10)",
    border: "rgba(74, 222, 128, 0.45)",
    fg: "#a7f3c2",
    fgMuted: "rgba(167, 243, 194, 0.78)",
  },
  error: {
    bg: "rgba(248, 113, 113, 0.12)",
    border: "rgba(248, 113, 113, 0.50)",
    fg: "#fca5a5",
    fgMuted: "rgba(252, 165, 165, 0.78)",
  },
  warning: {
    bg: "rgba(251, 191, 36, 0.12)",
    border: "rgba(251, 191, 36, 0.45)",
    fg: "#fcd34d",
    fgMuted: "rgba(252, 211, 77, 0.78)",
  },
  info: {
    bg: "rgba(111, 126, 255, 0.12)",
    border: "rgba(111, 126, 255, 0.50)",
    fg: "#a3b4ff",
    fgMuted: "rgba(163, 180, 255, 0.78)",
  },
};

const ICON_BY_KIND: Record<ToastKind, string> = {
  success: "✓",
  error: "✕",
  warning: "!",
  info: "i",
};

/* CSS keyframes · injected once on module mount. Avoids needing a
   global CSS file edit (admin.css) for this provider. */
if (typeof document !== "undefined" && !document.getElementById("toast-anim")) {
  const style = document.createElement("style");
  style.id = "toast-anim";
  style.textContent = `
    @keyframes toast-in {
      from { transform: translateX(20px); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    @keyframes toast-out {
      from { transform: translateX(0);   opacity: 1; }
      to   { transform: translateX(20px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
