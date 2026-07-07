/**
 * Minimal, safe template engine for cold email bodies (plain text).
 * Supports {{token}}, {{#if token}}…{{/if}}, {{#unless token}}…{{/unless}},
 * and spintax {{a|b|c}} for copy variation (anti-fingerprinting — identical
 * bodies at scale trip duplicate-content filters).
 *
 * Spintax is DETERMINISTIC per `spinSeed` (we seed with recipientId:stepOrder)
 * so a retried send renders the exact copy that was attempted before, and the
 * stored ColdSend.subject stays the audit truth. Spintax options cannot
 * contain {{tokens}} — keep tokens outside the spin blocks.
 *
 * "", "0", and missing are falsy — so {{#if unansweredCount}} hides cleanly.
 */

/** FNV-1a 32-bit — stable string hash for the spintax PRNG seed. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG (no Math.random; PPR-safe). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderTemplate(
  tpl: string,
  tokens: Record<string, string>,
  spinSeed = "",
): string {
  // 1) Spintax pass FIRST: any {{…|…}} block that isn't a conditional/token.
  const rand = mulberry32(hashSeed(spinSeed));
  let out = tpl.replace(/\{\{([^{}]+)\}\}/g, (m, body: string) => {
    if (!body.includes("|") || body.startsWith("#") || body.startsWith("/")) {
      return m; // token or conditional — handled by the later passes
    }
    const options = body.split("|");
    return options[Math.floor(rand() * options.length)] ?? "";
  });

  const truthy = (k: string): boolean => {
    const v = tokens[k];
    return v != null && v !== "" && v !== "0";
  };
  out = out.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_m, k: string, body: string) => (truthy(k) ? body : ""),
  );
  out = out.replace(
    /\{\{#unless (\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
    (_m, k: string, body: string) => (truthy(k) ? "" : body),
  );
  out = out.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => tokens[k] ?? "");
  return out;
}

/**
 * Plain-text footer: physical postal address (CAN-SPAM 15 U.S.C. §7704(a)(5) /
 * CASL s.6(2)(b) — REQUIRED in every commercial email) + unsubscribe line.
 *
 * AUDIT TRAIL (T3/B6) · the 2026-06-09 cold-email audit flagged the postal
 * address as defined-but-never-wired (a CAN-SPAM violation on every send);
 * v0.15.6 restored it, and the 2026-07-07 touchpoints audit §6 re-raised the
 * stale finding. Verified wired end-to-end on 2026-07-07: BOTH send paths —
 * app/api/cron/process-cold-sequences/route.ts (cron) and
 * app/(admin)/admin/email/actions.ts (admin test send) — pass
 * `getColdSenderConfig().physicalAddress` (services/cold-mailer/config.ts)
 * into `buildTextFooter` + `toHtmlBody`. Locks: the required (non-optional)
 * `physicalAddress` param here, template.test.ts asserting the address IS
 * present in both footers, and cold-mailer.test.ts asserting the config
 * default is never empty. Do not make this param optional.
 */
export function buildTextFooter(
  unsubscribeUrl: string,
  physicalAddress: string,
): string {
  return `\n\n${physicalAddress}\nUnsubscribe: ${unsubscribeUrl}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkify(html: string): string {
  return html.replace(
    /(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u}">${u}</a>`,
  );
}

/**
 * Minimal HTML alternative: the plain body (URLs clickable, newlines preserved)
 * + a muted footer line carrying the postal address (legally required) and a
 * compact "Unsubscribe" link instead of a long raw URL.
 *
 * `openPixelUrl` (plan #7): when provided, appends the 1x1 open-tracking
 * pixel (`/o/[token]`, modules/cold/token.openPixelUrlFor). HTML part ONLY —
 * the plain-text alternative stays untracked by design, and no pixel ever
 * goes into Resend/mapsly.ai transactional mail (this builder is cold-only).
 */
export function toHtmlBody(
  plainBody: string,
  unsubscribeUrl: string,
  physicalAddress: string,
  openPixelUrl?: string,
): string {
  const body = linkify(escapeHtml(plainBody));
  const pixel = openPixelUrl
    ? `<img src="${escapeHtml(openPixelUrl)}" width="1" height="1" alt="" ` +
      `style="display:block;width:1px;height:1px;border:0">`
    : "";
  return (
    `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:14px;line-height:1.5;color:#222;white-space:pre-wrap">${body}</div>` +
    `<p style="font-size:12px;color:#999;margin-top:22px">` +
    `${escapeHtml(physicalAddress)} · ` +
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#999">Unsubscribe</a></p>` +
    pixel
  );
}
