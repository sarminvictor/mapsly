"use client";

/**
 * Static API reference panel · documents every DataForSEO endpoint the
 * discovery flow touches with real request + response samples plus the
 * field-mapping table. Collapsible so it stays out of the way until
 * needed.
 *
 * Content is static — admin can copy/paste samples into curl or read
 * them to confirm what each click does. Lives next to the page that
 * uses these endpoints so future Viktor (or anyone debugging) doesn't
 * have to dig through code to remember the contract.
 */

import { useState } from "react";

interface Endpoint {
  id: "ping" | "run" | "geocode" | "scrape" | "rdap" | "ai-email-finder";
  title: string;
  method: string;
  url: string;
  purpose: string;
  cost: string;
  cache: string;
  triggeredBy: string;
  sampleRequest: string;
  sampleResponseAbbrev: string;
}

const ENDPOINTS: readonly Endpoint[] = [
  {
    id: "run",
    title: "Discovery run · main ingestion call",
    method: "POST",
    url: "https://api.dataforseo.com/v3/business_data/business_listings/search/live",
    purpose:
      'When you click "Run" on a tracked location, we send this. DataForSEO returns up to 1000 businesses matching the category within the radius. We pipe each row through mapsRowToPersist → persistBusinessRow.',
    cost: "Variable · DfS bills per row + base. ~$0.0109 at limit=3 · scales linearly. Stored in Business.sourceRawJson + DiscoveryRun.costUsd (real DfS-reported cost).",
    cache:
      "24h KV cache on identical (categories, coord, limit). Re-running same cell within a day returns cached payload at $0.",
    triggeredBy:
      "/admin/discovery → RunDiscoveryButton → server action runDiscovery → modules/business-discovery/run.ts → mapsSearch",
    sampleRequest: `[
  {
    "categories": ["medical_spa"],
    "location_coordinate": "25.7617,-80.1918,5",
    "language_code": "en",
    "limit": 100
  }
]`,
    sampleResponseAbbrev: `{
  "status_code": 20000,
  "status_message": "Ok.",
  "cost": 0.0109,
  "tasks": [{
    "status_code": 20000,
    "cost": 0.0109,
    "result_count": 1,
    "result": [{
      "total_count": 173,
      "count": 100,
      "items": [
        {
          "type": "business_listing",
          "cid": "10000397159266760957",
          "feature_id": "0x2c07a4f49e89fc2d:0x8ac88c3b62ebb8fd",
          "place_id": "ChIJLfyJnvSkBywR_bjrYjuMyIo",
          "title": "White Coat Beauty",
          "original_title": null,
          "description": "Located on the first floor of River Landing Shops…",
          "category": "Skin care clinic",
          "category_ids": ["skin_care_clinic", "facial_spa", "medical_spa", ...],
          "additional_categories": ["Facial spa", "Laser hair removal service", ...],
          "address": "1440 NW N River Dr Suite 198, Miami, FL 33125",
          "address_info": {
            "borough": "Allapattah",
            "city": "Miami",
            "zip": "33125",
            "region": "Florida",
            "country_code": "US",
            "address": "1440 NW N River Dr Suite 198"
          },
          "snippet": "1440 NW N River Dr Suite 198, Miami, FL 33125",
          "phone": "+1786-767-5757",
          "url": "http://www.whitecoatbeauty.com/",
          "domain": "www.whitecoatbeauty.com",
          "logo": "https://lh3.googleusercontent.com/-EjM2aBalRb8/…",
          "main_image": "https://lh3.googleusercontent.com/gps-cs-s/…",
          "total_photos": 43,
          "latitude": 25.7856884,
          "longitude": -80.2198051,
          "is_claimed": true,
          "rating": { "rating_type": "Max5", "value": 5, "votes_count": 187 },
          "rating_distribution": { "1": 0, "2": 0, "3": 0, "4": 0, "5": 187 },
          "place_topics": { "botox": 20, "aesthetic": 10, "injector": 7, "spa": 7, ... },
          "attributes": { "available_attributes": {
            "from_the_business": ["is_owned_by_latinx", "is_owned_by_women"],
            "service_options": ["has_onsite_services"],
            "accessibility": ["has_wheelchair_accessible_entrance", ...],
            "payments": ["pay_credit_card", "pay_debit_card", "pay_mobile_nfc"],
            "parking": ["has_onsite_parking"]
          } },
          "people_also_search": [
            { "title": "White Coat Med Spa", "cid": "12734669209589415915", "rating": {"value": 5, "votes_count": 290} },
            { "title": "Brickell Cosmetic Center", "cid": "15002739178716080008", "rating": {"value": 4.6, "votes_count": 419} },
            …3 more…
          ],
          "work_time": { "work_hours": { "timetable": {
            "monday": [{"open": {"hour": 10, "minute": 0}, "close": {"hour": 18, "minute": 0}}],
            "tuesday": [...], "wednesday": [...], "thursday": [...], "friday": [...],
            "saturday": null, "sunday": null
          }, "current_status": "close" } },
          "popular_times": null,
          "local_business_links": null,
          "contact_info": [{ "type": "telephone", "value": "+17867675757", "source": "google_business" }],
          "check_url": "https://www.google.com/maps?cid=10000397159266760957&hl=en&gl=US",
          "last_updated_time": "2026-04-11 13:00:28 +00:00",
          "first_seen": "2024-07-16 09:34:34 +00:00"
        }
      ]
    }]
  }]
}`,
  },
  {
    id: "ping",
    title: "Cell validation · ping-validate before insert",
    method: "POST",
    url: "https://api.dataforseo.com/v3/business_data/business_listings/search/live",
    purpose:
      'When you click "Add location", we geocode the city then ping DfS with limit=1 to confirm the cell yields data. If empty → reject before TrackedLocation row is created.',
    cost: "Same endpoint as the run — but capped at limit=1. ~$0.0033 per ping.",
    cache:
      "Same 24h KV cache — repeated validations of the same cell are free.",
    triggeredBy:
      "/admin/discovery → AddLocationForm → server action addLocation → modules/business-discovery/ping-validate.ts → mapsSearch",
    sampleRequest: `[
  {
    "categories": ["medical_spa"],
    "location_coordinate": "25.7617,-80.1918,5",
    "language_code": "en",
    "limit": 1
  }
]`,
    sampleResponseAbbrev: `{
  "status_code": 20000,
  "tasks": [{ "result": [{ "total_count": 173, "count": 1, "items": [{ /* one row · same shape as run */ }] }] }]
}

→ ok:    { ok: true,  sampleName: "White Coat Beauty", sampleCategory: "Skin care clinic" }
→ empty: { ok: false, reason: "empty", message: "No businesses found for \\"medical_spa\\" within 5km of …" }`,
  },
  {
    id: "geocode",
    title: "Geocode · city → coordinates",
    method: "GET",
    url: "https://nominatim.openstreetmap.org/search?city=…&country=…&format=jsonv2&limit=1",
    purpose:
      "Resolves admin's typed city + country to lat/lng coordinates. Free public OpenStreetMap Nominatim. No API key. 1 req/sec rate limit. We set a descriptive User-Agent so OSM can contact us if our use becomes problematic.",
    cost: "$0 (free public service)",
    cache:
      "None · admin operations are low-frequency. cache: 'no-store' on the fetch.",
    triggeredBy:
      "/admin/discovery → AddLocationForm → server action addLocation → modules/business-discovery/geocode.ts",
    sampleRequest: `GET https://nominatim.openstreetmap.org/search?city=Calgary&state=AB&country=CA&format=jsonv2&limit=1
User-Agent: Mapsly Admin Discovery (sarminvictor@gmail.com) +https://mapsly.ai
Accept: application/json`,
    sampleResponseAbbrev: `[
  {
    "place_id": 297456023,
    "licence": "Data © OpenStreetMap contributors, ODbL 1.0…",
    "lat": "51.0456064",
    "lon": "-114.057541",
    "display_name": "Calgary, Alberta, Canada",
    "type": "city",
    "addresstype": "city"
  }
]

→ { lat: 51.0456064, lng: -114.057541, displayName: "Calgary, Alberta, Canada" }
→ null on no-match / network error / malformed payload`,
  },
  {
    id: "scrape",
    title: "Email scrape · multi-path DOM extraction",
    method: "GET",
    url: "<businessWebsite>{/, /contact, /contact-us, /about, /about-us, /team, /staff, /book, /booking}",
    purpose:
      "Part of the Qualify pass. We probe the homepage + 8 common contact paths in parallel, extract emails from mailto: anchors and inline text, then score + dedup. The top-ranked candidate becomes Business.emailDiscovered; up to 10 candidates persist in Business.emailCandidates for audit.",
    cost: "$0 (HTTP fetch only). Polite User-Agent identifying Mapsly.",
    cache:
      "None · admin operations are low-frequency. Re-running Qualify re-scrapes.",
    triggeredBy:
      "/admin/discovery → QualifyCellButton → qualifyCell → qualifyBusiness → modules/business-qualification/scrape-email.ts",
    sampleRequest: `GET https://whitecoatbeauty.com/contact
User-Agent: Mozilla/5.0 (compatible; MapslyBot/0.1; +https://mapsly.ai/bot · sarminvictor@gmail.com)
Accept: text/html,application/xhtml+xml
Accept-Language: en-US,en;q=0.9
Timeout: 7s
Redirect: follow`,
    sampleResponseAbbrev: `<HTML body — we extract via two regex passes>

Pass 1 — mailto:
  /href\\s*=\\s*["']mailto:([^"'?#]+)/gi
  Example matches: ["info@whitecoatbeauty.com", "concierge@whitecoatbeauty.com"]

Pass 2 — inline text (last 2KB = footer):
  /\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b/g
  Example matches: ["bookings@whitecoatbeauty.com"]

Scoring:
  +30 footer · +25 contact · +20 homepage · +15 about/team · +10 booking
  +50 domain-aligned · +10 custom-domain (not aligned) · +0 free provider
  +25 personal local-part · +10 generic (info@, contact@…)
  -100 junk (example@, noreply@, host like example.com)

Output:
  candidates: [
    { email: "concierge@whitecoatbeauty.com", source: "SCRAPE_FOOTER", score: 105, isPersonal: true, isDomainAligned: true, isFreeProvider: false },
    { email: "info@whitecoatbeauty.com",      source: "SCRAPE_CONTACT", score: 85,  isPersonal: false, isDomainAligned: true, isFreeProvider: false },
    …
  ]`,
  },
  {
    id: "rdap",
    title: "RDAP fallback · domain registrant lookup",
    method: "GET",
    url: "https://rdap.org/domain/<domain>",
    purpose:
      "When the website scrape returns zero emails, we hit RDAP (modern WHOIS). Walks the entities[] tree, extracts vCard email fields, filters out privacy-proxy hosts. Realistic hit-rate ~10–25% — most domains have GDPR/CCPA privacy redaction.",
    cost: "$0 (free public aggregator). Rate limit: be polite · we hit it once per business at most.",
    cache:
      "None for v1. Consider adding a 30-day cache if RDAP becomes a heavy contributor.",
    triggeredBy:
      "/admin/discovery → QualifyCellButton → qualifyCell → qualifyBusiness → modules/business-qualification/rdap.ts (only when scrape returned nothing)",
    sampleRequest: `GET https://rdap.org/domain/whitecoatbeauty.com
Accept: application/rdap+json
User-Agent: MapslyBot/0.1 (+https://mapsly.ai · sarminvictor@gmail.com)
Timeout: 8s`,
    sampleResponseAbbrev: `{
  "objectClassName": "domain",
  "handle": "2854837847_DOMAIN_COM-VRSN",
  "ldhName": "WHITECOATBEAUTY.COM",
  "status": ["client transfer prohibited"],
  "entities": [
    {
      "objectClassName": "entity",
      "roles": ["registrant"],
      "vcardArray": ["vcard", [
        ["version", {}, "text", "4.0"],
        ["fn", {}, "text", "Domain Privacy Service"],
        ["org", {}, "text", "REDACTED FOR PRIVACY"],
        ["email", { "type": "work" }, "text", "abc@whoisproxy.com"]
      ]]
    },
    {
      "roles": ["admin"],
      "vcardArray": ["vcard", [
        ["email", {}, "text", "admin@whitecoatbeauty.com"]
      ]]
    }
  ],
  "events": [
    { "eventAction": "registration", "eventDate": "2023-08-22T00:00:00Z" },
    { "eventAction": "expiration",   "eventDate": "2027-08-22T00:00:00Z" }
  ]
}

→ Privacy proxies filtered (whoisproxy.com matches PROXY_HOSTS regex)
→ Surviving candidates: [{ email: "admin@whitecoatbeauty.com", source: "RDAP", score: 80 }]
→ proxiedOnly: false (we still found a real email)
→ When EVERY contact is proxied → proxiedOnly: true, candidates empty`,
  },
  {
    id: "ai-email-finder",
    title: "AI email finder · web-search Tier-3 fallback",
    method: "POST",
    url: "https://api.openai.com/v1/responses",
    purpose:
      "Last-resort email discovery when scrape + RDAP both fail. Uses OpenAI's Responses API with web_search_preview tool · gpt-5.4-nano grounds itself in real Google/Bing/social/directory results, then returns a single best email + cited source. Bypasses Cloudflare WAFs AND Wix/Squarespace dynamic widgets (snippets often expose emails the live site hides behind JS).",
    cost: "$0.027/business avg (token + $10/1k web_search calls · ~2.4 calls per biz). Calgary smoke run: 15/25 found, ~$0.68 total.",
    cache:
      "Idempotency · we skip Tier 3 entirely if Business.emailDiscoverySource === 'AI_WEB_SEARCH' already. Re-qualify doesn't re-spend on rows the AI already searched.",
    triggeredBy:
      "/admin/discovery → QualifyCellButton → qualifyBusiness → modules/business-qualification/qualify.ts (Tier 3 · runs only when candidates.length === 0 after scrape + RDAP)",
    sampleRequest: `POST https://api.openai.com/v1/responses
Authorization: Bearer <OPENAI_API_KEY>
Content-Type: application/json

{
  "model": "gpt-5.4-nano",
  "input": "You are an OSINT researcher. Find a verifiable contact email...
Business: The Injectionist & Aesthetics
Location: Calgary, Alberta, CA
Website: https://www.theinjectionist.ca/?utm_source=Google&utm_medium=GMB
Google review count: 485
... [JSON contract for response] ...",
  "tools": [{ "type": "web_search_preview" }],
  "max_output_tokens": 800
}`,
    sampleResponseAbbrev: `{
  "id": "resp_abc123",
  "model": "gpt-5.4-nano",
  "output": [
    { "type": "web_search_call", ... },          ← billable @ $10/1k
    { "type": "web_search_call", ... },
    { "type": "message", "content": [{ "type": "output_text", "text":
        "{\\"email\\":\\"info@theinjectionist.ca\\",\\"confidence\\":\\"high\\",\\"source\\":\\"website\\",\\"reasoning\\":\\"The official site lists this email on the contact page.\\"}"
    }]}
  ],
  "usage": { "input_tokens": 12671, "output_tokens": 273 }
}

Validation gates (all rejects → email: null, kept in rejectReason):
  • confidence ∈ {high, medium}                  ← rejects low/none
  • shape passes isValidEmailShape regex         ← rejects "admin.foo.ca"
  • final segment NOT a file extension           ← rejects "@2x.png"
  • not a template placeholder                   ← rejects "example.com"
  • email.domain matches business.domain OR is a free provider
                                                  ← rejects parent-brand inference

On accept · synthesize EmailCandidate {
  source: "AI_WEB_SEARCH",
  score: confidence === "high" ? 90 : 70,
  aiCitation: <model-reported source>,
  ...
} and persist via the same code path as scrape/RDAP candidates.`,
  },
];

