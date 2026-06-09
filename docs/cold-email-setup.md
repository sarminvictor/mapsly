# Cold Email — setup & launch runbook

Self-hosted cold outreach on **`mapsly.xyz`** (throwaway domain), walled off from
`mapsly.ai` + the Resend magic-link sender. Engine: `services/cold-mailer` +
`app/api/cron/process-cold-sequences` + admin at **`dev.mapsly.ai/dev/email`**.

> **Reality check:** brand-new, unwarmed mailboxes land a chunk in spam at first.
> Do the 2–4 day mini warm-up (Step 4) before the first real cohort. Realistic:
> a few hundred in week 1, ~1k cumulative by week 2.

---

## Step 0 · Domain + mailboxes (do first — gates everything)

1. Register **`mapsly.xyz`**.
2. Add email — **Google Workspace** (best deliverability, ~$7/mbox/mo) or **Zoho**.
   Create ~5 mailboxes with human first names: `ava@`, `noah@`, `mia@`, `leo@`, `zoe@`.
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

## Step 3 · Wire it up (in the admin · `dev.mapsly.ai/dev/email`)

1. **Sync mailboxes from env** → creates a Mailbox row per `COLD_MAILBOX_*` (status WARMING).
2. **Create default campaign** → the 3-touch US sequence; edit copy/settings/delays in the editor.

## Step 4 · Mini warm-up — Thu→Sun (strongly recommended, ~10 min/day)

From each mailbox, manually send ~3–5 normal emails/day to friendly Gmail/Outlook
accounts; have them open, reply, and mark **Not spam**. Ramp slightly daily.

## Step 5 · Pre-launch (Sun/Mon)

1. **Seed test** (admin): send to 2–3 of your own inboxes → confirm **Inbox** (not spam),
   that SPF/DKIM/DMARC pass (Gmail → Show original), and the report link works.
2. In each Mailbox row: **Activate + ramp** (starts the per-mailbox ramp clock; caps go
   10 → 15 → 20 → 25 → 30/day over the first week).
3. On the campaign: **Enroll cohort** — start small (limit 50–100), preview first.

## Step 6 · Launch (Monday)

1. Set the campaign **ACTIVE**.
2. The cron (`*/15`) sends within the per-mailbox caps + the send window.
3. Watch the overview: if **failed/7d** climbs or you see complaints, hit **Pause all sending**.

## How it behaves

- **Caps/ramp:** per mailbox, enforced by the rotation (lowest-usage mailbox under its
  effective cap is chosen each send). Blocked mailboxes (550/5.4.6) cool down 2h automatically.
- **Stop conditions:** hard bounce → suppress + recipient BOUNCED; unsubscribe (one-click
  `/u/[token]`) → global suppression; campaign PAUSED → no sends.
- **Suppression** is checked before **every** send (global, across all campaigns).
- **Report link** = the existing `/l/[slug]-[token]` landing page; engagement shows in
  `LandingEvent` (we deliberately omit email open-pixels for cold deliverability).

## Compliance

- **US-first** (CAN-SPAM): legal cold with a real postal address + working opt-out (we honor
  instantly). Set `COLD_PHYSICAL_ADDRESS`.
- **Canada (CASL)** is **off by default** (campaign `country=US`). Before enabling CA, we add
  per-contact `ConsentRecord` provenance — ask when you want it on.

## Deferred (week 2, zero rework)

IMAP reply auto-detect (auto-stop on reply), automatic cold→warm flip into the portal/Resend,
Canada/CASL automation, more domains/mailboxes for scale.
