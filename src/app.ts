import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";

import { healthRoute } from "./routes/health.route";
import { v1Route } from "./routes/v1.route";
import { createProblem, ProblemError, problemResponse } from "./lib/problem";
import { enforceRateLimit } from "./lib/rate-limit";
import { authenticateApiRequest, getRequestId } from "./lib/request-context";
import { serveStaticOrSpa } from "./lib/static-files";
import { InventoryItemNotFoundError } from "./services/inventory.service";

export const app = new Elysia()
  .onRequest(({ request, set }) => {
    const requestId = getRequestId(request);
    set.headers["x-request-id"] = requestId;
    applySecurityHeaders(set.headers);
    applyCorsHeaders(request, set.headers);
  })
  .onError(({ code, error, request, set }) => {
    const requestId = getHeaderValue(set.headers["x-request-id"]) ?? getRequestId(request);
    applySecurityHeaders(set.headers);
    applyCorsHeaders(request, set.headers);

    if (error instanceof ProblemError) {
      return problemResponse({
        ...error.problem,
        requestId,
        instance: error.problem.instance ?? new URL(request.url).pathname,
      });
    }

    if (error instanceof InventoryItemNotFoundError || code === "NOT_FOUND") {
      return problemResponse(createProblem({
        status: 404,
        title: "Not found",
        detail: error instanceof InventoryItemNotFoundError ? "Inventory item not found" : "Route not found",
        instance: new URL(request.url).pathname,
        requestId,
      }));
    }

    if (code === "VALIDATION" || code === "PARSE") {
      return problemResponse(createProblem({
        status: code === "PARSE" ? 400 : 422,
        title: code === "PARSE" ? "Malformed request" : "Validation error",
        detail: error instanceof Error ? error.message : "Request validation failed",
        instance: new URL(request.url).pathname,
        requestId,
        errors: [{ pointer: "#", detail: "Request validation failed", code: String(code).toLowerCase() }],
      }));
    }

    console.error({ requestId, error });

    return problemResponse(createProblem({
      status: 500,
      title: "Internal server error",
      detail: "Unexpected server error",
      instance: new URL(request.url).pathname,
      requestId,
    }));
  })
  .options("/api/*", ({ request, set }) => {
    applyCorsHeaders(request, set.headers);
    set.status = 204;
    return "";
  })
  .onBeforeHandle(async ({ request, set }) => {
    const requestId = getHeaderValue(set.headers["x-request-id"]) ?? getRequestId(request);
    const guardResponse = guardApiRequest(request, requestId);
    if (guardResponse) {
      return guardResponse;
    }
    const authResponse = await authenticateApiRequest(request, requestId);
    if (authResponse) {
      return authResponse;
    }
    return enforceRateLimit(request, requestId);
  })
  .use(
    swagger({
      path: "/swagger",
      specPath: "/api/openapi.json",
      documentation: {
        openapi: "3.1.0",
        info: {
          title: "잔반제로 Backend API",
          version: "0.2.0",
          description:
            "BR_SPEC-compatible Bun + Elysia + Prisma/PostgreSQL backend scaffold for inventory, lens, recipes, push, profile, and sync.",
        },
        servers: [{ url: "/" }],
        components: {
          securitySchemes: {
            clerkBearer: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description:
                "Clerk session token sent as Authorization: Bearer <token>. Clerk SDKs issue short-lived session JWTs and rotate them client-side; expired, revoked, signed-out, or otherwise invalidated sessions fail verification with 401. Backend verification also pins the token authorized party (azp) to CLERK_AUTHORIZED_PARTIES. Non-production local demos can explicitly enable ALLOW_ANONYMOUS_HOUSEHOLD=true for fallback household scoping; production always requires Clerk bearer authentication.",
            },
          },
          schemas: {
            ProblemDetailsDto: {
              type: "object",
              required: ["type", "title", "status"],
              properties: {
                type: { type: "string" },
                title: { type: "string" },
                status: { type: "integer" },
                detail: { type: "string" },
                instance: { type: "string" },
                requestId: { type: "string" },
                errors: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["pointer", "detail"],
                    properties: {
                      pointer: { type: "string" },
                      detail: { type: "string" },
                      code: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          responses: {
            Problem400: { description: "Malformed request", content: problemJsonContent() },
            Problem401: { description: "Authentication required", content: problemJsonContent() },
            Problem403: { description: "Forbidden", content: problemJsonContent() },
            Problem404: { description: "Not found", content: problemJsonContent() },
            Problem409: { description: "Conflict", content: problemJsonContent() },
            Problem413: { description: "Payload too large", content: problemJsonContent() },
            Problem415: { description: "Unsupported media type", content: problemJsonContent() },
            Problem422: { description: "Validation error", content: problemJsonContent() },
            Problem429: { description: "Rate limit exceeded", content: problemJsonContent() },
            Problem500: { description: "Unexpected server error", content: problemJsonContent() },
          },
        },
      },
    }),
  )
  .use(healthRoute)
  .use(v1Route)
  .get("/health", () => Response.redirect("/api/health", 307), {
    detail: { tags: ["Legacy aliases"], summary: "Legacy health redirect" },
  })
  .get("/*", ({ request, set }) => {
    const requestId = getHeaderValue(set.headers["x-request-id"]) ?? getRequestId(request);
    return serveStaticOrSpa(request, requestId);
  });

function problemJsonContent() {
  return {
    "application/problem+json": {
      schema: { $ref: "#/components/schemas/ProblemDetailsDto" },
    },
  };
}

function applySecurityHeaders(headers: Record<string, string | number | string[]>): void {
  headers["x-content-type-options"] = "nosniff";
  headers["referrer-policy"] = "strict-origin-when-cross-origin";
  headers["permissions-policy"] = "camera=(self), microphone=(), geolocation=()";
  headers["content-security-policy"] = getContentSecurityPolicy();
  if (process.env.NODE_ENV === "production") {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
}

function getContentSecurityPolicy(): string {
  const clerkFrontendApiOrigin = getClerkFrontendApiOrigin();
  const clerkScriptSources = [
    "'self'",
    "'unsafe-inline'",
    "https://static.cloudflareinsights.com",
    "https://challenges.cloudflare.com",
    clerkFrontendApiOrigin,
  ].filter(Boolean);

  const clerkConnectSources = [
    "'self'",
    "https:",
    "https://cloudflareinsights.com",
    clerkFrontendApiOrigin,
  ].filter(Boolean);

  return [
    "default-src 'self'",
    `script-src ${clerkScriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: https://img.clerk.com",
    `connect-src ${clerkConnectSources.join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://challenges.cloudflare.com",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function getClerkFrontendApiOrigin(): string | undefined {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) return undefined;

  const encodedFrontendApi = publishableKey.split("_")[2];
  if (!encodedFrontendApi) return undefined;

  try {
    const decoded = Buffer.from(toBase64(encodedFrontendApi), "base64").toString("utf8");
    const hostname = decoded.endsWith("$") ? decoded.slice(0, -1) : decoded;
    if (!hostname || hostname.includes("/") || !hostname.includes(".")) return undefined;
    return `https://${hostname}`;
  } catch {
    return undefined;
  }
}

function toBase64(base64Url: string): string {
  const normalized = base64Url.replaceAll("-", "+").replaceAll("_", "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return `${normalized}${"=".repeat(paddingLength)}`;
}

function applyCorsHeaders(request: Request, headers: Record<string, string | number | string[]>): void {
  const origin = request.headers.get("origin");
  const allowedOrigin = getAllowedOrigin(origin);
  if (allowedOrigin) {
    headers["access-control-allow-origin"] = allowedOrigin;
    headers["access-control-allow-credentials"] = "true";
  }
  headers["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
  headers["access-control-allow-headers"] = "Content-Type, Authorization, Idempotency-Key, If-Match, X-Request-Id";
  headers["access-control-max-age"] = "86400";
  headers.vary = "Origin";
}

function getAllowedOrigin(origin: string | null): string | null {
  if (!origin) {
    return null;
  }
  const configured = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length === 0 && process.env.NODE_ENV !== "production") {
    const defaultDevelopmentOrigins = new Set([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);
    return defaultDevelopmentOrigins.has(origin) ? origin : null;
  }

  return configured.includes(origin) ? origin : null;
}

function guardApiRequest(request: Request, requestId: string): Response | undefined {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    return undefined;
  }

  const origin = request.headers.get("origin");
  if (origin && !getAllowedOrigin(origin)) {
    return problemResponse(createProblem({
      status: 403,
      title: "Forbidden origin",
      detail: "Request origin is not allowed",
      instance: url.pathname,
      requestId,
    }));
  }

  return undefined;
}

function getHeaderValue(value: string | number | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}
