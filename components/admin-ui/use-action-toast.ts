"use client";

/**
 * `useActionToast` · pushes a toast when a useActionState result lands.
 *
 * Every admin action returns `ActionResult<T> = { ok: true, message? }
 * | { ok: false, error }`. This hook watches the state and surfaces
 * either a success or error toast on each new transition. The
 * `dedupeKey` (defaults to the result's JSON shape) prevents the same
 * toast firing twice on re-renders that don't actually change state.
 */

import { useEffect, useRef } from "react";

import { useToast } from "./ToastProvider";

interface ActionResultShape {
  ok: boolean;
  message?: string;
  error?: string;
}

export function useActionToast<T extends ActionResultShape | null>(
  state: T,
  options: {
    /** Override the success message · default is state.message. */
    successTitle?: string;
    /** Override the error message · default is state.error. */
    errorTitle?: string;
  } = {},
): void {
  const toast = useToast();
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state) return;
    const sig = JSON.stringify(state);
    if (sig === lastSignatureRef.current) return;
    lastSignatureRef.current = sig;

    if (state.ok) {
      const title = options.successTitle ?? state.message ?? "Done.";
      toast.success(title);
    } else {
      const title =
        options.errorTitle ?? state.error ?? "Something went wrong.";
      toast.error(title);
    }
  }, [state, toast, options.successTitle, options.errorTitle]);
}
