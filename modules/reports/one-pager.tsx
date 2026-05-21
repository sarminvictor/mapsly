/**
 * One-pager PDF document · F.6.
 *
 * Surface: agency one-pager — a single A4 page summarizing a prospect.
 * Tom (the agency owner) downloads this and emails it to a prospect
 * to anchor the pitch ("here's what we found · here's what we'd fix").
 *
 * Rendered server-side via `@react-pdf/renderer`'s `renderToBuffer` in
 * the route handler `app/api/reports/one-pager/[businessId]/route.ts`.
 * The Node-runtime requirement is documented there; this module is
 * just JSX-compiled-to-PDF.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *
 *   - Cool gray bg, indigo `#5b3df5` accent
 *   - Inter throughout (loaded as the platform default since we don't
 *     ship a font file in this iteration · @react-pdf falls back to
 *     Helvetica · acceptable for a print artifact, follow-up will
 *     wire a real Inter via `Font.register`)
 *   - Number-dense, jargon-OK · Tom is the audience
 *   - One page · A4 · 32pt margins
 *
 * Per `.claude/rules/security.md`:
 *
 *   - NO live external URLs in the body · everything is plain text
 *   - Footer credits the agency (input is the agency's `name` row,
 *     not user-supplied free-form)
 *
 * Per `.claude/rules/performance.md`:
 *
 *   - Pure presentational · no Prisma, no hooks, no async
 *   - Caller passes flat `OnePagerData` → easy to unit-test
 */

import * as React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

import type { OnePagerData } from "./one-pager-data";

/* --------------------------------------------------------- palette */

const COLOR = {
  bg: "#f6f7fb", // cool gray light
  card: "#ffffff",
  border: "#e5e7eb",
  text: "#0f172a",
  textMuted: "#475569",
  textFaint: "#94a3b8",
  indigo: "#5b3df5",
  accentLight: "#eef2ff",
  warning: "#b45309",
  warningLight: "#fef3c7",
  success: "#166534",
} as const;

/* ---------------------------------------------------- stylesheet */

const styles = StyleSheet.create({
  page: {
    backgroundColor: COLOR.bg,
    paddingTop: 32,
    paddingBottom: 32,
    paddingLeft: 32,
    paddingRight: 32,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLOR.text,
  },

  /* header strip */
  header: {
    backgroundColor: COLOR.card,
    borderRadius: 8,
    border: `1pt solid ${COLOR.border}`,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerLeft: { flexDirection: "column", maxWidth: "70%" },
  businessName: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: COLOR.text,
    marginBottom: 4,
  },
  metaLine: {
    fontSize: 10,
    color: COLOR.textMuted,
  },
  scoreBlock: {
    alignItems: "flex-end",
  },
  scoreValue: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    color: COLOR.indigo,
    lineHeight: 1,
  },
  scoreLabel: {
    fontSize: 8,
    color: COLOR.textFaint,
    marginTop: 2,
    fontFamily: "Helvetica",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  /* KPI row · 4 tiles */
  kpiRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  kpiTile: {
    flexGrow: 1,
    flexBasis: 0,
    backgroundColor: COLOR.card,
    borderRadius: 6,
    border: `1pt solid ${COLOR.border}`,
    padding: 10,
  },
  kpiLabel: {
    fontSize: 7.5,
    color: COLOR.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 13,
    color: COLOR.text,
    fontFamily: "Helvetica-Bold",
  },

  /* section block */
  section: {
    backgroundColor: COLOR.card,
    borderRadius: 8,
    border: `1pt solid ${COLOR.border}`,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLOR.text,
    marginBottom: 10,
  },

  /* wedges */
  wedge: {
    flexDirection: "row",
    marginBottom: 10,
  },
  wedgeNumberBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: COLOR.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  wedgeNumber: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: COLOR.indigo,
  },
  wedgeText: { flex: 1 },
  wedgeHeadline: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLOR.text,
    marginBottom: 2,
  },
  wedgeEvidence: {
    fontSize: 9,
    color: COLOR.textMuted,
    lineHeight: 1.4,
  },

  /* fixes */
  fix: {
    flexDirection: "row",
    marginBottom: 8,
    alignItems: "flex-start",
  },
  fixBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLOR.indigo,
    marginTop: 5,
    marginRight: 8,
  },
  fixArea: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLOR.text,
    marginRight: 6,
  },
  fixAction: {
    fontSize: 10,
    color: COLOR.textMuted,
    flex: 1,
  },

  /* footer */
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLOR.border,
    marginTop: 4,
  },
  footerText: {
    fontSize: 8,
    color: COLOR.textFaint,
  },
});

/* ----------------------------------------------------- component */

export interface OnePagerDocumentProps {
  data: OnePagerData;
}

/**
 * The React-PDF `<Document>` root. Stable between renders given the
 * same `data` so `renderToBuffer` yields byte-identical PDFs (useful
 * for downstream caching).
 */
export function OnePagerDocument({
  data,
}: OnePagerDocumentProps): React.ReactElement {
  return (
    <Document
      title={`${data.businessName} · One-pager`}
      author={data.preparedBy || "Mapsly"}
      subject="Local-business pitch summary"
      creator="Mapsly"
      producer="Mapsly · @react-pdf/renderer"
    >
      <Page size="A4" style={styles.page}>
        {/* Header strip */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.businessName}>{data.businessName}</Text>
            <Text style={styles.metaLine}>
              {[data.cityLine, data.category].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreValue}>{data.mapslyScore}</Text>
            <Text style={styles.scoreLabel}>Mapsly Score · /10</Text>
          </View>
        </View>

        {/* KPI strip · 4 tiles */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiTile}>
            <Text style={styles.kpiLabel}>Rating</Text>
            <Text style={styles.kpiValue}>{data.ratingLine}</Text>
          </View>
          <View style={styles.kpiTile}>
            <Text style={styles.kpiLabel}>Owner reply</Text>
            <Text style={styles.kpiValue}>{data.replyRateLine}</Text>
          </View>
          <View style={styles.kpiTile}>
            <Text style={styles.kpiLabel}>Mobile perf</Text>
            <Text style={styles.kpiValue}>{data.performanceLine}</Text>
          </View>
          <View style={styles.kpiTile}>
            <Text style={styles.kpiLabel}>Market position</Text>
            <Text style={styles.kpiValue}>{data.msiLine}</Text>
          </View>
        </View>

        {/* Why this lead qualifies · numbered pitch wedges */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Why this lead qualifies</Text>
          {data.pitchWedges.map((w) => (
            <View key={w.index} style={styles.wedge} wrap={false}>
              <View style={styles.wedgeNumberBox}>
                <Text style={styles.wedgeNumber}>{w.index}</Text>
              </View>
              <View style={styles.wedgeText}>
                <Text style={styles.wedgeHeadline}>{w.headline}</Text>
                <Text style={styles.wedgeEvidence}>{w.evidence}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* What we'd fix · 3 bullets */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What we'd fix in 30 days</Text>
          {data.fixes.map((f, idx) => (
            <View key={idx} style={styles.fix} wrap={false}>
              <View style={styles.fixBullet} />
              <Text style={styles.fixArea}>{f.area} ·</Text>
              <Text style={styles.fixAction}>{f.action}</Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {data.preparedBy} · {data.preparedDate}
          </Text>
          <Text style={styles.footerText}>Powered by Mapsly</Text>
        </View>
      </Page>
    </Document>
  );
}
