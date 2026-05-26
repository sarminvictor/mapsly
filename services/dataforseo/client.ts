// services/dataforseo/client.ts · shared transport for every DataForSEO adapter.
//
// DataForSEO exposes ~50 endpoints across SERP, business data, keyword data,
// and on-page categories. They all share:
//   - HTTPS basic auth (DATAFORSEO_USERNAME / DATAFORSEO_PASSWORD)
//   - JSON POST body wrapped in an array of "task" objects (one or many)
//   - JSON envelope response: `{ status_code, status_message, tasks: [...] }`
//   - Per-task envelope inside that: `{ status_code, status_message, result: [...] }`
//
// So a single `dataforSeoPost<TaskResult>()` here covers all of them. Each
// adapter (maps-search, serp-organic, …) only needs: the endpoint path,
// the body schema, the result schema, and the operation tag + unit cost.
//
// Cost discipline: every adapter wraps its call with withCostCounter, which
// requires an open CronRun. The shared client itself does NOT increment cost
// — that's the adapter's responsibility, because different endpoints have
// different per-call pricing. See `./pricing.ts`.
//
// Retry policy: 2 retries on 5xx + 408 + 429, exponential backoff with
// jitter. Capped per `.claude/rules/scalability.md` § external API rate
// limits. Adapters can opt out via { retries: 0 }.
//
// Caching: NOT applied here. Each adapter wraps its public entrypoint with
// `kvCache(...)` separately so the TTL can vary per data-cadence tier:
// daily-fast (1h), weekly (12h), monthly (24h+). See data-cadence.md.

import { assertCronContext } from "@/lib/cost/cost-counter";

// ---- Constants ----------------------------------------------------------

const DEFAULT_BASE_URL =
  process.env.DATAFORSEO_BASE_URL?.replace(/\/+$/, "") ??
  "https://api.dataforseo.com";

/** Default per-call timeout. DataForSEO Live SERP responds in 1-3s typically;
 *  Lighthouse can take 30s+. Per-adapter override via options. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Default retry budget · 2 retries on 5xx / 408 / 429, exponential backoff. */
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 4_000;

// ---- Test seams ---------------------------------------------------------

let _fetchOverride: typeof fetch | null = null;
let _credentialsOverride: { username: string; password: string } | null = null;
let _sleepOverride: ((ms: number) => Promise<void>) | null = null;

/** Replace `globalThis.fetch` inside this module. Pass `null` to restore. */
export function __setFetchForTesting(fn: typeof fetch | null): void {
  _fetchOverride = fn;
}
/** Inject DataForSEO credentials (bypasses env). Pass `null` to restore. */
export function __setCredentialsForTesting(
  creds: { username: string; password: string } | null,
): void {
  _credentialsOverride = creds;
}
/** Replace the inter-retry sleep so tests don't wait real backoff windows. */
export function __setSleepForTesting(
  fn: ((ms: number) => Promise<void>) | null,
): void {
  _sleepOverride = fn;
}

function getFetch(): typeof fetch {
  return _fetchOverride ?? globalThis.fetch;
}

function getCredentials(): { username: string; password: string } {
  if (_credentialsOverride) return _credentialsOverride;
  const username = process.env.DATAFORSEO_USERNAME;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "[dataforseo] DATAFORSEO_USERNAME and DATAFORSEO_PASSWORD must be set. " +
        "Sign up at https://dataforseo.com (pay-as-you-go, ~$50 min deposit) " +
        "and add credentials to .env.local / Vercel env.",
    );
  }
  return { username, password };
}

function getSleep(): (ms: number) => Promise<void> {
  return _sleepOverride ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}

// ---- Types --------------------------------------------------------------

export interface DataForSeoPostOptions {
  /** Endpoint path under the base URL. Must start with `/`. */
  path: string;
  /** Operation tag for cost-counter attribution + error messages. */
  operation: string;
  /** Body payload — DataForSEO expects an array of task objects. We always
   *  send `[body]` so callers pass the single task object. */
  body: Record<string, unknown>;
  /** Override default per-call timeout. */
  timeoutMs?: number;
  /** Override default retry budget. 0 disables retries. */
  retries?: number;
}

/** Standard DataForSEO response envelope. */
export interface DataForSeoEnvelope<TaskResult> {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: Array<{
    id?: string;
    status_code: number;
    status_message: string;
    cost?: number;
    result_count?: number;
    result?: TaskResult[] | null;
  }>;
}

/**
 * DataForSEO error thrown on non-2xx HTTP or non-20000 envelope status_code.
 * Carries enough context for Sentry triage + retry classification.
 */
export class DataForSeoError extends Error {
  readonly operation: string;
  readonly httpStatus?: number;
  readonly envelopeStatusCode?: number;
  readonly retryable: boolean;

  constructor(opts: {
    operation: string;
    message: string;
    httpStatus?: number;
    envelopeStatusCode?: number;
    retryable?: boolean;
  }) {
    super(`[dataforseo] ${opts.operation}: ${opts.message}`);
    this.name = "DataForSeoError";
    this.operation = opts.operation;
    this.httpStatus = opts.httpStatus;
    this.envelopeStatusCode = opts.envelopeStatusCode;
    this.retryable = opts.retryable ?? false;
  }
}

