import { getRequestContext } from "./request-context";
import { createProblem, problemResponse } from "./problem";

type RateLimitRule = {
  name: string;
  limit: number;
  windowMs: number;
  match: (request: Request) => boolean;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const buckets = new Map<string, Bucket>();

const rules: RateLimitRule[] = [
  {
    name: "lens_image_analyze",
    limit: Number(process.env.RATE_LIMIT_LENS_IMAGE_PER_HOUR ?? 30),
    windowMs: hourMs,
    match: (request) => isMethodPath(request, "POST", "/api/v1/lens/analyze-image"),
  },
  {
    name: "lens_text_analyze",
    limit: Number(process.env.RATE_LIMIT_LENS_TEXT_PER_HOUR ?? 120),
    windowMs: hourMs,
    match: (request) => isMethodPath(request, "POST", "/api/v1/lens/analyze-text"),
  },
  {
    name: "push_test",
    limit: Number(process.env.RATE_LIMIT_PUSH_TEST_PER_HOUR ?? 10),
    windowMs: hourMs,
    match: (request) => isMethodPath(request, "POST", "/api/v1/push/test"),
  },
  {
    name: "prototype_import",
    limit: Number(process.env.RATE_LIMIT_PROTOTYPE_IMPORT_PER_DAY ?? 20),
    windowMs: dayMs,
    match: (request) => isMethodPath(request, "POST", "/api/v1/sync/import-prototype-state"),
  },
];

export function enforceRateLimit(request: Request, requestId: string): Response | undefined {
  const rule = rules.find((candidate) => candidate.match(request));
  if (!rule) {
    return undefined;
  }

  const now = Date.now();
  const key = `${rule.name}:${getHouseholdKey(request)}:${getClientIp(request)}`;
  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + rule.windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count <= rule.limit) {
    return undefined;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  return problemResponse(
    createProblem({
      status: 429,
      title: "Rate limit exceeded",
      detail: `${rule.name} allows ${rule.limit} requests per ${rule.windowMs === dayMs ? "day" : "hour"}`,
      instance: new URL(request.url).pathname,
      requestId,
    }),
    { "retry-after": String(retryAfterSeconds) },
  );
}

function isMethodPath(request: Request, method: string, path: string): boolean {
  return request.method.toUpperCase() === method && new URL(request.url).pathname === path;
}

function getHouseholdKey(request: Request): string {
  return getRequestContext(request).householdId;
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("cf-connecting-ip")?.trim() || "local";
}
