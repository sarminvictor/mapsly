// modules/agency-portal/discover/signal-outcome-correlation.ts · WP6-14 ·
// "signals that predicted replies in your market". ONE honest aggregate (no ML):
// for an agency's leads that have a recorded status, compute per fired signal
// the reply-rate LIFT — how much more likely a lead that fired that signal was
// to reach REPLIED/WON than the agency's baseline reply-rate.
//
//   lift = replyRate(leads where signal fired) − replyRate(all scored leads)
//
// Gated: returns null until the agency has ≥ MIN_LEADS status-changed leads (a
// handful of outcomes can't predict anything — showing a "correlation" from 3
// leads would be dishonest). Read-only, bounded, no external API. Pure-ish (one
// bounded DB read); the ranking math is unit-testable via `rankSignalLift`.

import prisma from "@/lib/prisma";
import { SIG_META } from "./goal-templates";

/** Minimum status-changed leads before the card is statistically worth showing. */
export const MIN_LEADS_FOR_CORRELATION = 30;
/** A signal needs at least this many fired-leads before its lift is shown. */
const MIN_FIRED_FOR_SIGNAL = 5;

/** One ranked row on the correlation card. */
export interface SignalLift {
  signalKey: string;
  /** Human title (SIG_META.title → falls back to a de-keyed label). */
  title: string;
  /** Leads where this signal fired (of the scored set). */
  firedLeads: number;
  /** …of which reached REPLIED/WON. */
  firedReplies: number;
  /** replyRate among fired leads (0–1). */
  firedReplyRate: number;
  /** firedReplyRate − baselineReplyRate (can be negative). */
  lift: number;
}

export interface SignalCorrelation {
  /** Total scored leads (status-changed) considered. */
  totalLeads: number;
  /** Baseline reply-rate across all scored leads (0–1). */
  baselineReplyRate: number;
  /** Signals ranked by lift desc (only those with ≥ MIN_FIRED_FOR_SIGNAL). */
  signals: SignalLift[];
}

/** A lead's outcome + the signal keys that fired for it (correlation input). */
export interface LeadOutcome {
  replied: boolean;
  firedSignalKeys: string[];
}

/** "REPLIED" | "WON" count as a positive outcome; others don't. */
function isReply(status: string): boolean {
  return status === "REPLIED" || status === "WON";
}

/**
 * Pure ranking: given each scored lead's outcome + fired signals, compute the
 * baseline reply-rate and per-signal lift. Unit-testable — the DB loader just
 * feeds it `LeadOutcome[]`.
 */
export function rankSignalLift(leads: LeadOutcome[]): SignalCorrelation {
  const total = leads.length;
  const baselineReplies = leads.filter((l) => l.replied).length;
  const baseline = total > 0 ? baselineReplies / total : 0;

  const fired = new Map<string, { leads: number; replies: number }>();
  for (const l of leads) {
    // De-dupe signal keys within a lead so one lead counts once per signal.
    for (const key of new Set(l.firedSignalKeys)) {
      const agg = fired.get(key) ?? { leads: 0, replies: 0 };
      agg.leads += 1;
      if (l.replied) agg.replies += 1;
      fired.set(key, agg);
    }
  }

  const signals: SignalLift[] = [];
  for (const [signalKey, agg] of fired) {
    if (agg.leads < MIN_FIRED_FOR_SIGNAL) continue;
    const rate = agg.replies / agg.leads;
    signals.push({
      signalKey,
      title: SIG_META[signalKey]?.title ?? deKey(signalKey),
      firedLeads: agg.leads,
      firedReplies: agg.replies,
      firedReplyRate: rate,
      lift: rate - baseline,
    });
  }
  signals.sort((a, b) => b.lift - a.lift);

  return { totalLeads: total, baselineReplyRate: baseline, signals };
}

/**
 * Load + compute the correlation for an agency. Returns null until the agency
 * has ≥ MIN_LEADS_FOR_CORRELATION scored leads (the honesty gate). Bounded read.
 */
export async function getSignalCorrelation(
  agencyId: string,
): Promise<SignalCorrelation | null> {
  // Scored leads = leads whose status has moved OFF the default NEW (a recorded
  // outcome — contacted/replied/won/lost/hidden). statusChangedAt is non-null by
  // schema default, so status ≠ NEW is the honest "has an outcome" filter. The
  // status column carries the outcome; we correlate against flagged findings.
  const leads = await prisma.lead.findMany({
    where: { agencyId, status: { not: "NEW" } },
    orderBy: { statusChangedAt: "desc" },
    take: 5000,
    select: { businessId: true, status: true },
  });
  if (leads.length < MIN_LEADS_FOR_CORRELATION) return null;

  const bizIds = [...new Set(leads.map((l) => l.businessId))];
  // Which composite signals fired per business (flagged PlaybookFindings).
  const findings = await prisma.playbookFinding.findMany({
    where: { businessId: { in: bizIds }, status: "flagged" },
    select: { businessId: true, signalKey: true },
  });
  const firedByBiz = new Map<string, string[]>();
  for (const f of findings) {
    const arr = firedByBiz.get(f.businessId) ?? [];
    arr.push(f.signalKey);
    firedByBiz.set(f.businessId, arr);
  }

  const outcomes: LeadOutcome[] = leads.map((l) => ({
    replied: isReply(l.status),
    firedSignalKeys: firedByBiz.get(l.businessId) ?? [],
  }));

  return rankSignalLift(outcomes);
}

/** "hipaa-pixel-on-phi-page" → "Hipaa pixel on phi page" (label fallback). */
function deKey(key: string): string {
  const w = key.replace(/[_-]/g, " ");
  return w.charAt(0).toUpperCase() + w.slice(1);
}