const FIELD_MAP: ReadonlyArray<{
  dfs: string;
  column: string;
  notes: string;
}> = [
  {
    dfs: "cid",
    column: "Business.googleCid (@unique)",
    notes: "Primary dedup key",
  },
  {
    dfs: "place_id",
    column: "Business.googlePlaceId (@unique)",
    notes: "Secondary dedup key",
  },
  {
    dfs: "feature_id",
    column: "Business.featureId",
    notes: "Google internal hex pair",
  },
  {
    dfs: "title",
    column: "Business.name",
    notes: "Required — null row skipped",
  },
  {
    dfs: "original_title",
    column: "Business.originalTitle",
    notes: "Alt-language title",
  },
  {
    dfs: "description",
    column: "Business.description (@db.Text)",
    notes: "Business bio · long-form",
  },
  {
    dfs: "category",
    column: "Business.category",
    notes: "Display name (primary)",
  },
  {
    dfs: "category_ids",
    column: "Business.categoryIds[]",
    notes: "DfS slugs · canonical for re-query",
  },
  {
    dfs: "additional_categories",
    column: "Business.categories[]",
    notes: "Display names · capped at 10",
  },
  { dfs: "address", column: "Business.address", notes: "Full formatted" },
  { dfs: "address_info.city", column: "Business.city", notes: "" },
  {
    dfs: "address_info.region",
    column: "Business.province",
    notes: "State / province name",
  },
  {
    dfs: "address_info.country_code",
    column: "Business.country",
    notes: "ISO-2 · falls back to anchor country",
  },
  { dfs: "address_info.zip", column: "Business.postalCode", notes: "" },
  {
    dfs: "latitude / longitude",
    column: "Business.lat / Business.lng",
    notes: "",
  },
  { dfs: "snippet", column: "Business.snippet", notes: "Short rendered text" },
  { dfs: "phone", column: "Business.phone", notes: "" },
  { dfs: "url", column: "Business.website", notes: "" },
  { dfs: "domain", column: "Business.domain", notes: "Pre-extracted host" },
  {
    dfs: "contact_info",
    column: "Business.contactInfo (Json)",
    notes: "Telephone with source provenance",
  },
  { dfs: "logo", column: "Business.logoUrl", notes: "Google-hosted logo URL" },
  {
    dfs: "main_image",
    column: "Business.mainImageUrl",
    notes: "Primary photo URL",
  },
  { dfs: "total_photos", column: "Business.photosCount", notes: "" },
  { dfs: "rating.value", column: "Business.rating", notes: "" },
  { dfs: "rating.votes_count", column: "Business.reviewCount", notes: "" },
  {
    dfs: "rating_distribution",
    column: "Business.ratingDistribution (Json)",
    notes: "{1: n, 2: n, ..., 5: n} histogram",
  },
  {
    dfs: "is_claimed",
    column: "Business.isClaimed",
    notes: "Claimed in Google · NOT in Mapsly",
  },
  {
    dfs: "attributes",
    column: "Business.attributes (Json)",
    notes: "Accessibility, payments, planning, etc.",
  },
  {
    dfs: "work_time",
    column: "Business.hours (Json)",
    notes: "Full work_time payload incl. timetable + current_status",
  },
  {
    dfs: "place_topics",
    column: "Business.placeTopics (Json)",
    notes: "Review-extracted topics with weights",
  },
  {
    dfs: "people_also_search",
    column: "Business.peopleAlsoSearch (Json)",
    notes: "Top 5 competitor seeds from Google",
  },
  {
    dfs: "popular_times",
    column: "Business.popularTimes (Json)",
    notes: "Hours-of-day occupancy histogram",
  },
  {
    dfs: "local_business_links",
    column: "Business.localBusinessLinks (Json)",
    notes: "Booking, menu, etc.",
  },
  {
    dfs: "check_url",
    column: "Business.checkUrl",
    notes: "Direct Google Maps link",
  },
  {
    dfs: "first_seen",
    column: "Business.firstSeenOnGoogle",
    notes: "DfS-reported · fallback to today",
  },
  {
    dfs: "last_updated_time",
    column: "Business.sourceLastUpdatedAt",
    notes: "When DfS itself last refreshed",
  },
  {
    dfs: "(entire row)",
    column: "Business.sourceRawJson (Json)",
    notes: "Forensic recovery · captures unknown future fields",
  },
];

