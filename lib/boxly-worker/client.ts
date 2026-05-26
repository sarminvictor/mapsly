/**
 * Boxly Worker client · enqueues background jobs to the sibling-product
 * worker so long-running batch work (qualifying 100 businesses, etc.)
 * doesn't have to fit in Vercel's 300s function timeout.
 *
 * Architecture (per Viktor's design):
 *   Mapsly → POST /callback-webhook to Boxly Worker (returns immediately)
 *          → Worker queues jobs in Redis, processes with concurrency + retry
 *          → Worker POSTs callback URL with payload (e.g. /api/qualify-one)
 *          → Callback endpoint does the actual work on its own 300s budget
 *
 * Auth: shared bearer token (BOXLY_WORKER_AUTH_TOKEN). The same token
 * authenticates inbound to worker (enqueue) and the worker uses it on
 * outbound callbacks so Mapsly can verify the caller is the worker.
 *
 * Per `.claude/rules/security.md` we don't crash at module load — the
 * client constructor is cheap, and config errors surface at the first
 * `enqueue()` call (when the worker URL is needed).
 */

const DEFAULT_BATCH_MAX = 500; // matches the worker's ArrayMaxSize
const DEFAULT_TIMEOUT_MS = 15_000;

/** One job enqueue request · matches the worker's CallbackWebhookJobDto. */
export interface WorkerJob {
  /** Stable id · embed business id + timestamp for end-to-end idempotency. */
  taskId: string;
  /** Absolute URL the worker will POST to with `payload` as the body. */
  url: string;
  /** Body for the POST · arbitrary JSON. */
  payload: Record<string, unknown>;
  /** Optional per-job timeout override (1-120s · default 30s on worker). */
  timeoutSec?: number;
  /** Optional log tag like "mapsly:qualify-business" for worker-side filtering. */
  callerLabel?: string;
}

export interface EnqueueResponse {
  taskIds: string[];
  queued: number;
  failed: number;
}

export class BoxlyWorkerError extends Error {
  readonly httpStatus?: number;
  readonly body?: string;
  constructor(
    message: string,
    opts: { httpStatus?: number; body?: string } = {},
  ) {
    super(message);
    this.name = "BoxlyWorkerError";
    this.httpStatus = opts.httpStatus;
    this.body = opts.body;
  }
}

function readConfig(): { baseUrl: string; authToken: string } {
  const baseUrl = process.env.BOXLY_WORKER_BASE_URL;
  const authToken = process.env.BOXLY_WORKER_AUTH_TOKEN;
  if (!baseUrl) {
    throw new BoxlyWorkerError(
      "BOXLY_WORKER_BASE_URL not set — required to enqueue jobs",
    );
  }
  if (!authToken) {
    throw new BoxlyWorkerError(
      "BOXLY_WORKER_AUTH_TOKEN not set — required to authenticate to worker",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), authToken };
}

/**
 * Enqueue a batch of jobs. Returns the per-task IDs the worker accepted.
 * Throws BoxlyWorkerError on transport / non-2xx HTTP / partial failure
 * larger than the caller can tolerate.
 *
 * The worker validates per-job (URL shape, payload object), so a single
 * bad job in the batch returns 400 for that one and 202 for the rest.
 * Our response shape `{ queued, failed }` reflects worker tally.
 */
export async function enqueueCallbackWebhooks(
  jobs: WorkerJob[],
  options: { timeoutMs?: number } = {},
): Promise<EnqueueResponse> {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { taskIds: [], queued: 0, failed: 0 };
  }
  if (jobs.length > DEFAULT_BATCH_MAX) {
    throw new BoxlyWorkerError(
      `Batch too large: ${jobs.length} > ${DEFAULT_BATCH_MAX}. Split into multiple enqueueCallbackWebhooks() calls.`,
    );
  }

  const { baseUrl, authToken } = readConfig();
  const url = `${baseUrl}/callback-webhook`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(jobs),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BoxlyWorkerError(`Boxly Worker unreachable: ${message}`);
  }

  const body = await res.text();
  if (!res.ok) {
    throw new BoxlyWorkerError(
      `Boxly Worker returned ${res.status}: ${body.slice(0, 300)}`,
      { httpStatus: res.status, body },
    );
  }

  try {
    return JSON.parse(body) as EnqueueResponse;
  } catch {
    throw new BoxlyWorkerError(
      `Boxly Worker returned non-JSON body (HTTP ${res.status})`,
      { httpStatus: res.status, body },
    );
  }
}

/**
 * Verify that an incoming HTTP request was issued by the Boxly Worker.
 * The worker sends `Authorization: Bearer <AUTH_TOKEN>` on every
 * outbound callback (per its callback.service pattern). We match
 * against the same shared secret.
 *
 * Returns true when verified, false otherwise. Use in webhook routes:
 *
 *   if (!verifyBoxlyWorkerAuth(request.headers.get("authorization"))) {
 *     return new Response("Unauthorized", { status: 401 });
 *   }
 */
export function verifyBoxlyWorkerAuth(
  authHeader: string | null | undefined,
): boolean {
  if (!authHeader) return false;
  const expected = process.env.BOXLY_WORKER_AUTH_TOKEN;
  if (!expected) return false;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return constantTimeEquals(match[1] ?? "", expected);
}

/** Timing-safe string compare · same shape as crypto.timingSafeEqual but
 *  string-typed so we can use it on env-var values without Buffer dance. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
