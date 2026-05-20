// Pure pattern-detection logic for the process-enhancer agent (H.6).
//
// This module has NO DB or network deps so it can be:
//   1. unit-tested via Vitest with synthetic inputs
//   2. imported from scripts/process-enhancer-dryrun.ts
//   3. imported from a future app/api/cron/daily/process-enhancer route
//
// The agent prompt (.claude/agents/process-enhancer.md) describes additional
// patterns (PR auto-merge failures, Sentry clustering, scorer trends) that
// require live MCP calls; those are layered ON TOP of this pure detector,
// not in place of it.

import { readFileSync, existsSync } from "node:fs";

export interface IncidentEntry {
  id: string;
  tags: string[];
  /**
   * Status marker from the `**Status:**` line (v0.6.25+). Common values:
   * - `✅ FIXED + ENCODED` / `🟡 FIXED + VERIFICATION-PENDING`
   * - `♻️ SUPERSEDED BY INC-NN` — fix is no longer relevant; older arch.
   * - `✅ ACTIVE DESIGN` / `✅ ACTIVE DESIGN PRINCIPLE`
   * Undefined or empty string if the INC was logged before the v0.6.25
   * audit convention.
   */
  status?: string;
  /** raw block text (everything after `### INC-...`) */
  body: string;
}

export interface BuildLogStats {
  /** map of INC- id → number of citations across build-log.md */
  citationCount: Map<string, number>;
  /** total number of INC- mentions */
  total: number;
}

export interface EnhanceSignal {
  id: string;
  category: string;
  detected: string;
  severity: "info" | "warn" | "error";
  headline: string;
  evidence: string;
  action: string;
  prDrafted?: boolean;
  prUrl?: string;
}

export interface DetectorContext {
  /** Override the timestamp used in generated signal IDs/`detected`. */
  now?: () => Date;
  /**
   * Directory holding rule files (`.claude/rules/`). When provided, Pattern 2
   * checks whether a rule file already covers the cluster and silences the
   * signal if so. Defaults to `.claude/rules` when unset.
   */
  rulesDir?: string;
  /**
   * Test-only override for the rule-existence check, used to avoid touching
   * disk in unit tests. When provided, takes precedence over `rulesDir`.
   */
  ruleExists?: (relPath: string) => boolean;
}

/**
 * Map a tag → the canonical rule file that covers it. When the rule file
 * exists on disk, the incident-cluster signal for that tag is silenced.
 * Update this map when new rules ship that cover existing tag clusters.
 *
 * Multiple tags can point to the same rule (e.g. `cacheComponents` and
 * `cache-components` both → cache-components.md). A tag with no entry
 * here ALWAYS produces a signal once it hits CLUSTER_THRESHOLD — that's
 * the explicit way to flag a genuinely-uncovered domain.
 */
export const TAG_TO_RULE: Readonly<Record<string, string>> = {
  // i18n + next-intl cluster
  "next-intl": "i18n.md",
  i18n: "i18n.md",

  // Caching + cacheComponents cluster
  cacheComponents: "cache-components.md",
  "cache-components": "cache-components.md",
  ppr: "cache-components.md",
  "build-phase": "cache-components.md",
  "empty-state-constants": "cache-components.md",

  // Git + commit identity
  git: "git-discipline.md",
  "commit-author": "git-discipline.md",
  github: "git-discipline.md",

  // Sandbox cluster (all SUPERSEDED by INC-31's /tmp architecture but tag still here)
  sandbox: "capability-routing.md",
  fuse: "capability-routing.md",
  "scheduler-mode": "capability-routing.md",
  "cowork-canonical": "capability-routing.md",
  cowork: "capability-routing.md",
  "/tmp": "capability-routing.md",

  // Loop cluster
  loop: "loop-discipline.md",
  "loop-design": "loop-discipline.md",
  "capability-routing": "capability-routing.md",
  "loop-orchestration": "agent-orchestration.md",

  // Prisma cluster
  prisma: "prisma.md",
  "prisma-7": "prisma.md",
  "adapter-neon": "prisma.md",
  "neon-adapter": "prisma.md",
  neon: "prisma.md",
  "schema-drift": "prisma.md",
  "postgres-null-arithmetic": "prisma.md",
  "postgres-types": "prisma.md",
  "raw-sql": "prisma.md",

  // Vercel cluster
  vercel: "vercel.md",
  "vercel-build": "vercel.md",
  "vercel-cli": "vercel.md",
  "vercel-deploy": "vercel.md",
  "env-vars": "vercel.md",
  "module-load": "vercel.md",
};

/**
 * Internal: check whether the rule file for a tag exists on disk.
 * Honors context override for unit-tested code paths.
 */
function tagIsCovered(tag: string, ctx: DetectorContext): boolean {
  const ruleName = TAG_TO_RULE[tag];
  if (!ruleName) return false;
  if (ctx.ruleExists) return ctx.ruleExists(ruleName);
  const rulesDir = ctx.rulesDir ?? ".claude/rules";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path");
    return existsSync(path.join(rulesDir, ruleName));
  } catch {
    return false;
  }
}

/**
 * Parse .claude/memory/incidents.md into a list of INC entries with tags.
 * Handles the canonical `### INC-YYYY-MM-DD-NN` header form plus the
 * `**Tags:** a, b, c` line. Resilient to missing tags line.
 */
