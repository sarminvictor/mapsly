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
import {
  PHI_REPLY_GUARDRAIL,
  buildVoiceProfile,
  draftReplyUncached,
} from "../reply-draft";

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
    // WP8-5 · the untrusted review text is now fenced (prompt-injection guard),
    // so the body is present but wrapped, not a bare substring on the line.
    expect(userMsg).toContain("amazing service");
    expect(userMsg).toMatch(
      /UNTRUSTED_CONTENT_BEGIN[\s\S]*amazing service[\s\S]*UNTRUSTED_CONTENT_END/,
    );
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
    // v2 guardrail · CONTENT RULES govern what the reply may say; VOICE
    // RULES keep the owner's sound — a PHI-laden example contributes
    // voice only, never clinical content.
    expect(sys).toContain("CONTENT RULES");
    expect(sys).toContain("VOICE RULES");
    expect(sys).toMatch(
      /Privacy rules govern WHAT you say, never HOW you sound/,
    );
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
    // v2 structure · two labeled sections so privacy can't bleed into
    // voice (the corporate-generic failure mode from the 2026-06 audit).
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /CONTENT RULES \(these override "reference a specific detail" when they\s+conflict\)/,
    );
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /VOICE RULES \(NEVER overridden by privacy rules\)/,
    );
    // Greeting the reviewer by their public first name is voice, not a
    // disclosure — explicitly allowed.
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /greeting the reviewer by their\s+public first name — that is voice, not a disclosure/,
    );
    // Allow-list · non-clinical review details are safe to reference.
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /OK to reference from the review: wait time, scheduling or booking\s+experience, staff friendliness or demeanor, facility cleanliness or\s+atmosphere, general service quality/,
    );
    expect(PHI_REPLY_GUARDRAIL).toMatch(/these are not patient\s+information/);
    // Corporate-generic phrasing is named as a FAILURE, not a refuge.
    expect(PHI_REPLY_GUARDRAIL).toMatch(
      /generic corporate phrasing is a failure/,
    );
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
    // The user message's LAST instruction is the medical closing — it
    // restates the clinical-content ban so recency works FOR the
    // guardrail (not "match the examples as precisely as you can").
    expect(user).toMatch(
      /Never mention treatments, procedures, conditions, dates, or\s+payments/,
    );
    expect(user).not.toContain("as precisely as you can");
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
    // reads. For medical they must scope imitation to VOICE and restate
    // the clinical-content ban — a trailing unqualified "mimic exactly"
    // could win on recency over the system guardrail.
    expect(user).toContain(
      "mimic the VOICE: greeting style, emoji, punctuation, sign-off",
    );
    expect(user).toMatch(/Privacy rules govern content only/);
    expect(user).toMatch(/never imitate clinical details/);
    expect(user).not.toContain("mimic the style of these exactly");
    // The closing mandates the owner's voice features by name.
    expect(user).toMatch(
      /ALWAYS mimic the owner's\s+greeting style, emoji use, punctuation, and sign-off/,
    );
    // …and re-opens the non-clinical allow-list.
    expect(user).toMatch(
      /Non-clinical specifics from the review \(wait time, staff\s+friendliness, atmosphere\) are safe to reference/,
    );
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

  // ── Voice profile injection ───────────────────────────────────────

  const energeticExamples = [
    {
      reviewStars: 5,
      reviewText: "amazing!",
      ownerReply:
        "Hey Sarah! Thanks a million 🌸 You made our day. See you soon!",
    },
    {
      reviewStars: 4,
      reviewText: null,
      ownerReply: "Hey Mike! So glad you had fun. See you soon!",
    },
  ];

  test("voice profile · injected into the user message when examples exist (medical)", async () => {
    const { user } = await promptsFor("med spa", {
      voiceExamples: energeticExamples,
    });
    expect(user).toContain(
      "VOICE PROFILE (computed from the owner's replies):",
    );
    // Profile sits AFTER the examples block, BEFORE the new review.
    expect(user.indexOf("VOICE PROFILE")).toBeGreaterThan(
      user.indexOf("=== END EXAMPLES ==="),
    );
    expect(user.indexOf("VOICE PROFILE")).toBeLessThan(
      user.indexOf("NEW REVIEW"),
    );
  });

  test("voice profile · also injected for non-medical businesses", async () => {
    const { user } = await promptsFor("restaurant", {
      voiceExamples: energeticExamples,
    });
    expect(user).toContain(
      "VOICE PROFILE (computed from the owner's replies):",
    );
  });

  test("voice profile · absent without examples (legacy voiceNotes path too)", async () => {
    const bare = await promptsFor("med spa");
    expect(bare.user).not.toContain("VOICE PROFILE");
    const notes = await promptsFor("med spa", { voiceNotes: "formal usted" });
    expect(notes.user).not.toContain("VOICE PROFILE");
  });
});

/**
 * buildVoiceProfile · pure heuristics over the owner's prior replies.
 * Pinned on fixtures so prompt-visible output is an explicit decision.
 */
describe("buildVoiceProfile", () => {
  const ex = (ownerReply: string, reviewStars = 5) => ({
    reviewStars,
    reviewText: "great",
    ownerReply,
  });

  test("energetic owner · greeting mode, exclamation density, emoji sample, repeated sign-off", () => {
    const profile = buildVoiceProfile([
      ex("Hey Sarah! Thanks a million 🌸 You made our day. See you soon!"),
      ex("Hey Mike! So glad you had fun. See you soon!"),
      ex("Hey! Wow, thank you. See you soon!"),
    ]);
    expect(profile).toContain(
      "VOICE PROFILE (computed from the owner's replies):",
    );
    expect(profile).toContain('greets with "Hey {name}!"');
    expect(profile).toContain("uses exclamation marks freely");
    expect(profile).toContain("uses emoji (🌸)");
    expect(profile).toContain('typical sign-off: "See you soon!"');
    expect(profile).toMatch(/average reply length ~\d+ sentences?/);
  });

  test("text emoticons count as emoji (:-) style)", () => {
    const profile = buildVoiceProfile([
      ex("Hi Ana! Glad you enjoyed it :-) Come back any time!"),
      ex("Hi Tom! Thanks for the love :-)"),
    ]);
    expect(profile).toContain("uses emoji (:-))");
    expect(profile).toContain('greets with "Hi {name}!"');
  });

  test("flat formal owner · no exclamation, no emoji, no fabricated sign-off", () => {
    const profile = buildVoiceProfile([
      ex("Thank you for your feedback. We appreciate your business."),
      ex("Thank you for taking the time to review us. We value your input."),
    ]);
    expect(profile).toContain("no exclamation marks");
    expect(profile).toContain("no emoji");
    // Closers differ → no signature phrase is invented.
    expect(profile).not.toContain("typical sign-off");
    // "Thank" is not a salutation — reported as an opener, not a greeting.
    expect(profile).toContain('often opens with "Thank …"');
  });

  test("median sentence count is robust to one rambling reply", () => {
    const profile = buildVoiceProfile([
      ex("Thanks. Come again."),
      ex("Thanks. We loved it."),
      ex("Thanks. One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten."),
    ]);
    expect(profile).toContain("average reply length ~2 sentences");
  });

  test("empty or blank examples → empty string (nothing injected)", () => {
    expect(buildVoiceProfile([])).toBe("");
    expect(buildVoiceProfile([ex("   ")])).toBe("");
  });
});
