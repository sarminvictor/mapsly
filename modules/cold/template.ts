/**
 * Minimal, safe template engine for cold email bodies (plain text).
 * Supports {{token}}, {{#if token}}…{{/if}}, {{#unless token}}…{{/unless}}.
 * "", "0", and missing are falsy — so {{#if unansweredCount}} hides cleanly.
 */
export function renderTemplate(
  tpl: string,
  tokens: Record<string, string>,
): string {
  const truthy = (k: string): boolean => {
    const v = tokens[k];
    return v != null && v !== "" && v !== "0";
  };
  let out = tpl.replace(
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

/** Plain-text footer: a minimal unsubscribe line (no postal address). */
export function buildTextFooter(unsubscribeUrl: string): string {
  return `\n\nUnsubscribe: ${unsubscribeUrl}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function linkify(html: string): string {
  return html.replace(
    /(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u}">${u}</a>`,
  );
}

/**
 * Minimal HTML alternative: the plain body (URLs clickable, newlines preserved)
 * + a small "Unsubscribe" link instead of a long raw URL.
 */
export function toHtmlBody(plainBody: string, unsubscribeUrl: string): string {
  const body = linkify(escapeHtml(plainBody));
  return (
    `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:14px;line-height:1.5;color:#222;white-space:pre-wrap">${body}</div>` +
    `<p style="font-size:12px;color:#999;margin-top:22px">` +
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#999">Unsubscribe</a></p>`
  );
}
