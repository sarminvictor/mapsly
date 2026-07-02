// Tests for the save-as-template server actions (WP5-12) + the pure
// saved-template hydration helpers. Mirrors the enrich-actions test harness:
// mocked session + an in-memory prisma seam over the two models touched
// (AgencyMember, AgencyTemplate). Invariants:
//   - auth + agency membership gate both actions
//   - the saved row carries the caller's agencyId + a DiscoverySignals-shaped
//     signalsJson (so loading pre-seeds a goal exactly like a built-in)
//   - unknown SIG_META keys are rejected (they could never hydrate back)
//   - the per-agency cap returns limit_reached, never a silent drop
//   - delete is agency-scoped (a foreign id reads as not_found)
//   - goalFromSavedTemplate round-trips signals → GoalState (on:true,
//     customized, base fallback "custom")

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── Mockable session ───────────────────────────────────────────────────────

let SESSION: { user?: { id?: string } } | null = {
  user: { id: "user-1" },
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => SESSION),
}));

// ─── In-memory prisma seam ──────────────────────────────────────────────────

interface FakeTemplate {
  id: string;
  agencyId: string;
  name: string;
  basedOnTemplate: string | null;
  signalsJson: unknown;
}

const db = {
  members: [] as { userId: string; agencyId: string }[],
  templates: [] as FakeTemplate[],
  seq: 0,
  id(p: string) {
    this.seq += 1;
    return `${p}_${this.seq}`;
  },
  reset() {
    this.members = [{ userId: "user-1", agencyId: "agency-1" }];
    this.templates = [];
    this.seq = 0;
  },
};

vi.mock("@/lib/prisma", () => {
  const agencyMember = {
    findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => {
      const row = db.members.find((m) => m.userId === where.userId);
      return row ? { agencyId: row.agencyId } : null;
    }),
  };

  const agencyTemplate = {
    count: vi.fn(async ({ where }: { where: { agencyId: string } }) => {
      return db.templates.filter((t) => t.agencyId === where.agencyId).length;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeTemplate = {
        id: db.id("tpl"),
        agencyId: data.agencyId as string,
        name: data.name as string,
        basedOnTemplate: (data.basedOnTemplate as string | null) ?? null,
        signalsJson: data.signalsJson,
      };
      db.templates.push(row);
      return { id: row.id };
    }),
    deleteMany: vi.fn(
      async ({ where }: { where: { id: string; agencyId: string } }) => {
        const before = db.templates.length;
        db.templates = db.templates.filter(
          (t) => !(t.id === where.id && t.agencyId === where.agencyId),
        );
        return { count: before - db.templates.length };
      },
    ),
  };

  return {
    default: { agencyMember, agencyTemplate },
    Prisma: {},
  };
});

// ─── Imports under test AFTER the mocks ─────────────────────────────────────

import {
  deleteGoalTemplateAction,
  saveGoalTemplateAction,
} from "../template-actions";
import {
  goalFromSavedTemplate,
  savedTemplateRowFromDb,
} from "../saved-templates";
import { SIG_META } from "../goal-templates";

// Two REAL SIG_META keys (the registry is the source of truth — pick from it
// so the test never hardcodes a key that later renames).
const [KEY_A, KEY_B] = Object.keys(SIG_META);

beforeEach(() => {
  db.reset();
  SESSION = { user: { id: "user-1" } };
});
afterEach(() => vi.clearAllMocks());

// ─── saveGoalTemplateAction ──────────────────────────────────────────────────

