// Dry-run for the process-enhancer agent — validates it can read the
// signals it expects (incidents.md, build-log.md, TaskRuns, sessions)
// and produces the enhance-signals.json output shape it should.
//
// Usage: pnpm tsx scripts/process-enhancer-dryrun.ts
//
// This is the H.6 validation step. Run BEFORE arming process-enhancer
// to fire automatically. If this fails, fix the agent prompt or memory
// shape before the meta-loop goes live.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";

const ROOT = process.cwd();

interface Signal {
  id: string;
  category: string;
  detected: string;
  severity: "info" | "warn" | "error";
  headline: string;
  evidence: string;
  action: string;
}

interface IncidentEntry {
  id: string;
  tags: string;
}

function parseIncidents(): IncidentEntry[] {
  const path = join(ROOT, ".claude/memory/incidents.md");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const entries: IncidentEntry[] = [];
  const blocks = text.split(/^### /m);
  for (const block of blocks) {
    const idMatch = block.match(/^(INC-\d{4}-\d{2}-\d{2}-\d{2})/);
    if (!idMatch) continue;
    const tagsMatch = block.match(/\*\*Tags:\*\*\s*(.+?)\n/);
    entries.push({
      id: idMatch[1],
      tags: tagsMatch?.[1]?.trim() ?? "",
    });
  }
  return entries;
}

function parseBuildLog(): string[] {
  const path = join(ROOT, ".claude/memory/build-log.md");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  // Find INC- citations
  const citations = [...text.matchAll(/INC-\d{4}-\d{2}-\d{2}-\d{2}/g)].map(
    (m) => m[0],
  );
  return citations;
}

async function pullRecentTaskRuns(
  prisma: PrismaClient,
  days = 7,
): Promise<{ outcomes: Record<string, number>; avgScore: number | null }> {
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
  };
}

function detectPatterns(
  incidents: IncidentEntry[],
  citations: string[],
): Signal[] {
  const signals: Signal[] = [];

  // Pattern 1: incident cited 3+ times in build-log
  const citCount = new Map<string, number>();
  for (const c of citations) citCount.set(c, (citCount.get(c) ?? 0) + 1);
  for (const [incId, n] of citCount.entries()) {
    if (n >= 3) {
      signals.push({
        id: `ENH.${new Date().toISOString().slice(0, 10)}.recurring-${incId}`,
        category: "incident-recurrence",
        detected: new Date().toISOString(),
        severity: "warn",
        headline: `${incId} has been cited ${n} times — prevention is not working`,
        evidence: `Cited ${n} times in build-log.md`,
        action: `Rewrite prevention in .claude/rules/ or add a deploy-check guard`,
      });
    }
  }

  // Pattern 2: tag clustering
  const tagCount = new Map<string, number>();
  for (const inc of incidents) {
    for (const t of inc.tags.split(",").map((s) => s.trim())) {
      if (t) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }
  for (const [tag, n] of tagCount.entries()) {
    if (n >= 3) {
      signals.push({
        id: `ENH.${new Date().toISOString().slice(0, 10)}.tag-${tag}`,
        category: "incident-cluster",
        detected: new Date().toISOString(),
        severity: "info",
        headline: `${n} incidents tagged "${tag}" — domain may need a dedicated rule`,
        evidence: `${n} incidents share this tag`,
        action: `Consider creating or strengthening .claude/rules/${tag}.md`,
      });
    }
  }

  return signals;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const adapter = new PrismaNeon({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  console.log("=== process-enhancer dry-run ===\n");

  const incidents = parseIncidents();
  const citations = parseBuildLog();
  const runs = await pullRecentTaskRuns(prisma);

  console.log(`Incidents in memory: ${incidents.length}`);
  console.log(`INC- citations in build-log: ${citations.length}`);
  console.log(
    `TaskRuns last 7d: ${Object.values(runs.outcomes).reduce((a, b) => a + b, 0)}`,
  );
  console.log(`Avg score last 7d: ${runs.avgScore?.toFixed(2) ?? "—"}`);
  console.log(`Outcome breakdown: ${JSON.stringify(runs.outcomes)}\n`);

  const signals = detectPatterns(incidents, citations);
  console.log(`Detected ${signals.length} signal(s):\n`);
  for (const s of signals) {
    console.log(`  [${s.severity}] ${s.headline}`);
    console.log(`           ${s.evidence}`);
    console.log(`           → ${s.action}\n`);
  }

  // Write to enhance-signals.json (merging with existing)
  const signalPath = join(ROOT, ".claude/memory/enhance-signals.json");
  const existing = existsSync(signalPath)
    ? (JSON.parse(readFileSync(signalPath, "utf8")) as Signal[])
    : [];
  const merged = [
    ...existing.filter((e) => !signals.find((s) => s.id === e.id)),
    ...signals,
  ];
  writeFileSync(signalPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(
    `Wrote ${merged.length} signals to .claude/memory/enhance-signals.json`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
