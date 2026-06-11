import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface FakeRow {
  id: string;
  job: string;
  costUsd: number;
}
const fakeDb = { rows: new Map<string, FakeRow>(), nextId: 1 };

vi.mock("@/lib/prisma", () => ({
  default: {
    cronRun: {
      create: vi.fn(async ({ data }: { data: { job: string } }) => {
        const id = `run_${fakeDb.nextId++}`;
        fakeDb.rows.set(id, { id, job: data.job, costUsd: 0 });
        return { id, job: data.job, startedAt: new Date() };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { costUsd?: number | { increment: number } };
        }) => {
          const row = fakeDb.rows.get(where.id);
          if (!row) return null;
          if (
            data.costUsd !== undefined &&
            typeof data.costUsd === "object" &&
            "increment" in data.costUsd
          ) {
            row.costUsd += data.costUsd.increment;
          }
          return row;
        },
      ),
    },
  },
  Prisma: { sql: vi.fn() },
}));

import { withCronRun } from "@/lib/cost/cost-counter";
import { __setApiKeyForTesting, __setFetchForTesting } from "../client";
import { PHI_REPLY_GUARDRAIL, draftReplyUncached } from "../reply-draft";

function reply(content: string) {
  return new Response(
    JSON.stringify({
      id: "x",
      model: "gpt-5.4-mini",
      choices: [
        { finish_reason: "stop", message: { role: "assistant", content } },
      ],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 250,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  fakeDb.rows.clear();
  fakeDb.nextId = 1;
  __setApiKeyForTesting("test-key");
});
afterEach(() => {
  __setFetchForTesting(null);
  __setApiKeyForTesting(null);
});

describe("draftReplyUncached", () => {
  test("parses EN + ES drafts from a well-formed response", async () => {
    __setFetchForTesting(
      vi.fn(async () =>
        reply(
          JSON.stringify({
            en: "Thank you for sharing this — we're sorry the wait was longer than expected.",
            es: "Gracias por compartir esto — lamentamos que la espera haya sido más larga.",
          }),
        ),
      ),
    );
    const r = await withCronRun("test", () =>
      draftReplyUncached({
        stars: 2,
        text: "I had to wait 45 minutes.",
        businessName: "Solea Brickell Spa",
        category: "med spa",
      }),
    );
    expect(r.en).toMatch(/wait/i);
    expect(r.es).toMatch(/espera/i);
  });

  test("requires non-empty businessName", async () => {
    await expect(
      withCronRun("test", () =>
        draftReplyUncached({
          stars: 5,
          text: "ok",
          businessName: " ",
          category: "spa",
        }),
      ),
    ).rejects.toThrow(/businessName is required/);
  });

  test("requires non-empty category", async () => {
    await expect(
      withCronRun("test", () =>
        draftReplyUncached({
          stars: 5,
          text: "ok",
          businessName: "Acme",
          category: "  ",
        }),
      ),
    ).rejects.toThrow(/category is required/);
  });

  test("rejects out-of-range stars", async () => {
    await expect(
      withCronRun("test", () =>
        draftReplyUncached({
          stars: 0,
          text: "ok",
          businessName: "Acme",
          category: "spa",
        }),
      ),
    ).rejects.toThrow(/stars must be an integer 1..5/);
  });

  test("throws if EN or ES is missing in response", async () => {
    __setFetchForTesting(
      vi.fn(async () => reply(JSON.stringify({ en: "only english" }))),
    );
    await expect(
      withCronRun("test", () =>
        draftReplyUncached({
          stars: 5,
          text: "ok",
          businessName: "Acme",
          category: "spa",
        }),
      ),
    ).rejects.toThrow();
  });

  test("passes tone + voiceNotes through to the prompt (legacy path)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      reply(JSON.stringify({ en: "hi", es: "hola" })),
    );
    __setFetchForTesting(fetchMock);
    await withCronRun("test", () =>
      draftReplyUncached({
        stars: 5,
        text: "ok",
        businessName: "Solea",
        category: "med spa",
        tone: "apologetic",
        voiceNotes: "Use formal usted",
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    const userMsg = body.messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("Tone: apologetic");
    expect(userMsg).toContain("Voice notes: Use formal usted");
  });

  test("voiceExamples · few-shot path includes paired (review → reply) blocks", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      reply(JSON.stringify({ en: "Hi there!", es: "¡Hola!" })),
    );
    __setFetchForTesting(fetchMock);
    await withCronRun("test", () =>
      draftReplyUncached({
        stars: 5,
        text: "loved the staff",
        businessName: "Solea",
        category: "med spa",
        reviewerName: "S.B.",
        voiceExamples: [
          {
            reviewStars: 5,
            reviewText: "amazing service · Dr. White was great",
            ownerReply:
              "Hi Sarah! Thank you so much for the kind words about Dr. White 🌸 — see you next time!",
          },
          {
            reviewStars: 4,
            reviewText: null,
            ownerReply: "Hi Mike! Thanks for the review — we appreciate it.",
          },
        ],
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    const sysMsg = body.messages.find((m) => m.role === "system")!.content;
    const userMsg = body.messages.find((m) => m.role === "user")!.content;
    // Examples-mode system prompt fires when voiceExamples is present.
    expect(sysMsg).toMatch(/MIMIC their style/i);
    // User message contains the labeled few-shot blocks (paired with the
    // trigger review) — this is what gives the model the context to
    // learn tone, not just style.
    expect(userMsg).toContain("OWNER'S PRIOR REPLIES");
    expect(userMsg).toContain("--- Example 1 ---");
    expect(userMsg).toContain("Review (★5): amazing service");
    expect(userMsg).toContain("Owner's reply: Hi Sarah!");
    expect(userMsg).toContain("--- Example 2 ---");
    expect(userMsg).toContain("Review (★4): (stars only");
    expect(userMsg).toContain("Owner's reply: Hi Mike!");
    expect(userMsg).toContain("NEW REVIEW");
    expect(userMsg).toContain("Reviewer name: S.B.");
  });

  test("reviewerName · initial-form is passed through · prompt handles 'Hi there' fallback", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      reply(JSON.stringify({ en: "Hi there!", es: "¡Hola!" })),
    );
    __setFetchForTesting(fetchMock);
    await withCronRun("test", () =>
      draftReplyUncached({
        stars: 3,
        text: "neutral",
        businessName: "Solea",
        category: "med spa",
        reviewerName: "A.B.",
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    const userMsg = body.messages.find((m) => m.role === "user")!.content;
    const sysMsg = body.messages.find((m) => m.role === "system")!.content;
    expect(userMsg).toContain("Reviewer name: A.B.");
    // Both system prompts (with + without examples) instruct the model
    // to handle initials gracefully · never treat "S.B." as a name.
    expect(sysMsg).toMatch(/initial/i);
  });
});

/**
 * PHI guardrail trap cases · improvement-plan #6.
 *
 * US regulators have fined practices for review replies that confirmed
 * the reviewer was a patient or echoed their treatment. These tests
 * assert the PROMPT CONSTRUCTION (the OpenAI call is mocked): medical
 * categories get the guardrail block, non-medical and veterinary do
 * not, and the guardrail text forbids the known trap patterns.
 */
describe("draftReplyUncached · PHI guardrail", () => {
  async function promptsFor(
    category: string,
    extra: Partial<Parameters<typeof draftReplyUncached>[0]> = {},
  ): Promise<{ sys: string; user: string }> {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      reply(JSON.stringify({ en: "Thank you!", es: "¡Gracias!" })),
    );
    __setFetchForTesting(fetchMock);
    await withCronRun("test", () =>
      draftReplyUncached({
        stars: 1,
        // Trap review · PHI-laden. The guardrail must forbid echoing it.
        text: "My lip filler appointment on May 3rd was rushed and I paid $400.",
        businessName: "Solea Brickell Spa",
        category,
        ...extra,
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { messages: Array<{ role: string; content: string }> };
    return {
      sys: body.messages.find((m) => m.role === "system")!.content,
      user: body.messages.find((m) => m.role === "user")!.content,
    };
  }

  async function systemPromptFor(
    category: string,
    extra: Partial<Parameters<typeof draftReplyUncached>[0]> = {},
  ): Promise<string> {
    return (await promptsFor(category, extra)).sys;
  }

  test("medical category · system prompt contains the guardrail block", async () => {
    const sys = await systemPromptFor("med spa");
    expect(sys).toContain(PHI_REPLY_GUARDRAIL);
  });

  test("medical category · guardrail also fires on the few-shot path and covers PHI-laden examples", async () => {
    const sys = await systemPromptFor("dental clinic", {
      voiceExamples: [
        {
          reviewStars: 5,
          reviewText: "Great cleaning!",
          // The owner's own past reply confirms a patient relationship —
          // the guardrail must scope examples to TONE only.
          ownerReply:
            "Thanks for coming in for your cleaning, Sarah! See you at your next appointment.",
        },
      ],
    });
    // Few-shot base prompt + guardrail stacked.
    expect(sys).toMatch(/MIMIC their style/i);
    expect(sys).toContain(PHI_REPLY_GUARDRAIL);
    // Examples are style guides only — content must not be imitated.
    expect(sys).toMatch(/style guides ONLY/);
  });

  test("non-medical category · no guardrail, natural style kept", async () => {
    const sys = await systemPromptFor("restaurant");
    expect(sys).not.toContain("PRIVACY RULES");
    expect(sys).not.toContain("HIPAA");
    // The natural instruction survives for non-medical.
    expect(sys).toMatch(/specific detail/i);
  });

  test("veterinary category · excluded from the guardrail (not HIPAA-covered)", async () => {
    const sys = await systemPromptFor("veterinary clinic");
    expect(sys).not.toContain("PRIVACY RULES");
  });

  test("guardrail text forbids the known trap patterns", () => {
    // Patient-status confirmation AND denial — replying "we have no
    // record of you" to a non-patient is the same disclosure class as
    // "thanks for coming in" (it publicly litigates care-relationship
    // status and implies records were checked).
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /NEVER confirm, deny, or imply that the reviewer was or was not a\s+patient/,
    );
    expect(PHI_REPLY_GUARDRAIL).toContain('"thanks for coming in"');
    expect(PHI_REPLY_GUARDRAIL).toContain('"we have no\n  record of you"');
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /Confirming AND\s+denying a care relationship are both disclosures/,
    );
    // Treatment / condition / date / payment echo — even if the
    // reviewer wrote them.
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /treatments, procedures, conditions,\s+medications/,
    );
    expect(PHI_REPLY_GUARDRAIL).toMatch(/appointment dates/);
    expect(PHI_REPLY_GUARDRAIL).toMatch(/payments/);
    expect(PHI_REPLY_GUARDRAIL).toMatch(/even if the reviewer wrote/i);
    // Offline invite must not acknowledge a care relationship.
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /Never "about your appointment" or "your treatment"/,
    );
    // Overrides EVERYTHING in the conversation — not just "above". The
    // few-shot imperatives ("mimic the style of these exactly") live in
    // the USER message, which arrives after the system prompt; "every
    // instruction above" would not textually cover them.
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /OVERRIDE every other instruction in this conversation/,
    );
    expect(PHI_REPLY_GUARDRAIL).toMatch(/"mimic the style of\s+these exactly"/);
    // Bilingual coverage.
    expect(PHI_REPLY_GUARDRAIL).toMatch(/BOTH the English and the Spanish/);
  });

  test("englishOnly · guardrail precedes the EN-only override", async () => {
    const sys = await systemPromptFor("med spa", { englishOnly: true });
    const guardIdx = sys.indexOf("PRIVACY RULES");
    const overrideIdx = sys.indexOf("OVERRIDE: Return ONLY");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(overrideIdx).toBeGreaterThan(guardIdx);
  });

  // ── Red-team trap inputs ──────────────────────────────────────────
  // Each trap asserts PROMPT CONSTRUCTION: the guardrail fires on the
  // category (never on the review text — text-based gating would be
  // bypassable), and the specific forbidding clause is in the prompt.

  test("trap · reviewer self-discloses a treatment + date", async () => {
    const { sys } = await promptsFor("med spa", {
      stars: 4,
      text: "My Botox appointment last Tuesday went great, just a long wait.",
    });
    expect(sys).toContain(PHI_REPLY_GUARDRAIL);
    // Echo ban covers reviewer-volunteered details too.
    expect(sys).toMatch(/even if the reviewer wrote/i);
    expect(sys).toMatch(/Do not echo/);
  });

  test("trap · reviewer names their provider + procedure", async () => {
    const { sys } = await promptsFor("medical aesthetics", {
      stars: 5,
      text: "Dr. Sarah did my filler and I love it!",
    });
    // "medical aesthetics" is also a scope case — it matched only via
    // "medical"/"aesthetic", both verified in medical-category.test.ts.
    expect(sys).toContain(PHI_REPLY_GUARDRAIL);
  });

  test("trap · 1-star negative naming a treatment outcome", async () => {
    const { sys, user } = await promptsFor("laser clinic", {
      stars: 1,
      text: "You ruined my lips. Worst experience of my life.",
    });
    expect(sys).toContain(PHI_REPLY_GUARDRAIL);
    // Negative path: offline invite must not acknowledge care.
    expect(sys).toMatch(/invite offline contact WITHOUT acknowledging/);
    // The user message's LAST instruction defers to the privacy rules
    // (not "match the examples as precisely as you can").
    expect(user).toMatch(/PRIVACY RULES[\s\S]*override everything else/);
  });

  test("trap · Spanish-language review with treatment terms still gated (category, not text)", async () => {
    const { sys } = await promptsFor("iv therapy", {
      stars: 2,
      text: "El suero IV me dejó moretones y pagué 200 dólares.",
    });
    expect(sys).toContain(PHI_REPLY_GUARDRAIL);
    // Both output languages covered by the same block.
    expect(sys).toMatch(/BOTH the English and the Spanish/);
  });

  test("trap · payment dispute review", async () => {
    const { sys } = await promptsFor("weight loss center", {
      stars: 1,
      text: "They charged my card twice for my last visit and won't refund.",
    });
    expect(sys).toContain(PHI_REPLY_GUARDRAIL);
    expect(sys).toMatch(/payments/);
  });

  test("trap · NON-patient review — denying a care relationship is also a disclosure", async () => {
    const { sys } = await promptsFor("dental clinic", {
      stars: 1,
      text: "Just called to ask prices, never went in. Rude on the phone.",
    });
    // The tempting reply is "we have no record of you as a patient" —
    // which publicly litigates care-relationship status. Forbidden.
    expect(sys).toMatch(/confirm, deny, or imply/);
    expect(sys).toMatch(/we have no\s+record of you/);
  });

  test("few-shot + medical · user message stops re-issuing 'mimic exactly' after the guardrail", async () => {
    const { user } = await promptsFor("med spa", {
      voiceExamples: [
        {
          reviewStars: 5,
          reviewText: "Great place!",
          ownerReply: "Thanks for coming in for your peel, Ana!",
        },
      ],
    });
    // The examples header + closing are the LAST instructions the model
    // reads. For medical they must scope examples to tone and defer to
    // the privacy rules — a trailing unqualified "mimic exactly" could
    // win on recency over the system guardrail.
    expect(user).toContain("tone, length, and sign-off reference ONLY");
    expect(user).not.toContain("mimic the style of these exactly");
    expect(user).toMatch(/PRIVACY RULES/);
  });

  test("few-shot + non-medical · 'mimic exactly' framing is kept", async () => {
    const { user } = await promptsFor("restaurant", {
      voiceExamples: [
        {
          reviewStars: 5,
          reviewText: "Great pasta!",
          ownerReply: "Thanks so much — see you next Friday night!",
        },
      ],
    });
    expect(user).toContain("mimic the style of these exactly");
    expect(user).not.toMatch(/PRIVACY RULES/);
  });

  test("normalization end-to-end · 'Med-Spa' (hyphen + case) still triggers the guardrail", async () => {
    const { sys } = await promptsFor("Med-Spa");
    expect(sys).toContain(PHI_REPLY_GUARDRAIL);
  });
});