describe("saveGoalTemplateAction", () => {
  test("persists an agency-scoped row with DiscoverySignals-shaped json", async () => {
    const r = await saveGoalTemplateAction({
      name: "My tuned web goal",
      basedOnTemplate: "website",
      signals: [
        { key: KEY_A!, match: "any" },
        { key: KEY_B!, tune: { kind: "strictness", level: "strict" } },
      ],
    });
    expect(r.status).toBe("ok");

    const row = db.templates[0]!;
    expect(row.agencyId).toBe("agency-1");
    expect(row.name).toBe("My tuned web goal");
    expect(row.basedOnTemplate).toBe("website");
    // The stored payload is the DiscoverySignals shape — loading it goes
    // through the SAME parse path Discovery.signalsJson uses.
    const json = row.signalsJson as {
      signals: { key: string }[];
      goalBase?: string;
      goalName?: string;
    };
    expect(json.signals.map((s) => s.key)).toEqual([KEY_A, KEY_B]);
    expect(json.goalBase).toBe("website");
    expect(json.goalName).toBe("My tuned web goal");
  });

  test("drops unknown SIG_META keys — and rejects when nothing is left", async () => {
    const r = await saveGoalTemplateAction({
      name: "Ghost signals",
      signals: [{ key: "not_a_real_signal_key" }],
    });
    expect(r.status).toBe("invalid_input");
    expect(db.templates).toHaveLength(0);
  });

  test("rejects invalid input (empty name / empty signals)", async () => {
    expect(
      (await saveGoalTemplateAction({ name: "", signals: [{ key: KEY_A! }] }))
        .status,
    ).toBe("invalid_input");
    expect(
      (await saveGoalTemplateAction({ name: "X", signals: [] })).status,
    ).toBe("invalid_input");
  });

  test("enforces the per-agency cap with limit_reached", async () => {
    for (let i = 0; i < 50; i += 1) {
      db.templates.push({
        id: db.id("tpl"),
        agencyId: "agency-1",
        name: `t${i}`,
        basedOnTemplate: null,
        signalsJson: { signals: [{ key: KEY_A }] },
      });
    }
    const r = await saveGoalTemplateAction({
      name: "One too many",
      signals: [{ key: KEY_A! }],
    });
    expect(r.status).toBe("limit_reached");
  });

  test("rejects an unauthenticated caller", async () => {
    SESSION = null;
    const r = await saveGoalTemplateAction({
      name: "X",
      signals: [{ key: KEY_A! }],
    });
    expect(r.status).toBe("unauthorized");
  });

  test("rejects a caller without an agency membership", async () => {
    db.members = [];
    const r = await saveGoalTemplateAction({
      name: "X",
      signals: [{ key: KEY_A! }],
    });
    expect(r.status).toBe("forbidden");
  });
});

// ─── deleteGoalTemplateAction ───────────────────────────────────────────────

describe("deleteGoalTemplateAction", () => {
  test("deletes only within the caller's agency", async () => {
    db.templates.push(
      {
        id: "mine",
        agencyId: "agency-1",
        name: "Mine",
        basedOnTemplate: null,
        signalsJson: { signals: [{ key: KEY_A }] },
      },
      {
        id: "theirs",
        agencyId: "agency-2",
        name: "Theirs",
        basedOnTemplate: null,
        signalsJson: { signals: [{ key: KEY_A }] },
      },
    );

    // A foreign template id reads as not_found (never confirms it exists).
    expect(
      (await deleteGoalTemplateAction({ templateId: "theirs" })).status,
    ).toBe("not_found");
    expect(db.templates).toHaveLength(2);

    // The caller's own row deletes.
    expect(
      (await deleteGoalTemplateAction({ templateId: "mine" })).status,
    ).toBe("ok");
    expect(db.templates.map((t) => t.id)).toEqual(["theirs"]);
  });

  test("rejects an unauthenticated caller", async () => {
    SESSION = null;
    const r = await deleteGoalTemplateAction({ templateId: "x" });
    expect(r.status).toBe("unauthorized");
  });
});

// ─── Pure hydration helpers ─────────────────────────────────────────────────

describe("saved-templates helpers", () => {
  test("savedTemplateRowFromDb parses the stored json (and rejects junk)", async () => {
    const good = savedTemplateRowFromDb({
      id: "t1",
      name: "Mine",
      basedOnTemplate: "website",
      signalsJson: { signals: [{ key: KEY_A }, { key: "unknown_key" }] },
    });
    // Unknown keys are filtered; the row survives with the known one.
    expect(good?.signals.map((s) => s.key)).toEqual([KEY_A]);

    // Corrupt / empty payloads disappear rather than hydrating empty goals.
    expect(
      savedTemplateRowFromDb({
        id: "t2",
        name: "Junk",
        basedOnTemplate: null,
        signalsJson: "not json shaped",
      }),
    ).toBeNull();
    expect(
      savedTemplateRowFromDb({
        id: "t3",
        name: "Only unknown",
        basedOnTemplate: null,
        signalsJson: { signals: [{ key: "unknown_key" }] },
      }),
    ).toBeNull();
  });

  test("goalFromSavedTemplate hydrates a working GoalState", () => {
    const goal = goalFromSavedTemplate({
      id: "t1",
      name: "My playbook",
      basedOnTemplate: null,
      signals: [
        { key: KEY_A!, match: "any" },
        { key: KEY_B!, tune: { kind: "strictness", level: "loose" } },
      ],
    });
    expect(goal.base).toBe("custom"); // null basedOn → custom
    expect(goal.name).toBe("My playbook");
    expect(goal.customized).toBe(true);
    expect(goal.filters).toHaveLength(2);
    // Every stored signal comes back ON with its saved settings.
    expect(goal.filters.every((f) => f.on)).toBe(true);
    expect(goal.filters[0]?.match).toBe("any");
    expect(goal.filters[1]?.tune).toEqual({
      kind: "strictness",
      level: "loose",
    });
    // `why` re-derives from SIG_META so the card copy stays current.
    expect(goal.filters[0]?.why).toBe(
      SIG_META[KEY_A!]?.pitch || SIG_META[KEY_A!]?.means || "",
    );
  });
});
