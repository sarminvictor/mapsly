// Landing page placeholder — to be hydrated from _design/landing/index.html
// See PLAN.md → Phase 1.2 for landing migration sequencing
export default function HomePage() {
  return (
    <main
      style={{
        fontFamily: "Inter, sans-serif",
        background: "#faf6f1",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 24,
        padding: 32,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "Fraunces, serif",
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#c3553a",
            boxShadow: "0 0 12px rgba(195,85,58,.5)",
          }}
        />
        mapsly
      </div>
      <div
        style={{
          color: "#5c544d",
          fontSize: 14,
          maxWidth: 480,
          textAlign: "center",
          lineHeight: 1.55,
        }}
      >
        Local business intelligence — refreshed weekly. Build in progress. See{" "}
        <code>PLAN.md</code> for the roadmap.
      </div>
    </main>
  );
}
