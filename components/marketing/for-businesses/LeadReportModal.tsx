"use client";

/**
 * LeadReportModal · the "we haven't analyzed you yet → get a free report by
 * email" capture form for /for-businesses. Opens from the hero search when
 * the autosuggest finds no landing for the typed business.
 *
 * Calls the `requestFreeReportAction` server action (capture + confirmation
 * email + ops alert — no live data pull). a11y: role="dialog" + aria-modal,
 * focus trap, Escape to close, backdrop dismiss, body scroll-lock, focus
 * restore on close (`.claude/rules/accessibility.md`).
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  requestFreeReportAction,
  type RequestFreeReportResult,
} from "@/modules/marketing-lead/actions";

import { ArrowGlyph } from "./fb-shared";

export interface LeadModalLabels {
  title: string;
  subtitle: string;
  businessLabel: string;
  businessPlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  submit: string;
  sending: string;
  successTitle: string;
  successBody: string;
  errorInvalid: string;
  errorRateLimited: string;
  errorGeneric: string;
  close: string;
}

interface LeadReportModalProps {
  onClose: () => void;
  labels: LeadModalLabels;
  /** Pre-fills the business-name field with what the visitor typed. */
  initialBusinessName: string;
  /** App locale, recorded on the lead row. */
  locale: string;
}

type Status = "idle" | "sending" | "success" | "error";
type ErrorKind = Extract<RequestFreeReportResult, { ok: false }>["error"];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LeadReportModal({
  onClose,
  labels,
  initialBusinessName,
  locale,
}: LeadReportModalProps) {
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();
  const errorId = useId();

  // Focus the right field on mount; restore focus to the trigger on unmount
  // (the modal is conditionally mounted by the parent, so mount === open).
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => {
      // If we prefilled a name, the next thing they need is their email.
      const target = initialBusinessName.trim()
        ? emailRef.current
        : nameRef.current;
      target?.focus();
    }, 0);
    // Lock background scroll.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, [initialBusinessName]);

  // Escape to close + Tab focus trap.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const errorMessage =
    errorKind === "invalid"
      ? labels.errorInvalid
      : errorKind === "rate_limited"
        ? labels.errorRateLimited
        : labels.errorGeneric;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setErrorKind(null);
    const res = await requestFreeReportAction({
      businessName,
      email,
      locale,
      sourceUrl:
        typeof window !== "undefined" ? window.location.href : undefined,
    });
    if (res.ok) {
      setStatus("success");
    } else {
      setErrorKind(res.error);
      setStatus("error");
    }
  }

  return (
    <div
      className="fb-modal-backdrop"
      onMouseDown={(e) => {
        // Dismiss only when the backdrop itself is pressed (not the dialog).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="fb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          className="fb-modal-close"
          aria-label={labels.close}
          onClick={onClose}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M2 2l12 12M14 2L2 14"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {status === "success" ? (
          <div className="fb-modal-success">
            <span className="fb-modal-check" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 18 18">
                <circle cx="9" cy="9" r="9" fill="var(--fb-yellow)" />
                <path
                  d="M5.2 9.3l2.4 2.4 5-5.4"
                  stroke="var(--fb-ink)"
                  strokeWidth="1.8"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h2 id={titleId} className="fb-modal-title">
              {labels.successTitle}
            </h2>
            <p id={descId} className="fb-modal-sub">
              {labels.successBody}
            </p>
            <button type="button" className="fb-btn" onClick={onClose}>
              {labels.close}
            </button>
          </div>
        ) : (
          <>
            <h2 id={titleId} className="fb-modal-title">
              {labels.title}
            </h2>
            <p id={descId} className="fb-modal-sub">
              {labels.subtitle}
            </p>

            <form
              className="fb-modal-form"
              onSubmit={onSubmit}
              noValidate
              aria-busy={status === "sending"}
            >
              <label className="fb-modal-label" htmlFor="fb-lead-business">
                {labels.businessLabel}
                <span className="fb-modal-req" aria-hidden>
                  {" *"}
                </span>
              </label>
              <input
                id="fb-lead-business"
                ref={nameRef}
                className="fb-modal-input"
                type="text"
                name="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder={labels.businessPlaceholder}
                autoComplete="organization"
                required
                aria-required="true"
                aria-invalid={status === "error" && errorKind === "invalid"}
                aria-describedby={status === "error" ? errorId : undefined}
                maxLength={120}
              />

              <label className="fb-modal-label" htmlFor="fb-lead-email">
                {labels.emailLabel}
                <span className="fb-modal-req" aria-hidden>
                  {" *"}
                </span>
              </label>
              <input
                id="fb-lead-email"
                ref={emailRef}
                className="fb-modal-input"
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={labels.emailPlaceholder}
                autoComplete="email"
                required
                aria-required="true"
                aria-invalid={status === "error" && errorKind === "invalid"}
                aria-describedby={status === "error" ? errorId : undefined}
                maxLength={320}
              />

              {status === "error" && (
                <p id={errorId} className="fb-modal-error" role="alert">
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                className="fb-btn fb-modal-submit"
                disabled={status === "sending"}
              >
                {status === "sending" ? labels.sending : labels.submit}{" "}
                <ArrowGlyph />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
