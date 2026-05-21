/**
 * 404 for `/biz/[slug]` · the slug doesn't match an active business.
 *
 * Voice per `.claude/rules/copy-voice.md` shared rules — short, plain
 * English, no jargon. Offers a hand back to /for-businesses (the most
 * relevant landing for someone who arrived here from a search).
 *
 * Pure server component · zero client JS · matches the marketing layout's
 * cream + coral tokens.
 */
export default function BizNotFound() {
  return (
    <section
      aria-labelledby="biz-404-title"
      style={{
        padding: "96px 24px 64px",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <p
          style={{
            margin: 0,
            color: "var(--color-text-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          404
        </p>
        <h1
          id="biz-404-title"
          style={{
            margin: "12px 0 16px",
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 40px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: "var(--color-text)",
          }}
        >
          We couldn't find that business.
        </h1>
        <p
          style={{
            margin: "0 auto 24px",
            color: "var(--color-text-2)",
            fontSize: 16,
            lineHeight: 1.5,
            maxWidth: 380,
          }}
        >
          The link may be stale or the business may have closed. Try a fresh
          search.
        </p>
        <a
          href="/for-businesses"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "12px 22px",
            borderRadius: 10,
            background: "var(--color-coral)",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          Look up your business
        </a>
      </div>
    </section>
  );
}
