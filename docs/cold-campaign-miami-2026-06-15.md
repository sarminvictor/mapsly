# Miami med-spa cold campaign · Monday 2026-06-15 launch

Status doc, written 2026-06-11. Owner: Viktor. Prepared by the assistant session that ran the signal scans + email-design workflow (25 agents, 6 frameworks × 3 judges).

## Cohort

256 QUALIFIED businesses in the Miami cell (10 km radius), 244 enrollable (verified email). Avg rating 4.84★. 68% "Medical spa" + plastic surgeons, skin clinics, facial spas, IV therapy, wellness.

Segments (data as of 2026-06-11 evening; re-run `_tmp_segment.ts` after scan gaps close):

| Segment                 | All | Enrollable | T1 hook                                                                      |
| ----------------------- | --- | ---------- | ---------------------------------------------------------------------------- |
| invisible-in-search     | 149 | 144        | rank/visibility (inflated until cell aggregates land — many will reclassify) |
| review-neglect          | 78  | 75         | `{{unansweredCount}}` never got a reply                                      |
| strong-but-blind        | 19  | 15         | humble "couple of things stood out" default                                  |
| no-ads-while-rivals-run | 7   | 7          | competitor ads proof line (T2)                                               |
| website-problem         | 3   | 3          | `{{websiteSlowSeconds}}` seconds to open                                     |

One sequence, branched by `{{#if}}`/`{{#unless}}` guards — NOT separate sequences. Token thresholds in `modules/cold/personalization.ts` are the cohort router.

## Framework scorecard (3 judges × 6 dims, max 60)

| Framework                | Avg      | Open | Reply/Click | Maria-fit | Deliver. | Coverage | Distinct. | Verdict                                                                                                            |
| ------------------------ | -------- | ---- | ----------- | --------- | -------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| **specific-observation** | **47.7** | 8.7  | 8.0         | 8.7       | 7.3      | 7.0      | 8.0       | **WINNER** — self-verifiable numbers in subject; weaknesses were mechanical, all fixed                             |
| competitor-fomo          | 46.7     | 8.0  | 7.7         | 7.3       | 8.0      | 7.3      | 8.3       | Killer line lives behind unshipped tokens; ads-proof line grafted into winner's T2                                 |
| show-the-math            | 44.3     | 7.7  | 7.3         | 8.0       | 6.7      | 6.7      | 8.0       | $300/$3,600 anchor repeated 732× = spam fingerprint on a 2-week-old domain                                         |
| curiosity-question       | 43.3     | 7.3  | 7.3         | 7.3       | 7.3      | 6.0      | 8.0       | Micro-commitment is a trap without reply detection (audit: none exists)                                            |
| give-first               | 42.3     | 7.0  | 7.0         | 7.7       | 7.0      | 6.7      | 7.0       | "free/no catch/nothing for sale" cluster = Bayesian-filter bait; "free audit" most saturated med-spa opener        |
| loss-aversion-PAS        | 41.3     | 6.3  | 7.3         | 7.3       | 7.3      | 5.3      | 7.7       | Worst coverage: routes the big zero-unanswered slice to its weakest copy; free-win advice grafted into winner's T3 |

Synthesis verified engine facts against `modules/cold/template.ts`: `{{#unless}}` IS supported (lines 60–63); same-type nested `{{#if}}` is NOT (single-pass regex — the live baseline T2 has this bug today). Final copy uses only flat/cross-type guards. 63 render scenarios passed (7 token states × 3 spin seeds × 3 touches): no leftover syntax, no empty subjects, subjects ≤ 35 chars, bodies 48–99 words.

## Final 3-touch sequence (paste-ready)

### Touch 1 · Monday · link-free, reply-oriented

SUBJECT:

```
{{#if rating}}your {{rating}} across {{reviewCount}} reviews{{/if}}{{#unless rating}}{{how people find you on google|what patients read before they book}}{{/unless}}
```

BODY:

```
{{#if rating}}Your {{rating}} across {{reviewCount}} reviews — I ended up reading through them. {{You've clearly built something patients love.|That kind of consistency is hard to fake.|Patients clearly love this place.}}{{/if}}{{#unless rating}}{{Quick note|Real quick}} — I {{spent a few minutes looking at|had a look at}} how you show up when {{people nearby|locals}} search for what you do.{{/unless}}

{{#if unansweredCount}}{{One thing stood out|One thing surprised me}}: {{unansweredCount}} of your reviews never got a reply from you.{{/if}}{{#if unansweredOneStar}} That includes {{unansweredOneStar}} at 1–2 stars — exactly what new patients read first.{{/if}}{{#unless unansweredCount}}{{A couple of things stood out|A few things stood out}} — {{small, fixable, and the kind nobody usually mentions|nothing broken, just things nobody's told you}}.{{#if websiteSlowSeconds}} The biggest: your website takes about {{websiteSlowSeconds}} seconds to open on a phone. Most people give up by three.{{/if}}{{/unless}}

{{Want me to send over the rest of what I found?|Can I send you the rest of what I found?}} {{It's a one-minute read.|Takes a minute to read, tops.}}

{{senderFirstName}}
```

### Touch 2 · Wednesday · report payoff

SUBJECT:

```
{{#if unansweredCount}}{{the reviews I mentioned, on one page|about those waiting reviews}}{{/if}}{{#unless unansweredCount}}{{the rest of what I found|what I found, on one page}}{{/unless}}
```

BODY:

