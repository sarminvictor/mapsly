/**
 * Agency · Usage & wallet (Phase 9).
 *
 * The credit economy made visible: the wallet balance broken into its buckets
 * (plan / purchased / rollover − held = available), the plan-tier grant, and the
 * CreditLedger history (hold → settle → refund-diff) so an agency can see exactly
 * where its credits went. Read-only — credit top-up is a Stripe payments surface
 * (human-required) wired separately.
 *
 * Per `.claude/rules/cache-components.md` Pattern 2 · sync default export, async
 * body in a Suspense boundary doing auth + DB reads. English-literal copy,
 * matching the rest of the agency portal (i18n keys are a follow-up).
 */

import { Suspense } from "react";
import { unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { grantFreeTierIfNew } from "@/modules/cost/server";
import { PLAN_CREDITS, type AgencyPlanTier } from "@/modules/cost/pricing";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const LEDGER_LABEL: Record<string, string> = {
  HOLD: "Hold",
  SETTLE: "Settle",
  REFUND: "Refund",
  TOPUP: "Grant / top-up",
  EXPIRE: "Expire",
  ADJUST: "Adjust",
};

/** Ledger types that ADD credits (shown +) vs draw down (shown −). */
function isCredit(type: string): boolean {
  return type === "TOPUP" || type === "REFUND";
}

export default function UsagePage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <UsageBody params={params} />
    </Suspense>
  );
}

async function UsageBody({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    select: { agencyId: true },
  });
  if (!member) {
    redirect({ href: "/home", locale });
    return null;
  }
  const agencyId = member.agencyId;

  // Fund a brand-new agency's free tier so the page shows a real balance, then
  // read the wallet + plan + recent ledger.
  await grantFreeTierIfNew(agencyId).catch(() => {});

  const [wallet, agency, ledger] = await Promise.all([
    prisma.agencyWallet.findUnique({
      where: { agencyId },
      select: {
        planCredits: true,
        purchasedCredits: true,
        rolloverCredits: true,
        heldCredits: true,
        cycleResetAt: true,
      },
    }),
    prisma.agency.findUnique({
      where: { id: agencyId },
      select: { plan: true, currentPeriodEnd: true },
    }),
    prisma.creditLedger.findMany({
      where: { agencyId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        credits: true,
        usd: true,
        note: true,
        createdAt: true,
      },
    }),
  ]);

  const plan = wallet?.planCredits ?? 0;
  const purchased = wallet?.purchasedCredits ?? 0;
  const rollover = wallet?.rolloverCredits ?? 0;
  const held = wallet?.heldCredits ?? 0;
  const available = Math.max(0, plan + purchased + rollover - held);

  const tier = agency?.plan ?? null;
  const tierGrant =
    tier && tier in PLAN_CREDITS ? PLAN_CREDITS[tier as AgencyPlanTier] : null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-slate-900">
        Usage &amp; wallet
      </h1>
      <p className="mt-1 font-mono text-xs text-slate-500">
        1 credit = 1 fully-enriched lead · plan → rollover → purchased drawdown
      </p>

      {/* Balance breakdown */}
      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Available" value={available} accent />
        <Stat label="Plan" value={plan} />
        <Stat label="Rollover" value={rollover} />
        <Stat label="Purchased" value={purchased} />
      </section>
      {held > 0 ? (
        <p className="mt-2 font-mono text-xs text-amber-600">
          {held.toLocaleString()} credits held by in-flight runs (released on
          settle).
        </p>
      ) : null}

      {/* Plan tier */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
          Plan
        </div>
        <div className="mt-1 text-sm text-slate-800">
          {tier ? (
            <>
              <span className="font-semibold">{tier.replace("_", " ")}</span>
              {tierGrant != null ? (
                <span className="text-slate-500">
                  {" "}
                  · {tierGrant.toLocaleString()} credits / cycle
                </span>
              ) : null}
              {agency?.currentPeriodEnd ? (
                <span className="text-slate-500">
                  {" "}
                  · renews {agency.currentPeriodEnd.toISOString().slice(0, 10)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-slate-500">
              Free tier — no active subscription
            </span>
          )}
        </div>
      </section>

      {/* Ledger */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Credit history
        </h2>
        {ledger.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No credit activity yet. Discovery is free; enrichment runs settle
            here.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-medium text-slate-500">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Credits</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => {
                  const sign = isCredit(l.type) ? "+" : "−";
                  return (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-slate-600">
                          {LEDGER_LABEL[l.type] ?? l.type}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono ${
                          isCredit(l.type)
                            ? "text-emerald-600"
                            : "text-slate-700"
                        }`}
                      >
                        {sign}
                        {l.credits.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {l.note ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">
                        {l.createdAt.toISOString().slice(0, 10)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        accent ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-lg ${
          accent ? "text-indigo-700" : "text-slate-800"
        }`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
