/**
 * Bot / machine-traffic classification · plan #17 anti-bot stats.
 *
 * Pure functions, no I/O — both ingest routes (at write time) and stats
 * queries (retroactively, over raw stored fields) use the SAME helpers so
 * "human" means one thing everywhere. Raw signals stay in the DB
 * (ColdSend.firstOpenedAt/firstOpenUserAgent/openCount, LandingEvent.userAgent
 * + session events); these heuristics can evolve and stats re-derive.
 *
 * Three traffic classes:
 *  1. OPEN-PIXEL fetches (/o/[token]) — mail-provider image proxies prefetch.
 *     Apple Mail Privacy Protection fetches with a GENERIC Mozilla UA and is
 *     NOT reliably UA-detectable — the <5s-after-send rule is the main net.
 *     Opens are always an upper bound; clicks/visits are the truth.
 *  2. LANDING visits — security scanners (Barracuda, Mimecast, Proofpoint,
 *     Outlook SafeLinks…) GET every link in an email. They execute little or
 *     no JS and never scroll → "human" requires PAGE_OPENED + ≥1
 *     SECTION_VIEWED from a non-scanner UA.
 *  3. Datacenter-IP flagging — RESERVED: needs the raw IP at ingest (we only
 *     store a salted hash) and a maintained range list. botReason value
 *     "datacenter-ip" is reserved in the schema; not implemented in wave 1.
 */

/** Canonical LandingEvent.botReason / classification reason strings. */
export const BOT_REASON = {
  /** Security scanner / crawler / preview-bot user agent. */
  UA_SCANNER: "ua-scanner",
  /** Mail-provider image proxy user agent (pixel fetches). */
  UA_PROXY: "ua-proxy",
  /** Reserved — needs raw IP at ingest. */
  DATACENTER_IP: "datacenter-ip",
  /** Session opened the page but viewed zero sections (no JS engagement). */
  NO_ENGAGEMENT: "no-engagement",
  /** Visit summary had no PAGE_OPENED at all. */
  NO_PAGE_OPEN: "no-page-open",
} as const;

export type BotReason = (typeof BOT_REASON)[keyof typeof BOT_REASON];

/**
 * An open within this many seconds of the send is treated as machine
 * prefetch (Apple MPP / Gmail proxy fetch-on-delivery) — decision log #17:
 * "discount prefetch (open <~5s after delivery)".
 */
export const PREFETCH_WINDOW_SECONDS = 5;

/**
 * Mail-provider IMAGE PROXIES — fetch the open pixel on the user's behalf
 * (sometimes before any human opens). Distinct from scanners: a proxy fetch
 * may still accompany a real open, so it only makes the open *suspect*.
 *   - Gmail: "… via ggpht.com GoogleImageProxy"
 *   - Yahoo: "YahooMailProxy"
 *   - Apple MPP: generic Mozilla UA — NOT listed here, caught by the <5s rule.
 */
const PROXY_UA_RE = /GoogleImageProxy|ggpht\.com|YahooMailProxy/i;

/**
 * Link scanners, security gateways, crawlers, previews, CLI fetchers.
 * Sources: known UA fragments of Barracuda / Mimecast / Proofpoint /
 * Microsoft SafeLinks ("Microsoft Office Existence Discovery", BingPreview)
 * plus the generic bot vocabulary already used by /api/landing-events.
 */
const SCANNER_UA_RE =
  /bot|crawl|spider|slurp|headless|preview|scanner|barracuda|mimecast|proofpoint|forcepoint|sophos|trendmicro|symantec|f-secure|zscaler|cyren|vade|microsoft office|ms-office|office existence|skypeuripreview|facebookexternalhit|embedly|quora link|whatsapp|telegrambot|bingbot|googlebot|applebot|semrush|ahrefs|lighthouse|python-requests|python-urllib|go-http-client|libwww|okhttp|curl\/|wget\/|phantomjs|puppeteer|playwright/i;

/** Known mail-provider image proxy UA (pixel auto-fetch). */
export function isProxyOpenUserAgent(userAgent: string): boolean {
  return PROXY_UA_RE.test(userAgent);
}

/** Known scanner / crawler / preview / CLI user agent. */
export function isScannerUserAgent(userAgent: string): boolean {
  return SCANNER_UA_RE.test(userAgent);
}

export interface UaVerdict {
  isBot: boolean;
  /** Set when isBot — store on LandingEvent.botReason. */
  reason: BotReason | null;
}

/**
 * Ingest-time UA classification for landing beacons. Replaces the inline
 * BOT_RE in /api/landing-events so route + stats share one vocabulary.
 * An empty UA is suspicious but NOT flagged (some legit in-app browsers
 * strip it) — the engagement rule catches those sessions instead.
 */
export function classifyUserAgent(userAgent: string): UaVerdict {
  if (isScannerUserAgent(userAgent)) {
    return { isBot: true, reason: BOT_REASON.UA_SCANNER };
  }
  if (isProxyOpenUserAgent(userAgent)) {
    return { isBot: true, reason: BOT_REASON.UA_PROXY };
  }
  return { isBot: false, reason: null };
}

export interface OpenSignal {
  /** ColdSend.sentAt — when the email actually left. */
  sentAt: Date;
  /** When the pixel was fetched. */
  openedAt: Date;
  /** UA of the pixel fetch ("" when absent). */
  userAgent: string;
}

/**
 * True when an open looks like machine prefetch rather than a human:
 * fetched < PREFETCH_WINDOW_SECONDS after the send, OR fetched by a known
 * image proxy / scanner UA. The /o route stores this as
 * ColdSend.suspectedPrefetch — and CLEARS it when a later open looks human
 * ("suspect" means: every open so far looked like a machine).
 */
export function isPrefetchOpen(signal: OpenSignal): boolean {
  const deltaSec = (signal.openedAt.getTime() - signal.sentAt.getTime()) / 1000;
  if (deltaSec < PREFETCH_WINDOW_SECONDS) return true;
  return (
    isProxyOpenUserAgent(signal.userAgent) ||
    isScannerUserAgent(signal.userAgent)
  );
}

export interface LandingVisitSummary {
  /** Session had a PAGE_OPENED event. */
  hasPageOpened: boolean;
  /** Distinct SECTION_VIEWED events in the session. */
  sectionViewedCount: number;
  /** Session user agent ("" when absent). */
  userAgent: string;
}

export interface VisitVerdict {
  isHuman: boolean;
  /** Why the visit is NOT human (null when isHuman). */
  reason: BotReason | null;
}

/**
 * The "human visit" rule (decision log #17): page open + ≥1 JS section-view
 * from a non-scanner UA. Scanners fetch the page but don't scroll, so the
 * IntersectionObserver beacon (LandingAnalytics SECTION_VIEWED) is the
 * cheapest reliable humanity proof we already collect.
 */
export function classifyLandingVisit(
  summary: LandingVisitSummary,
): VisitVerdict {
  const ua = classifyUserAgent(summary.userAgent);
  if (ua.isBot) return { isHuman: false, reason: ua.reason };
  if (!summary.hasPageOpened) {
    return { isHuman: false, reason: BOT_REASON.NO_PAGE_OPEN };
  }
  if (summary.sectionViewedCount < 1) {
    return { isHuman: false, reason: BOT_REASON.NO_ENGAGEMENT };
  }
  return { isHuman: true, reason: null };
}
