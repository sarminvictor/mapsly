/**
 * SMB dashboard · audience-specific component library.
 *
 * Built on top of `components/ui` primitives (Button, Card, Pill, Modal).
 * These are Maria-facing components — cream + coral palette, warm copy
 * register, plain-English tooltips. Do not use in Agency routes; use the
 * `modules/agency-dashboard/components` library instead.
 *
 * See `.claude/rules/ui-ux-smb.md` for voice and density conventions and
 * `_design/product/home.html` for the original visual reference.
 *
 * E.0 ships:
 *   - KPITile · hero + standard variants for the dashboard state-bar
 *   - AlertCard · "needs your attention" rows
 *   - FixCard · numbered prioritized recommendations
 *   - ScoreBreakdown · 6-dim sub-score bar list
 *
 * Follow-ups (later phases):
 *   - Review reply card (modules/reviews/...)
 *   - Empty-state component (likely promoted to ui/ if reused agency-side)
 *   - Onboarding fix-card variant with primary CTA inline
 */

export { KPITile } from "./KPITile";
export type {
  KPITileProps,
  KPITileTone,
  KPITileTrend,
  KPITileVariant,
} from "./KPITile";

export { AlertCard } from "./AlertCard";
export type { AlertCardProps, AlertTone } from "./AlertCard";

export { FixCard } from "./FixCard";
export type { FixCardProps, FixCardTone } from "./FixCard";

export { ScoreBreakdown } from "./ScoreBreakdown";
export type {
  ScoreBreakdownProps,
  ScoreDimension,
  ScoreTone,
} from "./ScoreBreakdown";
