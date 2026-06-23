// modules/agency-portal/discover/touchpoints.ts · pure read-model for the
// agency Touchpoints view (Phase 9). Maps an OutreachDraft row (whose `whyJson`
// is an opaque Json column) into the plain, serializable TouchpointDraft the
// client list renders. Kept PURE so the whyJson parsing is unit-testable — the
// repo tests logic, not rendered DOM.
//
// whyJson is written by generateTouchesForLeads as:
//   { why: string[], usedSignals: string[], droppedTokens: string[] }
// but it's a Json column, so we parse defensively (any field may be absent).

/** The raw draft fields read from the DB (Json + nullable scalars). */
export interface RawDraft {
  id: string;
  businessName: string | null;
  channel: string;
  subject: string | null;
  body: string;
  predictedTier: string | null;
  whyJson: unknown;
  createdAt: Date;
}

/** The serialized, client-safe touchpoint draft. */
export interface TouchpointDraftData {
  id: string;
  businessName: string | null;
  channel: string;
  subject: string | null;
  body: string;
  predictedTier: string | null;
  why: string[];
  usedSignals: string[];
  createdAt: string;
}

/** Coerce an unknown value to a string[] (drops non-strings; [] when absent). */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Extract `why` + `usedSignals` from an opaque whyJson blob. Pure. */
export function parseWhyJson(whyJson: unknown): {
  why: string[];
  usedSignals: string[];
} {
  if (whyJson === null || typeof whyJson !== "object") {
    return { why: [], usedSignals: [] };
  }
  const obj = whyJson as Record<string, unknown>;
  return {
    why: toStringArray(obj.why),
    usedSignals: toStringArray(obj.usedSignals),
  };
}

/** Map one raw draft into the client-safe shape. Pure. */
export function toTouchpointDraft(raw: RawDraft): TouchpointDraftData {
  const { why, usedSignals } = parseWhyJson(raw.whyJson);
  return {
    id: raw.id,
    businessName: raw.businessName,
    channel: raw.channel,
    subject: raw.subject,
    body: raw.body,
    predictedTier: raw.predictedTier,
    why,
    usedSignals,
    createdAt: raw.createdAt.toISOString(),
  };
}
