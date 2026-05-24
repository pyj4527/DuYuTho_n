import { verifyToken } from "@clerk/backend";
import { createProblem, ProblemError, problemResponse } from "./problem";

export type RequestContext = {
  householdId: string;
  userId: string;
  requestId: string;
  authMode: "anonymous" | "clerk";
  clerkSessionId?: string;
};

export const DEFAULT_HOUSEHOLD_ID = process.env.DEFAULT_HOUSEHOLD_ID ?? "hh_default";
export const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? "user_default";

const contextByRequest = new WeakMap<Request, RequestContext>();
const publicApiV1Routes = new Set(["GET /api/v1/push/vapid-public-key"]);

export function getRequestId(request: Request): string {
  const incoming = request.headers.get("x-request-id")?.trim();
  return incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
}

export function getRequestContext(request: Request): RequestContext {
  const cached = contextByRequest.get(request);
  if (cached) return cached;

  const context = createAnonymousContext(getRequestId(request));
  contextByRequest.set(request, context);
  return context;
}

export async function authenticateApiRequest(request: Request, requestId: string): Promise<Response | undefined> {
  if (!requiresAuthentication(request)) {
    return undefined;
  }

  try {
    await resolveRequestContext(request, requestId);
    return undefined;
  } catch (error) {
    if (error instanceof ProblemError) {
      return problemResponse({
        ...error.problem,
        instance: error.problem.instance ?? new URL(request.url).pathname,
        requestId,
      });
    }
    throw error;
  }
}

async function resolveRequestContext(request: Request, requestId: string): Promise<RequestContext> {
  const cached = contextByRequest.get(request);
  if (cached) return cached;

  const token = getBearerToken(request);
  if (token) {
    const context = await createClerkContext(token, request, requestId);
    contextByRequest.set(request, context);
    return context;
  }

  if (isAnonymousHouseholdAllowed()) {
    const context = createAnonymousContext(requestId);
    contextByRequest.set(request, context);
    return context;
  }

  throw new ProblemError(createProblem({
    status: 401,
    title: "Authentication required",
    detail: "Missing Clerk bearer token. Sign in on the frontend and send Authorization: Bearer <token> for /api/v1 requests.",
  }));
}

async function createClerkContext(token: string, request: Request, requestId: string): Promise<RequestContext> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const jwtKey = process.env.CLERK_JWT_KEY?.trim();
  if (!secretKey && !jwtKey) {
    throw new ProblemError(createProblem({
      status: 500,
      title: "Authentication configuration error",
      detail: "Clerk server authentication requires CLERK_SECRET_KEY or CLERK_JWT_KEY.",
    }));
  }

  try {
    const payload = await verifyToken(token, {
      authorizedParties: getAuthorizedParties(request),
      jwtKey: jwtKey || undefined,
      secretKey: secretKey || undefined,
    });

    return {
      authMode: "clerk",
      clerkSessionId: payload.sid,
      householdId: getHouseholdIdForClerkUser(payload.sub),
      requestId,
      userId: payload.sub,
    };
  } catch (error) {
    if (error instanceof ProblemError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new ProblemError(createProblem({
        status: 401,
        title: "Authentication required",
        detail: "Clerk session token is invalid or expired.",
      }));
    }
    throw error;
  }
}

function createAnonymousContext(requestId: string): RequestContext {
  return {
    authMode: "anonymous",
    householdId: DEFAULT_HOUSEHOLD_ID,
    requestId,
    userId: DEFAULT_USER_ID,
  };
}

function requiresAuthentication(request: Request): boolean {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/v1/")) {
    return false;
  }

  return !publicApiV1Routes.has(`${request.method.toUpperCase()} ${url.pathname}`);
}

function getBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return undefined;

  const [scheme, token, extra] = authorization.split(/\s+/u);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) {
    throw new ProblemError(createProblem({
      status: 401,
      title: "Authentication required",
      detail: "Authorization header must use Bearer token format.",
    }));
  }

  return token;
}

function getAuthorizedParties(request: Request): string[] | undefined {
  const configured = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new ProblemError(createProblem({
      status: 500,
      title: "Authentication configuration error",
      detail: "CLERK_AUTHORIZED_PARTIES must list trusted frontend origins in production.",
    }));
  }

  const origin = request.headers.get("origin")?.trim();
  return origin ? [origin] : undefined;
}

export function isAnonymousHouseholdAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.ALLOW_ANONYMOUS_HOUSEHOLD === "true";
}

function getHouseholdIdForClerkUser(userId: string): string {
  return `clerk_${userId.replace(/[^A-Za-z0-9_-]/gu, "_")}`;
}
