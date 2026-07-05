// modules/ai-research/pipeline.ts · the 5-stage AI research (ER) pipeline.
//
// `runAiResearchForBusiness(businessId)` runs five gpt-5.4-nano stages over a
// business's already-collected facts (category, services, site/description text,
// place_topics, the cell leader) and persists:
//   - one `EnrichmentStageRun` row per stage (audit + per-stage freshness + cost)
//   - one rolled-up `BusinessEnrichment` row (the latest verdict per field)
//
// Stages (each small, JSON-mode, deterministic):
//   ER-1  sub-type + sophistication        freshness 180d
//   ER-2  positioning + pricing-transparency freshness 90d
//   ER-3  compliance / regulatory cues      freshness 30d   (feeds expert layer)
//   ER-4  pain-point hypotheses             freshness 30d   (feeds outreach)
//   ER-5  competitive positioning vs leader freshness 30d
//
// Hard rules honored:
//   - gpt-5.4-nano ONLY (cheapest tier). web_search is BANNED — we read facts
//     already in our DB, never live-search (cost + the no-live-API path rule).
//   - Every AI call runs through `callOpenAi`, which asserts an open CronRun and
//     bills the run (cost-discipline.md). Caller MUST wrap this in withCronRun.
//   - Per-stage freshness: if a fresh OK `EnrichmentStageRun` exists, the stage
//     is skipped ($0) and its prior output is reused for the rollup.
//   - Prompts are tiny; inputs are truncated so a long site can't blow the bill.
//
// All time math takes an explicit `now` for testability + PPR safety (INC-09).

import { z } from "zod";

import prisma, { Prisma } from "@/lib/prisma";
import { callOpenAi } from "@/services/ai/client";
import type { SupportedModel } from "@/services/ai/pricing";
import { wrapUntrusted } from "@/services/ai/untrusted";

export const AI_RESEARCH_MODEL: SupportedModel = "gpt-5.4-nano";

const MS_PER_DAY = 86_400_000;

/** Per-stage cap on input characters fed to the model · bounds the bill. */
const MAX_SITE_TEXT_CHARS = 4_000;
const MAX_TOPICS = 30;

export type StageId = "ER-1" | "ER-2" | "ER-3" | "ER-4" | "ER-5";

export const STAGE_FRESHNESS_DAYS: Record<StageId, number> = {
  "ER-1": 180,
  "ER-2": 90,
  "ER-3": 30,
  "ER-4": 30,
  "ER-5": 30,
};

const ALL_STAGES: StageId[] = ["ER-1", "ER-2", "ER-3", "ER-4", "ER-5"];

// ── Per-stage output schemas (strict · drive the rollup) ─────────────────────

// Resilient parsers for MODEL OUTPUT · the schemas below only `.parse()` the
// model's text (never sent to OpenAI as a constraint), so a model that returns
// a slightly-too-long string or one extra list item must TRUNCATE, not throw —
// throwing fails the whole stage and silently drops ALL of its data (the ER-3
// "> 8 complianceCues" bug). Over-generation is capped; genuinely-empty output
// still fails (min length is real).
const clampStr = (max: number) =>
  z
    .string()
    .min(1)
    .transform((s) => s.trim().slice(0, max));
const clampList = (maxLen: number, cap: number) =>
  z
    .array(z.unknown())
    .transform((a) =>
      a
        .map((v) => (typeof v === "string" ? v.trim().slice(0, maxLen) : ""))
        .filter((s) => s.length > 0)
        .slice(0, cap),
    )
    .default([] as string[]);

const Er1Schema = z.object({
  subType: clampStr(80),
  sophistication: z.enum(["low", "medium", "high"]),
});
const Er2Schema = z.object({
  pricingTransparency: z.enum(["transparent", "opaque", "unknown"]),
  positioningSummary: clampStr(400),
});
const Er3Schema = z.object({
  complianceCues: clampList(80, 8),
});
const Er4Schema = z.object({
  painHypotheses: clampList(160, 6),
});
const Er5Schema = z.object({
  competitivePositioning: clampStr(400),
});

type Er1 = z.infer<typeof Er1Schema>;
type Er2 = z.infer<typeof Er2Schema>;
type Er3 = z.infer<typeof Er3Schema>;
type Er4 = z.infer<typeof Er4Schema>;
type Er5 = z.infer<typeof Er5Schema>;

// ── Input gathering ──────────────────────────────────────────────────────────