// ---- Core POST ----------------------------------------------------------

/**
 * Issue a single POST to a DataForSEO endpoint. Enforces:
 *   - Open CronRun (the "no live API in user request path" invariant).
 *   - HTTPS basic auth.
 *   - AbortSignal timeout.
 *   - Retry on 5xx / 408 / 429 with exponential backoff + jitter.
 *   - Envelope status_code === 20000 ("Ok.") or throws DataForSeoError.
 *
 * Returns the FIRST task in `tasks[]`. DataForSEO supports batching tasks
 * via the request array, but every adapter we ship sends one task per call
 * (per-cache-key clarity); if batching is added later, refactor to return
 * the whole `tasks[]` array.
 *
 * Does NOT increment cost — adapter callers wrap this with `withCostCounter`
 * separately so per-endpoint pricing is explicit.
 */
export async function dataforSeoPost<TaskResult>(
  options: DataForSeoPostOptions,
): Promise<{
  result: TaskResult[];
  rawCostUsd: number | undefined;
  taskId: string | undefined;
}> {
  assertCronContext(options.operation);

  const { username, password } = getCredentials();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const url = buildUrl(options.path);
  const authHeader =
    "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  const bodyJson = JSON.stringify([options.body]);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = computeBackoffMs(attempt);
      await getSleep()(delay);
    }
    try {
      const res = await getFetch()(url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: bodyJson,
        signal: AbortSignal.timeout(timeoutMs),
      });

      // HTTP-level retry classification.
      if (!res.ok) {
        const retryable =
          res.status >= 500 || res.status === 408 || res.status === 429;
        const snippet = await safeReadText(res);
        const err = new DataForSeoError({
          operation: options.operation,
          message: `HTTP ${res.status} ${res.statusText}: ${snippet.slice(0, 300)}`,
          httpStatus: res.status,
          retryable,
        });
        if (retryable && attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      const envelope = (await res.json()) as DataForSeoEnvelope<TaskResult>;

      // Envelope-level error. status_code 20000 = "Ok.", 40xxx = client error,
      // 50xxx = server error. Retry server errors only.
      if (envelope.status_code !== 20000) {
        const isServerErr = envelope.status_code >= 50000;
        const err = new DataForSeoError({
          operation: options.operation,
          message: `envelope status_code ${envelope.status_code}: ${envelope.status_message}`,
          envelopeStatusCode: envelope.status_code,
          retryable: isServerErr,
        });
        if (isServerErr && attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      const task = envelope.tasks?.[0];
      if (!task) {
        throw new DataForSeoError({
          operation: options.operation,
          message: "envelope OK but tasks[] is empty",
          envelopeStatusCode: envelope.status_code,
        });
      }
      if (task.status_code !== 20000) {
        const isServerErr = task.status_code >= 50000;
        const err = new DataForSeoError({
          operation: options.operation,
          message: `task status_code ${task.status_code}: ${task.status_message}`,
          envelopeStatusCode: task.status_code,
          retryable: isServerErr,
        });
        if (isServerErr && attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      // DataForSEO returns `result: null` for queries that succeed but yield
      // no rows (e.g. an obscure keyword with no volume data). Normalize to
      // empty array so callers can iterate without nil checks.
      const result: TaskResult[] = task.result ?? [];
      // `task.cost` is the per-call cost in USD as reported by DataForSEO.
      // `task.id` is needed for Standard-queue patterns (task_post → poll).
      return { result, rawCostUsd: task.cost, taskId: task.id };
    } catch (err) {
      // AbortError from the timeout → retryable.
      if (
        err instanceof Error &&
        err.name === "TimeoutError" &&
        attempt < retries
      ) {
        lastErr = err;
        continue;
      }
      // Already a DataForSeoError → rethrow as-is.
      if (err instanceof DataForSeoError) throw err;
      // Network errors (DNS, TCP) → retryable.
      const message = err instanceof Error ? err.message : String(err);
      const wrapped = new DataForSeoError({
        operation: options.operation,
        message: `transport error: ${message}`,
        retryable: true,
      });
      if (attempt < retries) {
        lastErr = wrapped;
        continue;
      }
      throw wrapped;
    }
  }

  // Should be unreachable — the loop either returns or throws — but TS likes
  // an explicit terminal.
  if (lastErr) throw lastErr;
  throw new DataForSeoError({
    operation: options.operation,
    message: "retry budget exhausted with no captured error",
  });
}

// ---- Helpers ------------------------------------------------------------

function buildUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(
      `[dataforseo] path must start with "/", got ${JSON.stringify(path)}`,
    );
  }
  return DEFAULT_BASE_URL + path;
}

function computeBackoffMs(attempt: number): number {
  const exp = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const capped = Math.min(exp, RETRY_MAX_DELAY_MS);
  // Full jitter so concurrent cron workers don't synchronize retries.
  return Math.floor(Math.random() * capped);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
