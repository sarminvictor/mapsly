// dev.mapsly.ai/ui · Component showcase
//
// Renders every B.0 design-system primitive with all variants × both
// audience palettes (SMB cream/coral · Agency cool-gray/indigo) so
// reviewers can eyeball the system without scrolling through prod routes.
//
// Pure server component. No client JS except where the primitive itself
// is "use client" (Modal). The page is `noindex,nofollow` per dev-subdomain
// convention.

import type { Metadata } from "next";
import Link from "next/link";
import { Button, Input, Card, Tile, Pill } from "@/components/ui";
import UiShowcaseModalDemo from "./ModalDemo";

export const metadata: Metadata = {
  title: "Mapsly · UI showcase",
  description: "B.0 design-system primitives × variants × audiences",
  robots: { index: false, follow: false },
};

const sectionStyle: React.CSSProperties = {
  padding: "32px 24px",
  borderBottom: "1px solid var(--color-border, #e5e7eb)",
};
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 16,
  marginTop: 16,
};
const audienceLabel: React.CSSProperties = {
  fontSize: 12,
  fontFamily: "JetBrains Mono, monospace",
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 8,
};
const swatch: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "#f9fafb",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
};

export default function UiShowcasePage() {
  return (
    <div style={{ background: "#fff", minHeight: "100vh", color: "#0f172a" }}>
      {/* Header */}
      <header
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              fontFamily: "Fraunces, serif",
              margin: 0,
            }}
          >
            UI showcase
          </h1>
          <p style={{ color: "#6b7280", margin: "4px 0 0", fontSize: 13 }}>
            B.0 design-system primitives · live preview · both audience palettes
          </p>
        </div>
        <Link
          href="/"
          style={{
            color: "#5b3df5",
            fontSize: 13,
            fontFamily: "JetBrains Mono, monospace",
            textDecoration: "none",
          }}
        >
          ← back to dashboard
        </Link>
      </header>

      {/* BUTTON */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Button</h2>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          4 variants · 3 sizes · 2 audience palettes · leading/trailing icons ·
          block mode
        </p>

        <div style={audienceLabel}>SMB · cream + coral</div>
        <div style={grid}>
          <div style={swatch}>
            <Button audience="smb" variant="primary">
              Primary
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="smb" variant="secondary">
              Secondary
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="smb" variant="destructive">
              Destructive
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="smb" variant="ghost">
              Ghost
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="smb" size="sm">
              Small
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="smb" size="md">
              Medium
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="smb" size="lg">
              Large
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="smb" disabled>
              Disabled
            </Button>
          </div>
        </div>

        <div style={{ ...audienceLabel, marginTop: 24 }}>
          Agency · cool-gray + indigo
        </div>
        <div style={grid}>
          <div style={swatch}>
            <Button audience="agency" variant="primary">
              Primary
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="agency" variant="secondary">
              Secondary
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="agency" variant="destructive">
              Destructive
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="agency" variant="ghost">
              Ghost
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="agency" size="sm">
              Small
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="agency" size="md">
              Medium
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="agency" size="lg">
              Large
            </Button>
          </div>
          <div style={swatch}>
            <Button audience="agency" disabled>
              Disabled
            </Button>
          </div>
        </div>
      </section>

      {/* PILL */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Pill</h2>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          11 tones · 2 sizes · 2 audiences · color + label (never color alone)
        </p>

        <div style={audienceLabel}>Status tones · agency lead lifecycle</div>
        <div style={{ ...grid, gridTemplateColumns: "repeat(6, 1fr)" }}>
          <div style={swatch}>
            <Pill tone="new">New</Pill>
          </div>
          <div style={swatch}>
            <Pill tone="contacted">Contacted</Pill>
          </div>
          <div style={swatch}>
            <Pill tone="replied">Replied</Pill>
          </div>
          <div style={swatch}>
            <Pill tone="won">Won</Pill>
          </div>
          <div style={swatch}>
            <Pill tone="lost">Lost</Pill>
          </div>
          <div style={swatch}>
            <Pill tone="hidden">Hidden</Pill>
          </div>
        </div>

        <div style={{ ...audienceLabel, marginTop: 24 }}>
          Generic tones · SMB + agency
        </div>
        <div style={{ ...grid, gridTemplateColumns: "repeat(5, 1fr)" }}>
          <div style={swatch}>
            <Pill tone="neutral">Neutral</Pill>
          </div>
          <div style={swatch}>
            <Pill tone="info">Info</Pill>
          </div>
          <div style={swatch}>
            <Pill tone="good">Good</Pill>
          </div>
          <div style={swatch}>
            <Pill tone="warn">Warn</Pill>
          </div>
          <div style={swatch}>
            <Pill tone="bad">Bad</Pill>
          </div>
        </div>

        <div style={{ ...audienceLabel, marginTop: 24 }}>Sizes</div>
        <div style={{ ...grid, gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div style={swatch}>
            <Pill size="sm">Small SMB</Pill>
          </div>
          <div style={swatch}>
            <Pill size="md">Medium SMB</Pill>
          </div>
          <div style={swatch}>
            <Pill size="sm" audience="agency">
              Small Agency
            </Pill>
          </div>
          <div style={swatch}>
            <Pill size="md" audience="agency">
              Medium Agency
            </Pill>
          </div>
        </div>
      </section>

      {/* TILE */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Tile</h2>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          KPI display · big number + label + sublabel + trend · 4 tones · 2
          audiences (SMB uses serif, Agency uses Inter)
        </p>

        <div style={audienceLabel}>SMB · Maria&apos;s dashboard</div>
        <div style={{ ...grid, gridTemplateColumns: "repeat(3, 1fr)" }}>
          <Tile
            audience="smb"
            label="Mapsly Score"
            value="6.2"
            unit="/10"
            sublabel="↑ 0.4 vs last week"
            trend="up"
            tone="good"
          />
          <Tile
            audience="smb"
            label="New reviews"
            value="3"
            sublabel="this week"
            tone="neutral"
          />
          <Tile
            audience="smb"
            label="Unanswered"
            value="8"
            sublabel="1★ + 2★ pending"
            tone="warn"
          />
        </div>

        <div style={{ ...audienceLabel, marginTop: 24 }}>
          Agency · Tom&apos;s prospect list
        </div>
        <div style={{ ...grid, gridTemplateColumns: "repeat(3, 1fr)" }}>
          <Tile
            audience="agency"
            label="Qualified leads"
            value="47"
            sublabel="+ 12 this week"
            trend="up"
            tone="good"
          />
          <Tile
            audience="agency"
            label="Contacted"
            value="14"
            unit="/ 47"
            sublabel="30% reach rate"
          />
          <Tile
            audience="agency"
            label="Lost"
            value="3"
            sublabel="manual prune"
            tone="bad"
          />
        </div>
      </section>

      {/* CARD */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Card</h2>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          Generic container · 2 densities (comfortable / compact) · 2 audiences
          · polymorphic `as` · `interactive` (clickable)
        </p>

        <div style={audienceLabel}>SMB · comfortable density</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 16,
          }}
        >
          <Card audience="smb" density="comfortable">
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              Solea Brickell Spa
            </h3>
            <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 14 }}>
              Med-spa · Miami, FL · Open today 10–6
            </p>
          </Card>
          <Card audience="smb" density="comfortable" interactive>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              Interactive card →
            </h3>
            <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 14 }}>
              Hover lifts the surface · cursor becomes pointer
            </p>
          </Card>
        </div>

        <div style={{ ...audienceLabel, marginTop: 24 }}>
          Agency · compact density (dense tables)
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 16,
          }}
        >
          <Card audience="agency" density="compact">
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
              Anchor Local · 47 leads
            </h3>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 12 }}>
              Last refresh: 2026-05-20 18:00 UTC · 6 lists · 14 contacted
            </p>
          </Card>
          <Card audience="agency" density="compact" interactive>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
              Click to drill in →
            </h3>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 12 }}>
              Keyboard: ↵ activates · arrow-keys navigate
            </p>
          </Card>
        </div>
      </section>

      {/* INPUT */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Input</h2>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          Label + hint + error states · 2 audience focus rings · forwardRef +
          all native HTMLInputElement props
        </p>

        <div style={audienceLabel}>SMB · cream + coral focus ring</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 24,
          }}
        >
          <Input
            audience="smb"
            label="Business name"
            placeholder="Solea Brickell Spa"
          />
          <Input
            audience="smb"
            label="Email"
            type="email"
            placeholder="maria@solea.com"
            hint="We'll use this for weekly check-ins."
          />
          <Input
            audience="smb"
            label="Phone"
            placeholder="(305) 555-0100"
            error="That doesn't look like a US phone number."
          />
          <Input
            audience="smb"
            label="Read-only"
            defaultValue="Pre-filled value"
            readOnly
          />
        </div>

        <div style={{ ...audienceLabel, marginTop: 24 }}>
          Agency · cool-gray + indigo focus ring
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 24,
          }}
        >
          <Input
            audience="agency"
            label="List name"
            placeholder="Med-spas in Miami · 4.4★ · &lt;5 reviews/mo"
          />
          <Input
            audience="agency"
            label="Min reply rate"
            type="number"
            placeholder="0–100"
            hint="% of last 20 reviews with owner_answer"
          />
        </div>
      </section>

      {/* MODAL — client component because it manages open state */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Modal</h2>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          Accessible dialog · focus trap · Escape-to-close · aria-modal
        </p>
        <UiShowcaseModalDemo />
      </section>

      {/* Footer */}
      <footer
        style={{
          padding: 24,
          color: "#6b7280",
          fontSize: 12,
          fontFamily: "JetBrains Mono, monospace",
          textAlign: "center",
        }}
      >
        B.0 design system · 6 primitives · 2 audience palettes ·{" "}
        <Link
          href="https://github.com/sarminvictor/mapsly/tree/main/components/ui"
          style={{ color: "#5b3df5" }}
        >
          source on GitHub
        </Link>
      </footer>
    </div>
  );
}
