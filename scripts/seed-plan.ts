// Idempotent seed: parse PLAN.md → upsert Task rows in Postgres.
// Preserves any per-task state already set in the DB (sessions, scores, PR links).
// Run via: pnpm dotenv -e .env.local -- tsx scripts/seed-plan.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient, TaskStatus } from "../lib/generated/prisma/client";

const PLAN_PATH = join(process.cwd(), "PLAN.md");

const STATUS_MAP: Record<string, TaskStatus> = {
  done: "DONE",
  completed: "DONE",
  shipped: "DONE",
  in_progress: "IN_PROGRESS",
  "in progress": "IN_PROGRESS",
  pending: "PENDING",
  blocked: "BLOCKED",
  skipped: "SKIPPED",
  failed: "FAILED",
  "human-required": "HUMAN_REQUIRED",
  human_required: "HUMAN_REQUIRED",
};

interface Parsed {
  id: string;
  phase: string;
  title: string;
  effort: string;
  status: TaskStatus;
  deps: string;
  tags: string;
}

function parsePlan(): Parsed[] {
  const text = readFileSync(PLAN_PATH, "utf8");
  const rows: Parsed[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*([A-Z0-9][A-Z0-9.]*?)\s*\|/i);
    if (!m) continue;
    const id = m[1];
    if (id === "ID") continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const rawStatus = (cells[3] ?? "pending").toLowerCase();
    const tags = cells[5] ?? "";
    let status: TaskStatus = STATUS_MAP[rawStatus] ?? "PENDING";
    if (tags.includes("human-required") && status !== "DONE") {
      status = "HUMAN_REQUIRED";
    }
    rows.push({
      id: cells[0],
      phase:
        cells[0]
          .split(".")
          .slice(0, cells[0].split(".").length > 1 ? -1 : 1)
          .join(".") || cells[0],
      title: cells[1],
      effort: cells[2] ?? "",
      status,
      deps: cells[4] ?? "",
      tags,
    });
  }
  return rows;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const adapter = new PrismaNeon({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  const parsed = parsePlan();
  console.log(`parsed ${parsed.length} rows from PLAN.md`);

  let inserted = 0;
  let updated = 0;
  for (const row of parsed) {
    const existing = await prisma.task.findUnique({ where: { id: row.id } });
    if (!existing) {
      await prisma.task.create({
        data: {
          id: row.id,
          phase: row.phase,
          title: row.title,
          effort: row.effort || null,
          status: row.status,
          deps: row.deps || null,
          tags: row.tags || null,
          completedAt: row.status === "DONE" ? new Date() : null,
        },
      });
      inserted++;
    } else {
      // Preserve per-task state (score, PR, agents) — only update fields PLAN.md owns
      const becameNewlyDone =
        existing.status !== "DONE" && row.status === "DONE";
      await prisma.task.update({
        where: { id: row.id },
        data: {
          phase: row.phase,
          title: row.title,
          effort: row.effort || null,
          status: row.status,
          deps: row.deps || null,
          tags: row.tags || null,
          completedAt: becameNewlyDone
            ? new Date()
            : row.status !== "DONE"
              ? null
              : existing.completedAt,
        },
      });
      updated++;
    }
  }

  console.log(`inserted ${inserted} · updated ${updated}`);

  // Cleanup: tasks in DB but not in PLAN.md anymore are orphans — mark them
  const planIds = new Set(parsed.map((r) => r.id));
  const allDb = await prisma.task.findMany({ select: { id: true } });
  const orphans = allDb.filter((t) => !planIds.has(t.id));
  if (orphans.length > 0) {
    console.log(
      `${orphans.length} orphan tasks (not in PLAN.md):`,
      orphans.map((o) => o.id),
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
