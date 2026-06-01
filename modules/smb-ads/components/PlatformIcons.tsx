// SMB /ads · compact platform badges with hover/focus tooltips. Replaces the
// long "Facebook, Instagram, Audience Network, …" text — a row of small
// brand-colored monograms, each with a `title` + `aria-label` so the full name
// is one hover away. Server component · pure presentation.

import * as React from "react";

const PLATFORMS: Record<string, { abbr: string; label: string; bg: string }> = {
  FACEBOOK: { abbr: "f", label: "Facebook", bg: "#1877F2" },
  INSTAGRAM: { abbr: "IG", label: "Instagram", bg: "#E4405F" },
  MESSENGER: { abbr: "M", label: "Messenger", bg: "#A033FF" },
  WHATSAPP: { abbr: "WA", label: "WhatsApp", bg: "#25D366" },
  AUDIENCE_NETWORK: { abbr: "AN", label: "Audience Network", bg: "#5b6b7b" },
  THREADS: { abbr: "@", label: "Threads", bg: "#111111" },
};

export function PlatformIcons({ platforms }: { platforms: readonly string[] }) {
  const known = platforms
    .map((p) => ({ code: p, meta: PLATFORMS[p.toUpperCase()] }))
    .filter((x): x is { code: string; meta: (typeof PLATFORMS)[string] } =>
      Boolean(x.meta),
    );
  if (known.length === 0) {
    return <span style={{ color: "var(--color-text-3)" }}>—</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {known.map(({ code, meta }) => (
        <span
          key={code}
          title={meta.label}
          aria-label={meta.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 20,
            height: 20,
            padding: "0 5px",
            borderRadius: 5,
            background: meta.bg,
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            fontFamily: "var(--font-mono)",
          }}
        >
          {meta.abbr}
        </span>
      ))}
    </span>
  );
}