export interface AiResearchFacts {
  businessId: string;
  name: string;
  category: string;
  city: string | null;
  country: string | null;
  cellKey: string | null;
  services: string[];
  /** Concatenated site text + DfS description · truncated. */
  siteText: string;
  /** Top review topics ("botox", "fillers", …). */
  topics: string[];
  /** Display name of the cell's top-ranked business (the leader), if known. */
  cellLeaderName: string | null;
}

function topicsFromJson(raw: Prisma.JsonValue | null): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, MAX_TOPICS)
    .map(([k]) => k);
}

/**
 * Load the facts the pipeline reasons over · all from the DB, no live calls.
 * Returns null if the business doesn't exist.
 */
export async function gatherFacts(
  businessId: string,
): Promise<AiResearchFacts | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      category: true,
      city: true,
      country: true,
      cellKey: true,
      description: true,
      placeTopics: true,
      siteText: true,
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: { name: true },
        take: 40,
      },
    },
  });
  if (!business) return null;

  const services = business.services.map((s) => s.name);
  const topics = topicsFromJson(business.placeTopics);
  // A3-feed · prefer the persisted real-website text (menu + positioning copy)
  // over the thin Google one-line description, concatenating both when present.
  // This siteText is UNTRUSTED (scraped from the business's own site) — it stays
  // fenced via wrapUntrusted at prompt-build time (WP8-5, buildPrompt below).
  const siteText = [business.siteText?.trim(), business.description?.trim()]
    .filter((p): p is string => !!p)
    .join("\n\n")
    .slice(0, MAX_SITE_TEXT_CHARS);

  // The cell leader = the indexed business in the same cell with the most
  // reviews (a cheap proxy for "market leader" the ER-5 stage compares against).
  let cellLeaderName: string | null = null;
  if (business.cellKey) {
    const leader = await prisma.business.findFirst({
      where: {
        cellKey: business.cellKey,
        isActive: true,
        id: { not: businessId },
      },
      orderBy: { reviewCount: "desc" },
      select: { name: true },
    });
    cellLeaderName = leader?.name ?? null;
  }

  return {
    businessId: business.id,
    name: business.name,
    category: business.category,
    city: business.city,
    country: business.country,
    cellKey: business.cellKey,
    services,
    siteText,
    topics,
    cellLeaderName,
  };
}

// ── Prompt builders (one per stage · tiny + JSON-only) ───────────────────────

const JSON_ONLY = "Return ONE JSON object. No code fences. No prose.";

