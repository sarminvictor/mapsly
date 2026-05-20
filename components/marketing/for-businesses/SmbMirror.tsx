import * as React from "react";

/**
 * SmbMirror · "Your weekly check-in" preview.
 *
 * Four numbered tiles imitating Maria's actual dashboard layout. Big numbers,
 * generous whitespace, one CTA per tile would be too many — so each tile is
 * read-only (the page-level CTA is the only conversion path).
 *
 * Pure server component.
 */
interface SmbMirrorProps {
  t: (key: string) => string;
}

const TILES = [
  { key: "block_1", emphasize: true },
  { key: "block_2", emphasize: false },
  { key: "block_3", emphasize: false },
  { key: "block_4", emphasize: false },
];

export function SmbMirror({ t }: SmbMirrorProps) {
  return (
    <section
      aria-labelledby="for-businesses-mirror-title"
      style={{
        padding: "96px 24px",
        background:
          "linear-gradient(180deg, var(--color-bg-2) 0%, var(--color-bg-3) 100%)",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--color-coral)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              marginBottom: 12,
            }}
          >
            {t("mirror.eyebrow")}
          </div>
          <h2
            id="for-businesses-mirror-title"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(32px, 4vw, 52px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              margin: "0 auto 20px",
              color: "var(--color-text)",
              maxWidth: 880,
            }}
          >
            {t("mirror.title")}
          </h2>
          <p
            style={{
              fontSize: 18,
              color: "var(--color-text-2)",
              lineHeight: 1.55,
              margin: "0 auto",
              maxWidth: 680,
            }}
          >
            {t("mirror.sub")}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {TILES.map((tile) => (
            <article
              key={tile.key}
              style={{
                padding: "28px 24px",
                background: tile.emphasize
                  ? "linear-gradient(180deg, var(--color-coral) 0%, var(--color-coral) 100%)"
                  : "var(--color-bg-2)",
                color: tile.emphasize ? "#fff" : "var(--color-text)",
                borderRadius: 14,
                border: tile.emphasize
                  ? "1px solid var(--color-coral)"
                  : "1px solid var(--color-border)",
                boxShadow: tile.emphasize
                  ? "0 14px 36px rgba(195,85,58,.18)"
                  : "0 1px 2px rgba(28,25,22,.04)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                minHeight: 180,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: tile.emphasize ? "rgba(255,255,255,.85)" : "var(--color-text-3)",
                }}
              >
                {t(`mirror.${tile.key}_label`)}
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontWeight: 700,
                    fontSize: tile.emphasize ? 56 : 44,
                    lineHeight: 1,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {t(`mirror.${tile.key}_number`)}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontFamily: "var(--font-mono)",
                    color: tile.emphasize ? "rgba(255,255,255,.85)" : "var(--color-text-3)",
                  }}
                >
                  {t(`mirror.${tile.key}_unit`)}
                </span>
              </div>

              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: tile.emphasize ? "rgba(255,255,255,.9)" : "var(--color-text-2)",
                }}
              >
                {t(`mirror.${tile.key}_desc`)}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