```
{{You shouldn't have to reply just to see it|Rather than make you write back}} — {{it's all on one page|I put everything on one page}}:

{{reportUrl}}

{{It's|That's}} your reviews the way a new patient sees them, plus who shows up next to you when someone nearby searches.{{#if unansweredCount}} Everything still waiting on a reply is listed first — each takes about a minute to answer.{{/if}}{{#if websiteSlowSeconds}} It also caught your website taking {{websiteSlowSeconds}} seconds to open on a phone — most people are gone by three.{{/if}}{{#if competitorAdsCount}} And nearby competitors are paying to show up on Google right now — {{competitorAdsCount}} of them. The page shows who.{{/if}}

{{No login, no signup — it's just your page.|Nothing to sign up for. The page is yours.}} {{Worth two minutes between appointments.|Two minutes, tops.}}

{{senderFirstName}}
```

Note: the workflow's draft said "Facebook or Instagram ads" — changed to "show up on Google" because `competitorAdsCount` is sourced from Google Ads Transparency (`AdLibraryEntry`); Meta cell data isn't collected for Miami yet.

### Touch 3 · Friday · sharpest observation + clean break

SUBJECT:

```
{{one more thing I noticed|last one from me}}
```

BODY:

```
{{Last note from me|I'll close this out}} — {{one more thing I noticed|one last thing}}: {{#if localRankHint}}when {{people nearby|locals}} search for what you do, Google has you on {{localRankHint}} — and most people never look past page 1.{{/if}}{{#if topCompetitorName}} {{Patients|People}} searching nearby see {{topCompetitorName}} first.{{/if}}{{#unless localRankHint}}nothing on your page has changed since Wednesday — {{and it's all stuff you can fix in an afternoon|and all of it is fixable in an afternoon}}.{{/unless}}
{{#if unansweredOneStar}}
If you only do one thing, answer the unhappy reviews first — you have {{unansweredOneStar}} waiting. A calm two-line reply changes what every future patient reads. {{Ten minutes, and it's free.|It's free, and it takes ten minutes.}}
{{/if}}
{{It's all still here|Everything's still up}}:

{{reportUrl}}

{{If it's not for you, reply "no thanks" and I won't email again.|If now's not the time, reply "no thanks" and that's the end of it.}} {{Either way, here's to a full appointment book.|Either way — I wish you a full calendar.}}

{{senderFirstName}}
```

## Personalization tokens

Shipped in `modules/cold/personalization.ts` (pending push as of this doc):

| Token                | Populated when                                                                            | Source                                                         |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `websiteSlowSeconds` | mobile LCP ≥ 4s                                                                           | latest `LighthouseAudit.lcp`, rounded                          |
| `localRankHint`      | ≥3 tracked keywords AND no organic ≤10 AND no 3-pack spot                                 | `BusinessKeyword` latest ranks → "page 2" / "page 3 or deeper" |
| `topCompetitorName`  | ONLY alongside `localRankHint`; modal `pack1Name` (≥2 sightings, ≤14d old, self excluded) | `SerpResult` MAPS pack names                                   |
| `competitorAdsCount` | recipient runs no ads AND ≥2 same-cell rivals have active Google ads                      | `AdLibraryEntry` distinct businesses                           |

All four are `{{#if}}`-guarded — sequence ships unchanged even if data is missing.

## Schedule + capacity

- Cadence: step delays **0 / +2d / +2d** → Mon / Wed / Fri (default campaign has 0/3/4 — must be changed).
- Sender throughput: cron every 15 min × batch 8 = **32/hr**; window 9:00–17:00 ET weekdays; mailbox caps 5 × 30 = **150/day**.
- A 122-recipient wave sends 9:00→~12:50 ET — exactly the med-spa morning window (owners check phones between appointments). Friday T3 done by ~1 pm, before weekend tune-out.
- **244 > 150/day** → all-at-once is impossible. Recommended: **wave 1 = 122 hottest** (unansweredOneStar > 0 or verified-outranked first) Mon/Wed/Fri this week; **wave 2 = 122** the following Mon/Wed/Fri. 366 sends/wk stays under the 750/wk Zoho-class ceiling and ≈24/mailbox/day stays under the 30 cap.
- Risk note: all 5 mailboxes were created 2026-06-09 and are unwarmed. 24/day/box is aggressive for day-4 mailboxes. Watch bounce + complaint rate on Monday's first 2 hours; circuit-breakers exist (`modules/cold/circuit-breakers.ts`) but eyes-on is cheap insurance.
- Enrollment mechanics: enrolling on Fri/Sat schedules step-0 immediately, but the window gate (weekdaysOnly, 9–17 ET) holds sends until Monday 9:00. `dailyEnrollCap` is 100 — enroll wave 1 as 100 + 22 across two days, or raise the cap.

## Compliance

- Footer: postal address (`COLD_PHYSICAL_ADDRESS` env, default "Mapsly · 530 3 St SE, Calgary, AB, Canada") + unsubscribe link — auto-appended by the send path. Subjects are non-deceptive. Touch 1 is link-free.
- T3's "reply no thanks and I won't email again" requires the inbound poller (`app/api/cron/poll-cold-inboxes`) to be live so opt-out replies actually suppress — verify before Monday.
- Azala Skin Clinic (secret shopper, `sarminvictor+miami@gmail.com`) will be enrolled with everyone — Viktor receives all 3 touches live. Funnel metrics already exclude the `secret_shopper` flag (v0.15.22).
