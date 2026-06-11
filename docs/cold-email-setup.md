# Cold Email — setup & launch runbook

Self-hosted cold outreach on **`mapsly.xyz`** (throwaway domain), walled off from
`mapsly.ai` + the Resend magic-link sender. Engine: `services/cold-mailer` +
`app/api/cron/process-cold-sequences` + admin at **`www.mapsly.ai/admin/email`**.

> **Reality check:** brand-new, unwarmed mailboxes land a chunk in spam at first.
> Do the 2–4 day mini warm-up (Step 4) before the first real cohort. Realistic:
> a few hundred in week 1, ~1k cumulative by week 2.

---

## Step 0 · Domain + mailboxes (do first — gates everything)

1. Register **`mapsly.xyz`**.
2. Add email — **Google Workspace** (best deliverability, ~$7/mbox/mo) or **Zoho**.
   Create ~5 mailboxes with human first names: `ava@`, `noah@`, `mia@`, `leo@`, `sofia@`.
3. For each mailbox: enable SMTP + create an **app password**
   (Google: 2-Step Verification → App passwords; Zoho: Application-Specific Password).

## Step 1 · DNS authentication on `mapsly.xyz` (do early — propagation)

Add these records (DKIM value comes from your mail provider's console):

| Type        | Host                                         | Value                                                                                    |
| ----------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| TXT (SPF)   | `@`                                          | Google: `v=spf1 include:_spf.google.com ~all` · Zoho: `v=spf1 include:zohomail.com ~all` |
| TXT (DKIM)  | provider selector (e.g. `google._domainkey`) | the long `v=DKIM1; k=rsa; p=…` value from the provider console                           |
| TXT (DMARC) | `_dmarc`                                     | `v=DMARC1; p=none; rua=mailto:dmarc@mapsly.xyz; fo=1`                                    |
| MX          | `@`                                          | the provider's MX records (set during mailbox setup — needed to receive replies)         |

- Google: Admin console → Apps → Google Workspace → Gmail → **Authenticate email** → turn DKIM on.
- Keep DMARC at `p=none` for the first weeks; tighten to `quarantine` later.

## Step 2 · Environment variables (Vercel → Settings → Env, prod + preview)

**The only thing you set is the mailbox credentials.** SMTP host
(`smtp.zohocloud.ca`), from-name, base URL, the unsubscribe secret (reuses the
app's `AUTH_SECRET`), and the legal-footer address are all hardcoded in
`services/cold-mailer/config.ts`.

```bash
COLD_MAILBOX_1=ava@mapsly.xyz
COLD_MAILBOX_PASSWORD_1=<app password>
COLD_MAILBOX_2=mia@mapsly.xyz
COLD_MAILBOX_PASSWORD_2=<app password>
COLD_MAILBOX_3=noah@mapsly.xyz
COLD_MAILBOX_PASSWORD_3=<app password>
COLD_MAILBOX_4=leo@mapsly.xyz
COLD_MAILBOX_PASSWORD_4=<app password>
COLD_MAILBOX_5=sofia@mapsly.xyz
COLD_MAILBOX_PASSWORD_5=<app password>
# Optional overrides (defaults in services/cold-mailer/config.ts):
# COLD_SMTP_HOST=smtp.zohocloud.ca   # change only if you move providers
# COLD_PHYSICAL_ADDRESS=...          # override the hardcoded legal footer
# COLD_GLOBAL_PAUSE=1                # hard kill-switch (UI toggle preferred)
```

- Display + sign-off name auto-derives from the address (`ava@` → "Ava").
- `CRON_SECRET` + `AUTH_SECRET` already exist — no new secrets to add.
- **The legal-footer postal address is hardcoded** in `config.ts` (`PHYSICAL_ADDRESS`)
  — make sure it's your real registered address (CAN-SPAM requires a valid one).

## Step 3 · Wire it up (in the admin · `www.mapsly.ai/admin/email`)

1. **Sync mailboxes from env** → creates a Mailbox row per `COLD_MAILBOX_*` (status WARMING).
2. **Create default campaign** → the 3-touch US sequence; edit copy/settings/delays in the editor.

## Step 4 · Mini warm-up — Thu→Sun (strongly recommended, ~10 min/day)

From each mailbox, manually send ~3–5 normal emails/day to friendly Gmail/Outlook
accounts; have them open, reply, and mark **Not spam**. Ramp slightly daily.

## Step 5 · Pre-launch (Sun/Mon)

1. **Seed test** (admin): send to 2–3 of your own inboxes → confirm **Inbox** (not spam),
   that SPF/DKIM/DMARC pass (Gmail → Show original), and the report link works.
2. In each Mailbox row: **Activate + ramp** (starts the per-mailbox ramp clock; caps go
   3 → 4 → 5 → 7 → 9 → 12 → 15 → 18/day over the first 8 days, then the target
   `dailyCap` (default 30) — see `services/cold-mailer/ramp.ts`).
3. On the campaign: **Enroll cohort** — start small (limit 50–100), preview first.

## Step 6 · Launch (Monday)

1. Set the campaign **ACTIVE**.
2. The cron (`*/15`) sends within the per-mailbox caps + the send window.
3. Watch the overview: if **failed/7d** climbs or you see complaints, hit **Pause all sending**.

## How it behaves

- **Caps/ramp:** per mailbox, enforced by the rotation (lowest-usage mailbox under its
  effective cap is chosen each send). Blocked mailboxes (550/5.4.6) cool down 2h automatically.
- **Crash/concurrency safety:** each ColdSend is atomically claimed (PENDING→SENDING)
  before SMTP, so overlapping cron ticks can never double-send; stale claims (>20 min)
  sweep to FAILED and are never requeued (the send may have gone out).
- **Stop conditions:** hard bounce (SMTP **or** NDR via the inbox poller) → suppress +
  recipient BOUNCED; human reply → recipient REPLIED (follow-ups stop, INFO alert);
  unsubscribe (one-click `/u/[token]`, or reply/mailto processed by the poller) →
  global suppression; campaign PAUSED → no sends.
- **Unsubscribe flow (`/u/[token]`, scanner-safe):** GET shows a one-button confirm
  card and **never writes** — security gateways (Barracuda, SafeLinks, Mimecast)
  prefetch every emailed link, and an instant-honor GET let them mass-unsubscribe
  recipients who never clicked. POST executes the opt-out instantly for both paths:
  the RFC 8058 one-click header (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  — mail providers POST with zero human interaction) and the confirm-card button.
  Still satisfies CAN-SPAM §7704(a)(3)/(a)(5) + CASL s.11 (10-day floor; we honor
  the POST instantly).
- **Inbox poller** (`/api/cron/poll-cold-inboxes`, every 15 min offset from the sender):
  polls each mailbox over IMAP (`imap.zohocloud.ca`, override `COLD_IMAP_HOST`) and
  classifies NDR bounces / replies / opt-outs / out-of-office (OOO does NOT stop a
  sequence). Edge cases stay flagged-seen in the shared inbox.
- **Alerts + circuit breakers:** mailbox block → WARN; whole fleet blocked with due
  sends → CRITICAL; trailing-24h hard-bounce rate > 3% (min 25 sends) → **auto-pause**
  with a CRITICAL alert. Alerts go to `OPS_ALERT_EMAIL` (default sarminvictor@gmail.com)
  via the Resend transactional path (never via Zoho) + a Notification row on the dev dashboard.
- **Suppression** is checked before **every** send (global, across all campaigns).
- **Enrollment** requires `Business.emailVerifiedAt` (the monthly SMTP-probe cron);
  `undeliverable` verdicts auto-suppress + stop in-flight sequences.
- **Copy variation:** templates support deterministic `{{a|b|c}}` spintax (seeded per
  recipient+step) so bodies aren't byte-identical at scale.
- **Report link** = the existing `/l/[slug]-[token]` landing page; engagement shows in
  `LandingEvent`.
- **Open tracking (`/o/[token]` pixel):** each cold send embeds a per-ColdSend 1x1
  GIF in the HTML part only (plain-text untouched; never in Resend/mapsly.ai mail).
  The route always answers the GIF (invalid token, DB error, rate-limited — never a
  broken image) and records raw fields on ColdSend (`firstOpenedAt`, `lastOpenedAt`,
  `openCount`, `firstOpenUserAgent`); `suspectedPrefetch` flags opens that look like
  machine prefetch (<5s after send or proxy/scanner UA — `lib/bot-detect`) and clears
  on the first human-looking open. Treat opens as a fuzzy upper bound (Apple MPP
  inflates ~50%); clicks/landing visits are the truth.
- **Footer** carries the physical postal address (hardcoded `PHYSICAL_ADDRESS` in
  `services/cold-mailer/config.ts`, override `COLD_PHYSICAL_ADDRESS`) — CAN-SPAM
  requires it in every email; do not remove it again (audit 2026-06-09 finding 1).

## Scaling to 1,000+/week

Defaults ceiling: 5 boxes × 30/day × 5 weekdays = **750/week** (the admin overview
shows "capacity · wk" and warns under 1,000). To close the gap, do NOT raise per-box
caps past ~30-40 on one fresh domain — add a **second cold domain** instead:

1. Register a lookalike (prefer `.com`, e.g. `trymapsly.com`), redirect it to mapsly.ai.
2. Repeat Step 0-1 (mailboxes + SPF/DKIM/DMARC) on the new domain.
3. Add `COLD_MAILBOX_6..8` + passwords in Vercel env → admin **Sync mailboxes** →
   **Activate + ramp** each. 7-8 boxes × 25-30/day × 5 days = 875-1,200/week with
   per-box volume unchanged and half the blast radius.
4. Register the new domain in Google Postmaster Tools (mapsly.xyz already is).

## Compliance

- **US-first** (CAN-SPAM): legal cold with a real postal address + working opt-out —
  the `/u` POST (one-click header or confirm button) is honored instantly; the GET
  confirm step exists only so scanner prefetches can't forge opt-outs. Set
  `COLD_PHYSICAL_ADDRESS`.
- **Canada (CASL)** is **off by default** (campaign `country=US`). Before enabling CA, we add
  per-contact `ConsentRecord` provenance — ask when you want it on.

## Deferred (zero rework)

Automatic cold→warm flip into the portal/Resend, Canada/CASL automation, daily
auto-enroll cron (dailyEnrollCap is stored but enrollment is still a manual admin
action). ~~IMAP reply auto-detect~~ — shipped as `/api/cron/poll-cold-inboxes` (v0.15.8).
