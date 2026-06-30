/**
 * The gold radial-gradient credit coin from the prototype (`.ic-coin`).
 *
 * Pure presentation — the gradient lives in `agency-portal.css` under the
 * `.agency-portal` scope, so this is just the decorative span. Always
 * `aria-hidden` (the number beside it carries the meaning).
 */
export function CoinGlyph({ sm = false }: { sm?: boolean }) {
  return <span className={sm ? "ic-coin sm" : "ic-coin"} aria-hidden="true" />;
}
