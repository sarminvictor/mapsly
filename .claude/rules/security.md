---
description: Security baseline. Auth gates, CSRF, CSP, rate limit, secret handling, webhook verification.
globs: ["app/api/**/*.ts", "modules/auth/**/*.ts", "lib/middleware/**/*.ts"]
alwaysApply: true
---

# Security

Mapsly stores prospect lists, business profiles, billing data. **Every route is hostile-input territory.**

## Auth

### Server components / routes

```ts
import { auth } from "@/lib/auth";
import { unauthorized, forbidden } from "next/navigation";

export default async function ProtectedPage() {
  const session = await auth();
  if (!session?.user?.id) unauthorized();

  // Owner check
  const business = await prisma.business.findUnique({
    where: { id },
    select: { ownerUserId: true },
  });
  if (business?.ownerUserId !== session.user.id) forbidden();

  // ...
}
```

**Rules:**

- `unauthorized()` — not signed in (401)
- `forbidden()` — signed in but not allowed (403)
- Both throw and unwind via Next 16's `experimental.authInterrupts`
- Never return `null` or `<Redirect>` for auth failures — use these helpers

### API routes

```ts
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // ...
}
```

### Server actions

```ts
"use server";
import { auth } from "@/lib/auth";
import { z } from "zod";

export async function updateLeadStatus(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");

  const parsed = Schema.parse(Object.fromEntries(formData));
  // Ownership check
  const lead = await prisma.lead.findUnique({
    where: { id: parsed.leadId },
    select: {
      agency: { select: { members: { where: { userId: session.user.id } } } },
    },
  });
  if (!lead?.agency.members.length) throw new Error("forbidden");

  // ...
}
```

## CSRF

Next.js server actions are CSRF-protected by default (they verify the Origin header). **Don't disable this.** No `app/api/*` route accepts mutations without verification:

- POST/PUT/PATCH/DELETE that comes from a browser fetch must include either an auth header or rely on same-origin policy.
- Webhooks (Stripe, Resend) verify signatures — see below.

## CSP (Content Security Policy)

```ts
// middleware.ts
const csp = `
  default-src 'self';
  script-src 'self' 'nonce-${nonce}' https://js.stripe.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https://lh3.googleusercontent.com https://*.public.blob.vercel-storage.com;
  connect-src 'self' https://api.stripe.com https://*.posthog.com;
  frame-src https://js.stripe.com https://hooks.stripe.com;
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests;
`
  .replace(/\s+/g, " ")
  .trim();
```

**Rules:**

- No `unsafe-eval`. Ever.
- No `unsafe-inline` for scripts — use nonces.
- Allow-list third parties explicitly. No wildcards on `script-src`.

## Webhook signature verification

Every webhook handler verifies its source:

```ts
// app/api/webhooks/stripe/route.ts
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const body = await req.text(); // raw body for signature
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature!,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return new Response("Bad signature", { status: 400 });
  }

  // Idempotency check
  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: { eventId: event.id },
  });
  if (existing) return Response.json({ ok: true });

  await prisma.stripeWebhookEvent.create({
    data: { eventId: event.id, type: event.type },
  });

  // ... process
}
```

## Secret handling

- Secrets live in `.env.local` (gitignored) and Vercel env vars (encrypted at rest)
- Never `console.log` an env var
- Never include secrets in URL params
- Never include secrets in client bundles — `NEXT_PUBLIC_*` is public
- Rotate every 90 days. Document in `docs/handoff.md`

## Input validation

Every external input — request body, URL params, search params, form data, headers — goes through Zod first:

```ts
const Schema = z.object({
  listId: z.string().cuid(),
  status: z.enum(["NEW", "CONTACTED", "REPLIED", "WON", "LOST", "HIDDEN"]),
});

const parsed = Schema.parse(input); // throws on bad input
```

For form data: `Schema.parse(Object.fromEntries(formData))`.

For URLSearchParams: `Schema.parse(Object.fromEntries(url.searchParams))`.

## SQL injection

Prisma parameterizes everything. **Never use `$queryRawUnsafe`** with user input. If you need raw SQL with parameters:

```ts
await prisma.$queryRaw`SELECT * FROM "Business" WHERE id = ${id}`;
// Prisma turns ${id} into a parameter — safe.
```

## XSS

- React escapes content by default — keep using it
- Never `dangerouslySetInnerHTML` user-supplied content
- Sanitize any user-supplied HTML before render (DOMPurify) — for review text, the AI reply draft, agency notes
- `dangerouslySetInnerHTML` for our own controlled content (e.g. structured data JSON-LD) is OK

## Rate limiting

See `scalability.md` § Rate limiting. Summary:

- 60/min/IP on public routes
- 30/min/user on auth routes
- 200/min on webhook routes
- No limit on cron (server-to-server)

## PII handling

- Business owner emails: stored, hashed for logs
- Review text: stored, anonymized reviewer names (initial.initial)
- Stripe IDs: stored, not logged
- IP addresses: stored only for rate limit windows (KV TTL'd)
- Browser fingerprints: never collected

## OWASP top 10 self-audit

Before every release:

- [ ] Broken Access Control — all routes have auth + ownership checks
- [ ] Cryptographic Failures — secrets only in env vars, no plain-text storage of sensitive data
- [ ] Injection — Zod + Prisma parameterization
- [ ] Insecure Design — threat-modeling docs/security-model.md exists
- [ ] Security Misconfiguration — CSP, HSTS, X-Frame-Options set in next.config + vercel.json
- [ ] Vulnerable Components — `pnpm audit` clean
- [ ] Auth Failures — magic-link rate limited (max 5/hour/email), no password reuse path
- [ ] Software/Data Integrity — webhooks signed + idempotent
- [ ] Logging Failures — Sentry captures everything, no PII in error messages
- [ ] SSRF — never let user input become a URL we fetch (validate domain allowlist)

## Anti-patterns

- ❌ Logging request bodies without redacting PII
- ❌ Returning user data in error messages ("user 42 doesn't exist")
- ❌ Allowing arbitrary redirect URLs (validate against allowlist)
- ❌ Skipping signature check "in dev mode"
- ❌ CSP `unsafe-inline` for scripts
- ❌ Auth check in a useEffect (client-only — server bypasses it)
- ❌ Storing secrets in feature-flag systems
- ❌ Using HTTP for any external call (HTTPS only)