export function parseIncidents(markdown: string): IncidentEntry[] {
  const entries: IncidentEntry[] = [];
  // Split on lines starting with `### ` so each block has its full body
  const blocks = markdown.split(/^### /m);
  for (const block of blocks) {
    const idMatch = block.match(/^(INC-\d{4}-\d{2}-\d{2}-\d{2})/);
    if (!idMatch) continue;
    const tagsMatch = block.match(/\*\*Tags:\*\*\s*([^\n]+)/);
    const tags = (tagsMatch?.[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const statusMatch = block.match(/\*\*Status:\*\*\s*([^\n]+)/);
    const status = (statusMatch?.[1] ?? "").trim();
    entries.push({ id: idMatch[1], tags, status, body: block });
  }
  return entries;
}

/**
 * Count INC- citations inside build-log.md. Mentions inside the file's own
 * front-matter header are also counted — that's intentional, the citation
 * matters wherever it lands.
 */
export function parseBuildLogCitations(text: string): BuildLogStats {
  const matches = [...text.matchAll(/INC-\d{4}-\d{2}-\d{2}-\d{2}/g)];
  const counts = new Map<string, number>();
  for (const m of matches) {
    counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  }
  return { citationCount: counts, total: matches.length };
}

/** Minimum citations of a single INC- before we treat it as recurring */
export const RECURRENCE_THRESHOLD = 3;

/** Minimum incidents sharing a tag before we treat it as a cluster */
export const CLUSTER_THRESHOLD = 3;

/**
 * Detect enhancement signals from already-parsed inputs. Pure function:
 * deterministic given identical inputs + timestamp override.
 */
export function detectPatterns(
  incidents: IncidentEntry[],
  buildLog: BuildLogStats,
  ctx: DetectorContext = {},
): EnhanceSignal[] {
  const now = (ctx.now ?? (() => new Date()))();
  const isoDate = now.toISOString().slice(0, 10);
  const isoFull = now.toISOString();
  const signals: EnhanceSignal[] = [];

  // Build a quick lookup: INC id → status (so Pattern 1 can skip SUPERSEDED ones)
  const incStatus = new Map<string, string>();
  for (const inc of incidents) incStatus.set(inc.id, inc.status ?? "");

  // Pattern 1 · INC- cited 3+ times across the build log — but skip ones that
  // are marked ♻️ SUPERSEDED. A superseded INC's citations are historical;
  // the prevention has been replaced by a successor INC's fix, so flagging
  // recurrence is a false positive.
  for (const [incId, n] of buildLog.citationCount.entries()) {
    if (n < RECURRENCE_THRESHOLD) continue;
    const status = incStatus.get(incId) ?? "";
    if (status.includes("SUPERSEDED")) continue;
    signals.push({
      id: `ENH.${isoDate}.recurring-${incId}`,
      category: "incident-recurrence",
      detected: isoFull,
      severity: "warn",
      headline: `${incId} cited ${n} times — prevention is not holding`,
      evidence: `${n} citations in .claude/memory/build-log.md`,
      action:
        "Rewrite prevention in .claude/rules/ as a mechanical check (lint rule, deploy-check gate, or pre-commit hook). 'Be careful' language is not enough.",
    });
  }

  // Pattern 2 · ≥3 incidents share the same tag → domain may need a rule
  const tagCount = new Map<string, number>();
  for (const inc of incidents) {
    for (const t of inc.tags) {
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }
  // Sort tags by frequency desc, then alpha asc — deterministic ordering
  const sortedTags = [...tagCount.entries()].sort(([aT, aN], [bT, bN]) =>
    bN - aN !== 0 ? bN - aN : aT.localeCompare(bT),
  );
  for (const [tag, n] of sortedTags) {
    if (n < CLUSTER_THRESHOLD) continue;
    // Pattern 2 only fires when no canonical rule covers this tag. The
    // TAG_TO_RULE map is the single source of truth; a tag without an
    // entry there is treated as genuinely uncovered → signal fires.
    if (tagIsCovered(tag, ctx)) continue;
    signals.push({
      id: `ENH.${isoDate}.tag-${tag}`,
      category: "incident-cluster",
      detected: isoFull,
      severity: "info",
      headline: `${n} incidents tagged "${tag}" — domain may need a dedicated rule`,
      evidence: `${n} incidents share this tag in .claude/memory/incidents.md`,
      action: `Read all "${tag}"-tagged INCs and either consolidate the prevention into one rule file in .claude/rules/, or write a new rule if none covers the cluster.`,
    });
  }

  return signals;
}

/**
 * Merge newly-detected signals into the existing enhance-signals.json
 * payload. Existing signals with the same `id` are replaced (so re-detection
 * refreshes timestamps / counts). Order is preserved: legacy signals first,
 * then any newly-added.
 */
export function mergeSignals(
  existing: EnhanceSignal[],
  fresh: EnhanceSignal[],
): EnhanceSignal[] {
  const freshIds = new Set(fresh.map((s) => s.id));
  return [...existing.filter((e) => !freshIds.has(e.id)), ...fresh];
}

/**
 * Convenience helper that reads incidents.md + build-log.md from disk
 * and returns signals. Wraps the pure functions above with the IO that
 * the dry-run script (and a future cron handler) actually performs.
 */
export function detectFromDisk(opts: {
  incidentsPath: string;
  buildLogPath: string;
  ctx?: DetectorContext;
}): {
  incidents: IncidentEntry[];
  buildLog: BuildLogStats;
  signals: EnhanceSignal[];
} {
  const incidentsText = existsSync(opts.incidentsPath)
    ? readFileSync(opts.incidentsPath, "utf8")
    : "";
  const buildLogText = existsSync(opts.buildLogPath)
    ? readFileSync(opts.buildLogPath, "utf8")
    : "";
  const incidents = parseIncidents(incidentsText);
  const buildLog = parseBuildLogCitations(buildLogText);
  const signals = detectPatterns(incidents, buildLog, opts.ctx);
  return { incidents, buildLog, signals };
}