function commonContext(f: AiResearchFacts): string {
  const loc = [f.city, f.country].filter(Boolean).join(", ");
  return [
    `Business: ${f.name}`,
    `Category: ${f.category}`,
    loc ? `Location: ${loc}` : "",
    f.services.length ? `Services: ${f.services.slice(0, 20).join(", ")}` : "",
    f.topics.length ? `Review topics: ${f.topics.slice(0, 15).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPrompt(stage: StageId, f: AiResearchFacts): string {
  const ctx = commonContext(f);
  // WP8-5 · siteText is scraped from the business's own website — UNTRUSTED.
  // Fence it so an adversarial page can't inject instructions into the prompt.
  // The empty case stays a well-formed (empty) fence so the model still knows
  // "no site text was available" without a special-cased branch.
  const site = f.siteText
    ? wrapUntrusted(f.siteText, "Website text")
    : "Site text: (none)";
  switch (stage) {
    case "ER-1":
      return `${JSON_ONLY}
Classify this local business.
${ctx}
${site}

Schema: { "subType": string, "sophistication": "low"|"medium"|"high" }
- subType: a precise sub-category within "${f.category}" (e.g. "injectables-focused med spa", "full-service auto body").
- sophistication: how operationally mature the business looks from its services + text.`;
    case "ER-2":
      return `${JSON_ONLY}
Assess positioning + pricing transparency.
${ctx}
${site}

Schema: { "pricingTransparency": "transparent"|"opaque"|"unknown", "positioningSummary": string }
- pricingTransparency: "transparent" if prices/ranges are stated, "opaque" if hidden behind "call us", "unknown" if no signal.
- positioningSummary: one sentence on how they position themselves (≤ 40 words).`;
    case "ER-3":
      return `${JSON_ONLY}
List regulatory / compliance cues relevant to this category.
${ctx}
${site}

Schema: { "complianceCues": string[] }
- Short tags only (e.g. "medical-director-required", "state-license", "HIPAA", "no-disclaimer-shown"). At most 8 tags, each ≤ 5 words. Empty if none apply. Do not invent.`;
    case "ER-4":
      return `${JSON_ONLY}
Hypothesize this business's likely marketing pain points (for outreach).
${ctx}
${site}

Schema: { "painHypotheses": string[] }
- Each is a short, concrete hypothesis grounded in the facts (≤ 20 words). 0–6 items. Do not invent facts.`;
    case "ER-5":
      return `${JSON_ONLY}
Compare this business to its market leader.
${ctx}
Market leader: ${f.cellLeaderName ?? "(unknown)"}

Schema: { "competitivePositioning": string }
- One sentence on where this business stands vs the leader (≤ 40 words). If the leader is unknown, describe its standalone competitive position.`;
  }
}

const STAGE_SCHEMAS = {
  "ER-1": Er1Schema,
  "ER-2": Er2Schema,
  "ER-3": Er3Schema,
  "ER-4": Er4Schema,
  "ER-5": Er5Schema,
} as const;

const STAGE_MAX_TOKENS: Record<StageId, number> = {
  "ER-1": 120,
  "ER-2": 220,
  // ER-3 caps at 8 short tags but a food/health category can list several
  // multi-word regs — 160 truncated the JSON mid-array (unparseable → stage
  // lost). 260 leaves headroom for the capped list + JSON overhead.
  "ER-3": 260,
  "ER-4": 240,
  "ER-5": 200,
};

// ── Freshness ────────────────────────────────────────────────────────────────

function isStageFresh(
  lastOkAt: Date | null,
  stage: StageId,
  now: Date,
): boolean {
  if (!lastOkAt) return false;
  const ageMs = now.getTime() - lastOkAt.getTime();
  if (ageMs < 0) return true; // clock skew
  return ageMs <= STAGE_FRESHNESS_DAYS[stage] * MS_PER_DAY;
}

/** Latest OK run per stage for a business → {stage: {output, computedAt}}. */
async function loadLatestOkStages(
  businessId: string,
): Promise<
  Map<StageId, { output: Prisma.JsonValue | null; computedAt: Date }>
> {
  const runs = await prisma.enrichmentStageRun.findMany({
    where: { businessId, status: "OK" },
    orderBy: { computedAt: "desc" },
    select: { stage: true, outputJson: true, computedAt: true },
  });
  const map = new Map<
    StageId,
    { output: Prisma.JsonValue | null; computedAt: Date }
  >();
  for (const r of runs) {
    const stage = r.stage as StageId;
    if (!ALL_STAGES.includes(stage)) continue;
    if (!map.has(stage)) {
      map.set(stage, { output: r.outputJson, computedAt: r.computedAt });
    }
  }
  return map;
}

// ── Runner ───────────────────────────────────────────────────────────────────

export interface AiResearchResult {
  businessId: string;
  /** Per-stage status: "computed" (called the model), "fresh" (skipped),
   *  "failed" (errored — recorded, pipeline continues). */
  stages: Record<StageId, "computed" | "fresh" | "failed">;
  /** USD billed across the freshly-computed stages this run. */
  costUsd: number;
  /** Whether the rolled-up BusinessEnrichment row was written. */
  rolledUp: boolean;
}

interface StageOutcome {
  stage: StageId;
  status: "computed" | "fresh" | "failed";
  output: unknown | null;
  costUsd: number;
}

function safeParseJson(raw: string, stage: StageId): unknown {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `[ai-research] ${stage}: non-JSON output: ${stripped.slice(0, 160)} · ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Run all five ER stages for a business (skipping fresh ones), persist a stage
 * row per stage, and roll up to BusinessEnrichment. MUST run inside withCronRun.
 *
 * Errors in a single stage are isolated: the stage is recorded FAILED and the
 * pipeline continues so one bad stage doesn't waste the others' spend.
 */
export async function runAiResearchForBusiness(
  businessId: string,
  opts?: { now?: Date; force?: boolean },
): Promise<AiResearchResult> {
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;

  const facts = await gatherFacts(businessId);
  if (!facts) {
    throw new Error(`[ai-research] business "${businessId}" not found`);
  }

  const priorOk = await loadLatestOkStages(businessId);
  const outcomes: StageOutcome[] = [];

  for (const stage of ALL_STAGES) {
    const prior = priorOk.get(stage) ?? null;
    if (!force && isStageFresh(prior?.computedAt ?? null, stage, now)) {
      // Skip · serve the prior output to the rollup. Record a SKIPPED_FRESH
      // audit row so the per-stage history shows the decision.
      await prisma.enrichmentStageRun.create({
        data: {
          businessId,
          stage,
          status: "SKIPPED_FRESH",
          outputJson: prior?.output ?? Prisma.JsonNull,
          model: AI_RESEARCH_MODEL,
          costUsd: 0,
          computedAt: now,
        },
      });
      outcomes.push({
        stage,
        status: "fresh",
        output: prior?.output ?? null,
        costUsd: 0,
      });
      continue;
    }

    try {
      const { text, costUsd } = await callOpenAi({
        operation: `ai.research.${stage}[${AI_RESEARCH_MODEL}]`,
        model: AI_RESEARCH_MODEL,
        maxTokens: STAGE_MAX_TOKENS[stage],
        system: `You are a market analyst for a local-business intelligence platform. ${JSON_ONLY}`,
        prompt: buildPrompt(stage, facts),
        jsonMode: true,
      });
      const parsed = STAGE_SCHEMAS[stage].parse(safeParseJson(text, stage));
      await prisma.enrichmentStageRun.create({
        data: {
          businessId,
          stage,
          status: "OK",
          outputJson: parsed as Prisma.InputJsonValue,
          model: AI_RESEARCH_MODEL,
          costUsd,
          computedAt: now,
        },
      });
      outcomes.push({ stage, status: "computed", output: parsed, costUsd });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.enrichmentStageRun.create({
        data: {
          businessId,
          stage,
          status: "FAILED",
          model: AI_RESEARCH_MODEL,
          costUsd: 0,
          errorMessage: message.slice(0, 1000),
          computedAt: now,
        },
      });
      // Carry the prior OK output (if any) into the rollup so a transient
      // failure doesn't wipe a previously-good field.
      outcomes.push({
        stage,
        status: "failed",
        output: prior?.output ?? null,
        costUsd: 0,
      });
    }
  }

  const rolledUp = await rollup(businessId, outcomes, now);

  // A4 · stamp the AI-research freshness cursor on a SUCCESSFUL pipeline run.
  // The pipeline reaches here only after all five stages resolved (per-stage
  // failures are isolated, never thrown — a business-not-found throws earlier),
  // so this is the "the job ran to completion" marker. A repeat run within 90d
  // is then served from DB at $0 by the dispatch freshness gate. Even a run
  // where every stage was served fresh (SKIPPED_FRESH) or a verified-empty
  // rollup counts — the job did its verified-empty work (A5 billing invariant).
  await prisma.business.update({
    where: { id: businessId },
    data: { aiResearchLastAt: now },
  });

  const stages = {} as Record<StageId, "computed" | "fresh" | "failed">;
  let costUsd = 0;
  for (const o of outcomes) {
    stages[o.stage] = o.status;
    costUsd += o.costUsd;
  }

  return {
    businessId,
    stages,
    costUsd: Number(costUsd.toFixed(8)),
    rolledUp,
  };
}

// ── Rollup ───────────────────────────────────────────────────────────────────

function byStage(outcomes: StageOutcome[]): Record<StageId, unknown | null> {
  const out = {} as Record<StageId, unknown | null>;
  for (const o of outcomes) out[o.stage] = o.output;
  return out;
}

/**
 * Roll the latest per-stage outputs into the single BusinessEnrichment row.
 * Each stage output is re-validated defensively (a SKIPPED_FRESH output came
 * from a prior run and might predate a schema change). Returns true if written.
 */
async function rollup(
  businessId: string,
  outcomes: StageOutcome[],
  now: Date,
): Promise<boolean> {
  const m = byStage(outcomes);

  const er1 = safe(Er1Schema, m["ER-1"]);
  const er2 = safe(Er2Schema, m["ER-2"]);
  const er3 = safe(Er3Schema, m["ER-3"]);
  const er4 = safe(Er4Schema, m["ER-4"]);
  const er5 = safe(Er5Schema, m["ER-5"]);

  // Nothing usable → don't write an all-null row.
  if (!er1 && !er2 && !er3 && !er4 && !er5) return false;

  const totalCost = outcomes.reduce((sum, o) => sum + o.costUsd, 0);

  const data = {
    subType: er1?.subType ?? null,
    sophistication: er1?.sophistication ?? null,
    pricingTransparency: er2?.pricingTransparency ?? null,
    positioningSummary: er2?.positioningSummary ?? null,
    complianceCues: er3?.complianceCues ?? [],
    painHypotheses: er4?.painHypotheses ?? [],
    competitivePositioning: er5?.competitivePositioning ?? null,
    model: AI_RESEARCH_MODEL,
    costUsd: Number(totalCost.toFixed(8)),
    computedAt: now,
  };

  await prisma.businessEnrichment.upsert({
    where: { businessId },
    create: { businessId, ...data },
    update: data,
  });
  return true;
}

function safe<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown | null,
): z.infer<T> | null {
  if (value == null) return null;
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}
