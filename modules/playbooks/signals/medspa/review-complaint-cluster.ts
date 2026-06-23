// modules/playbooks/signals/medspa/review-complaint-cluster.ts · a med-spa
// reputation detector: a cluster of reviews citing serious procedure
// complaints (botched / burns / infection / unlicensed). Exposure-framed,
// evidence-mandatory, capped at medium (single soft source, count-corroborated).

import { assertExposurePhrasing } from "../../copy-lint";
import type { EvidenceItem, PlaybookSignal, SignalVerdict } from "../../types";

const COMPLAINT =
  /\b(botched|burns?|burned|infection|scarring|scarred|unlicensed|disfigur\w*|negligen\w*|nerve damage|refund denied)\b/i;

const MIN_CLUSTER = 3;

export const medspaReviewComplaintCluster: PlaybookSignal = {
  key: "medspa.review_complaint_cluster",
  label: "Serious-complaint review cluster",
  group: "reputation",
  requiresEnrichments: ["reviews"],
  maxConfidence: "medium",
  pitchAngle:
    "Reputation-recovery + reply-management retainer — a visible complaint cluster scares off prospective patients.",
  regulationRefs: ["FTC truthful-advertising (cosmetic results)"],
  falsePositiveGuards: [],
  detect(ev): SignalVerdict | null {
    const hits = ev.reviews.filter((r) => COMPLAINT.test(r.text));
    if (hits.length < MIN_CLUSTER) return null;

    const evidence: EvidenceItem[] = hits.slice(0, 3).map((r) => ({
      kind: "review_quote",
      label: `${r.stars}★ review`,
      detail: r.text.length > 160 ? `${r.text.slice(0, 157)}…` : r.text,
      weight: 0.5,
    }));

    const explanation = assertExposurePhrasing(
      `Potential reputation exposure — ${hits.length} reviews mention serious procedure complaints (e.g. botched results, burns, infection). Worth reviewing before outreach.`,
    );

    return {
      value: hits.length,
      confidence: "medium",
      evidence,
      explanation,
      corroborationCount: 1,
    };
  },
};
