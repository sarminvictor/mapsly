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

/** CAN-SPAM / CASL footer: sender identity + physical address + unsubscribe. */
export function buildFooter(
  physicalAddress: string,
  unsubscribeUrl: string,
): string {
  const addr = physicalAddress ? `\n${physicalAddress}` : "";
  return `\n\n—\nMapsly${addr}\nNot relevant? Unsubscribe here: ${unsubscribeUrl}`;
}
