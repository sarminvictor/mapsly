// Dry-run for the process-enhancer agent (H.6) — proves the detector can read
// the signals it expects (incidents.md, build-log.md, recent TaskRuns) and
// produces a valid enhance-signals.json payload.
//
// Usage: pnpm tsx scripts/process-enhancer-dryrun.ts
//
// Validation contract (PLAN.md H.6): "dry-run produces ≥1 signal on the
// existing INC entries." Exit code 0 on success, 1 if 0 signals detected.
//
// Pure pattern-detection logic lives in lib/process-enhancer/detect-patterns.ts
// so it's also reachable from a Vitest unit test (no Prisma needed) and from
// the future app/api/cron/daily/process-enhancer route. This script wraps the
// pure logic with the IO + DB outcome trends. If the Prisma client hasn't been
// generated yet (e.g. running in a fresh sandbox without `pnpm db:generate`),
// the script logs a notice and continues — DB stats are a "nice-to-have"
// signal, not part of the H.6 validation gate.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  detectFromDisk,
  mergeSignals,
  type EnhanceSignal,
} from "../lib/process-enhancer/detect-patterns";

const ROOT = process.cwd();

interface OutcomeStats {
  outcomes: Record<string, number>;
  avgScore: number | null;
  source: "prisma" | "unavailable";
  reason?: string;
}

async function pullRecentTaskRuns(days = 7): Promise<OutcomeStats> {
  // Lazy-load Prisma so the dry-run is still useful when the client hasn't
  // been generated. We never `await import()` Prisma at module-load — that
  // would couple every consumer of detect-patterns.ts to a generated client.
  try {
    const { PrismaNeon } = await import("@prisma/adapter-neon");
    const { PrismaClient } = await import("../lib/generated/prisma/client");
    const url = process.env.DATABASE_URL;
    if (!url) {
      return {
        outcomes: {},
        avgScore: null,
        source: "unavailable",
        reason: "DATABASE_URL not set",
      };
    }
    const adapter = new PrismaNeon({ connectionString: url });
    const prisma = new PrismaClient({ adapter });
    const since = new Date(Date.now() - days * 86400_000);
    const runs = await prisma.taskRun.findMany({
      where: { startedAt: { gte: since } },
      select: { outcome: true, scoreAggregate: true },
    });
    const outcomes: Record<string, number> = {};
    let scoreSum = 0;
    let scoreCt = 0;
    for (const r of runs) {
      outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
      if (r.scoreAggregate != null) {
        scoreSum += r.scoreAggregate;
        scoreCt++;
      }
    }
    return {
      outcomes,
      avgScore: scoreCt > 0 ? scoreSum / scoreCt : null,
      source: "prisma",
    };
  } catch (err) {
    return {
      outcomes: {},
      avgScore: null,
      source: "unavailable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log("=== process-enhancer dry-run ===\n");

  const incidentsPath = join(ROOT, ".claude/memory/incidents.md");
  const buildLogPath = join(ROOT, ".claude/memory/build-log.md");
  const { incidents, buildLog, signals } = detectFromDisk({
    incidentsPath,
    buildLogPath,
  });

  const stats = await pullRecentTaskRuns();

  console.log(`Incidents in memory: ${incidents.length}`);
  console.log(`INC- citations in build-log: ${buildLog.total}`);
  if (stats.source === "prisma") {
    const total = Object.values(stats.outcomes).reduce((a, b) => a + b, 0);
    console.log(`TaskRuns last 7d: ${total}`);
    console.log(`Avg score last 7d: ${stats.avgScore?.toFixed(2) ?? "—"}`);
    console.log(`Outcome breakdown: ${JSON.stringify(stats.outcomes)}\n`);
  } else {
    console.log(
      `TaskRun stats: unavailable (${stats.reason}) — continuing with disk-only signals\n`,
    );
  }

  console.log(`Detected ${signals.length} signal(s):\n`);
  for (const s of signals) {
    console.log(`  [${s.severity}] ${s.headline}`);
    console.log(`           ${s.evidence}`);
    console.log(`           → ${s.action}\n`);
  }

  // Merge with existing signals (idempotent — same id replaces)
  const signalPath = join(ROOT, ".claude/memory/enhance-signals.json");
  const existing: EnhanceSignal[] = existsSync(signalPath)
    ? (JSON.parse(readFileSync(signalPath, "utf8")) as EnhanceSignal[])
    : [];
  const merged = mergeSignals(existing, signals);
  writeFileSync(signalPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(
    `Wrote ${merged.length} signal(s) to .claude/memory/enhance-signals.json`,
  );

  // H.6 validation gate: at least one signal must be produced from existing
  // INC entries. If we get 0, the detector is broken or incidents.md changed
  // in a way the detector can't read.
  if (signals.length === 0) {
    console.error(
      "\nFAIL · 0 signals detected. Check parseIncidents / detectPatterns " +
        "or that .claude/memory/incidents.md contains the expected INC- entries.",
    );
    process.exit(1);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
