/**
 * SMB dashboard · payload type definitions.
 *
 * `SmbDashboardData` is the flat shape the dashboard page renders from.
 * It denormalises one `Business` + its latest `BusinessSnapshot` into a
 * single object so the page doesn't have to drill through `snapshots[0]`
 * everywhere.
 *
 * `EMPTY_SMB_DASHBOARD` is the build-phase / no-biz / error short-circuit
 * shape per `.claude/rules/cache-components.md` Pattern 1. It MUST have
 * every field of the interface (including nullables) so TypeScript catches
 * partial shapes at literal-comparison time on Vercel build.
 *
 * Callers identify the empty state by `data.ownedBusinessId === ""`.
 */

export interface SmbDashboardData {
  /** Owned business id, or `""` for empty / build-phase. */
  ownedBusinessId: string;
  slug: string;
  name: string;
  category: string;
  city: string | null;
  province: string | null;

  /** Current Google rating (0–5), nullable until the first snapshot. */
  rating: number | null;
  /** Total Google review count, nullable until first snapshot. */
  reviewCount: number | null;
  isClaimed: boolean;

  /** Composite Mapsly Score 0–10, nullable until first snapshot. */
  mapslyScore: number | null;
  msiRank: number | null;
  msiTotal: number | null;
  replyRate: number | null;
  velocityLast30d: number | null;

  /** Per-dimension sub-scores (0–1), nullable until first snapshot. */
  reputationScore: number | null;
  communicationScore: number | null;
  profileCompletenessScore: number | null;
  trustScore: number | null;
  pricingTransparencyScore: number | null;
  brandPresenceScore: number | null;

  /** When the latest snapshot was written, nullable for new businesses. */
  lastSnapshotAt: Date | null;
}

/**
 * The canonical empty shape. Returned by `getSmbDashboardData` for:
 *
 *   - the user has no claimed business yet
 *   - we're in Vercel's build phase (NEXT_PHASE === 'phase-production-build')
 *   - Prisma threw an error
 *
 * Every field must be present (per `.claude/rules/cache-components.md`
 * Pattern 1) so TypeScript fails at compile time if the shape drifts from
 * `SmbDashboardData`.
 */
export const EMPTY_SMB_DASHBOARD: SmbDashboardData = {
  ownedBusinessId: "",
  slug: "",
  name: "",
  category: "",
  city: null,
  province: null,
  rating: null,
  reviewCount: null,
  isClaimed: false,
  mapslyScore: null,
  msiRank: null,
  msiTotal: null,
  replyRate: null,
  velocityLast30d: null,
  reputationScore: null,
  communicationScore: null,
  profileCompletenessScore: null,
  trustScore: null,
  pricingTransparencyScore: null,
  brandPresenceScore: null,
  lastSnapshotAt: null,
};