export function ApiReference() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Endpoint["id"]>("run");
  const endpoint = ENDPOINTS.find((e) => e.id === active) ?? ENDPOINTS[0]!;

  return (
    <section style={{ marginTop: 32 }}>
      <button
        type="button"
        className="admin-btn"
        data-variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ marginBottom: 12 }}
      >
        {open ? "▾ Hide API reference" : "▸ Show API reference"}
        <span className="admin-muted" style={{ fontSize: 11, marginLeft: 8 }}>
          endpoints · samples · field mapping
        </span>
      </button>

      {open ? (
        <div className="admin-card" style={{ padding: 0 }}>
          {/* Tab strip */}
          <nav
            role="tablist"
            aria-label="DataForSEO endpoints used"
            style={{
              display: "flex",
              gap: 4,
              padding: "12px 16px 0",
              borderBottom: "1px solid var(--admin-border)",
            }}
          >
            {ENDPOINTS.map((e) => (
              <button
                key={e.id}
                role="tab"
                aria-selected={active === e.id}
                onClick={() => setActive(e.id)}
                className="admin-btn"
                data-variant={active === e.id ? "primary" : "ghost"}
                style={{
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  fontSize: 11,
                  padding: "8px 14px",
                }}
              >
                {e.id === "run"
                  ? "Discovery run"
                  : e.id === "ping"
                    ? "Cell ping"
                    : e.id === "geocode"
                      ? "Geocode"
                      : e.id === "scrape"
                        ? "Email scrape"
                        : "RDAP"}
              </button>
            ))}
          </nav>

          {/* Endpoint detail */}
          <div style={{ padding: 18 }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600 }}>
              {endpoint.title}
            </h3>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 13,
                color: "var(--admin-fg-2)",
              }}
            >
              {endpoint.purpose}
            </p>

            <KvList
              rows={[
                ["Method · URL", `${endpoint.method} ${endpoint.url}`],
                ["Cost", endpoint.cost],
                ["Cache", endpoint.cache],
                ["Triggered by", endpoint.triggeredBy],
              ]}
            />

            <CodeBlock label="Request body (sent as array, basic-auth header)">
              {endpoint.sampleRequest}
            </CodeBlock>
            <CodeBlock label="Response (abbreviated · real shape)">
              {endpoint.sampleResponseAbbrev}
            </CodeBlock>
          </div>

          {/* Field mapping table (shared across endpoints) */}
          {active === "run" || active === "ping" ? (
            <div style={{ padding: "0 18px 18px" }}>
              <h3
                style={{
                  margin: "8px 0 10px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderTop: "1px solid var(--admin-border)",
                  paddingTop: 14,
                }}
              >
                Field mapping · DataForSEO row → Business column
              </h3>
              <div style={{ overflowX: "auto" }}>
                <table className="admin-table" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>DfS field</th>
                      <th>Mapsly column</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FIELD_MAP.map((m) => (
                      <tr key={m.dfs}>
                        <td className="admin-mono" style={{ fontSize: 11 }}>
                          {m.dfs}
                        </td>
                        <td className="admin-mono" style={{ fontSize: 11 }}>
                          {m.column}
                        </td>
                        <td className="admin-muted" style={{ fontSize: 11 }}>
                          {m.notes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Dedup logic */}
          {active === "run" ? (
            <div style={{ padding: "0 18px 18px" }}>
              <h3
                style={{
                  margin: "8px 0 10px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderTop: "1px solid var(--admin-border)",
                  paddingTop: 14,
                }}
              >
                Dedup
              </h3>
              <CodeBlock label="Match before insert — CID first, then placeId">
                {`const existing = await prisma.business.findFirst({
  where: { OR: [
    shape.googleCid    ? { googleCid: shape.googleCid }       : { id: "__never__" },
    shape.googlePlaceId ? { googlePlaceId: shape.googlePlaceId } : { id: "__never__" },
  ] },
});
if (existing) return "duplicate";

// Both columns are @unique — even if our findFirst misses,
// the DB insert throws → catch + re-read + treat as duplicate.`}
              </CodeBlock>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function KvList({ rows }: { rows: ReadonlyArray<[string, string]> }) {
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        gap: "6px 16px",
        margin: "0 0 14px",
        fontSize: 12,
      }}
    >
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt
            className="admin-mono"
            style={{
              color: "var(--admin-fg-3)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {k}
          </dt>
          <dd style={{ margin: 0, color: "var(--admin-fg)" }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="admin-label" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: "12px 14px",
          background: "var(--admin-bg)",
          border: "1px solid var(--admin-border)",
          borderRadius: 6,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--admin-fg)",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {children}
      </pre>
    </div>
  );
}
