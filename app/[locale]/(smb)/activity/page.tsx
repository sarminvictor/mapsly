/**
 * SMB activity feed · `/(smb)/activity` (locale-prefixed variants
 * declared in `i18n/routing.ts`).
 *
 * Audience: Maria. Single calm scroll of "everything that moved in
 * your market in the last 30 days" — own reviews, own ads,
 * competitor moves, newcomers. Plain-English one-liners grouped by
 * day. Per `.claude/rules/ui-ux-smb.md`:
 *
 *   - Sentence case · warm tone · no jargon
 *   - "You got a 4★ review" beats "review_event_id=R123 stars=4"
 *   - One pill per event so scope is scannable (You · Lux · Market)
 *
 * Per `.claude/rules/cache-components.md` Patterns 1 + 2:
 *   - Default export is SYNC; async body in Suspense
 *   - Cached query short-circuits at NEXT_PHASE
 *
 * Per `.claude/rules/i18n.md` · copy under `smb.activity.*`.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { getSmbActivityData } from "@/modules/smb-activity/queries";
import type {
  SmbActivityEvent,
  SmbActivitySource,
  SmbActivityScope,
} from "@/modules/smb-activity/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "smb.activity.meta" });
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

interface PageParams {
  locale: string;
}

export default function SmbActivityPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  return (
    <Suspense fallback={<ActivitySkeleton />}>
      <ActivityBody params={params} />
    </Suspense>
  );
}

function ActivitySkeleton() {
  return (
    <section
      aria-hidden
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <div
        style={{
          height: 28,
          width: 220,
          background: "var(--color-bg-3)",
          borderRadius: 8,
          marginBottom: 24,
        }}
      />
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 10,
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <li
            key={i}
            style={{
              height: 56,
              background: "var(--color-bg-2)",
              borderRadius: 12,
            }}
          />
        ))}
      </ul>
    </section>
  );
}

async function ActivityBody({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  const t = await getTranslations("smb.activity");
  const data = await getSmbActivityData(session.user.id);

  if (data.ownedBusinessId === "") {
    return (
      <section
        style={{ maxWidth: 720, margin: "0 auto", padding: "64px 20px" }}
      >
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 36px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: 0,
            color: "var(--color-text)",
          }}
        >
          {t("empty_title")}
        </h1>
        <p
          style={{
            margin: "16px 0 0",
            color: "var(--color-text-2)",
            fontSize: 17,
            lineHeight: 1.5,
          }}
        >
          {t("empty_body")}
        </p>
      </section>
    );
  }

  const groups = groupByDay(data.events);

  return (
    <section
      aria-labelledby="activity-heading"
      style={{
        maxWidth: 820,
        margin: "0 auto",
        padding: "32px 20px 64px",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-text-3)",
          }}
        >
          {t("eyebrow")}
        </p>
        <h1
          id="activity-heading"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 36px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            margin: "6px 0 0",
            color: "var(--color-text)",
          }}
        >
          {t("title")}
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--color-text-2)",
            fontSize: 14,
          }}
        >
          {t("subtitle")}
        </p>
      </header>

      {data.events.length === 0 ? (
        <div
          style={{
            background: "var(--color-bg-2)",
            border: "1px dashed var(--color-border)",
            borderRadius: 14,
            padding: "32px 24px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              color: "var(--color-text)",
            }}
          >
            {t("no_events_title")}
          </p>
          <p
            style={{
              margin: "8px 0 0",
              color: "var(--color-text-2)",
              fontSize: 14,
            }}
          >
            {t("no_events_body")}
          </p>
        </div>
      ) : (
        <ol
          aria-label={t("aria_list")}
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: 24,
          }}
        >
          {groups.map(({ dayLabel, events }) => (
            <li key={dayLabel}>
              <p
                style={{
                  margin: "0 0 10px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--color-text-3)",
                }}
              >
                {dayLabel}
              </p>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  background: "var(--color-bg-2)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 14,
                  overflow: "hidden",
                }}
              >
                {events.map((ev, idx) => (
                  <li
                    key={ev.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "12px 16px",
                      borderTop:
                        idx === 0 ? "none" : "1px solid var(--color-border)",
                      background:
                        ev.scope === "you"
                          ? "rgba(195,85,58,.04)"
                          : "transparent",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: scopeBg(ev.scope),
                        color: scopeFg(ev.scope),
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        fontWeight: 600,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {t(`scope_${ev.scope}`)}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 14,
                        lineHeight: 1.5,
                        color: "var(--color-text)",
                      }}
                    >
                      {ev.body}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: sourceColor(ev.source),
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {t(`source_${ev.source}`)} · {formatTime(ev.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* --------------------------------------------- helpers */

interface DayGroup {
  dayLabel: string;
  events: SmbActivityEvent[];
}

function groupByDay(events: SmbActivityEvent[]): DayGroup[] {
  const groups = new Map<string, SmbActivityEvent[]>();
  const labels = new Map<string, string>();

  for (const ev of events) {
    const key = ev.at.toISOString().slice(0, 10);
    const list = groups.get(key);
    if (list) list.push(ev);
    else groups.set(key, [ev]);
    if (!labels.has(key)) labels.set(key, formatDayLabel(ev.at));
  }

  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, evs]) => ({ dayLabel: labels.get(key)!, events: evs }));
}

function formatDayLabel(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(d);
}

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function scopeBg(scope: SmbActivityScope): string {
  switch (scope) {
    case "you":
      return "var(--color-coral)";
    case "competitor":
      return "var(--color-bg-3)";
    case "market":
    default:
      return "rgba(59,110,196,.10)";
  }
}

function scopeFg(scope: SmbActivityScope): string {
  switch (scope) {
    case "you":
      return "#fff";
    case "competitor":
      return "var(--color-text-2)";
    case "market":
    default:
      return "var(--color-info)";
  }
}

function sourceColor(source: SmbActivitySource): string {
  switch (source) {
    case "reviews":
      return "var(--color-text-3)";
    case "ads":
      return "var(--color-text-3)";
    case "search":
      return "var(--color-text-3)";
    case "market":
    default:
      return "var(--color-text-3)";
  }
}
