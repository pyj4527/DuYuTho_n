import { Prisma } from "../../generated/prisma/client";
import { prisma } from "./prisma";
import { throwProblem } from "./problem";

const replayWindowMs = 24 * 60 * 60 * 1000;

type ResponseSet = {
  status?: number | string;
  headers: Record<string, string | number | string[]>;
};

export async function runIdempotentJson<T>(input: {
  householdId: string;
  request: Request;
  set: ResponseSet;
  body: unknown;
  successStatus: number;
  operation: () => Promise<T>;
}): Promise<T> {
  const key = input.request.headers.get("idempotency-key")?.trim();
  if (!key) {
    input.set.status = input.successStatus;
    return input.operation();
  }

  validateIdempotencyKey(key);

  const endpoint = `${input.request.method.toUpperCase()} ${new URL(input.request.url).pathname}`;
  const requestHash = await sha256(stableStringify(input.body));
  const now = new Date();
  const existing = await prisma.idempotencyRecord.findUnique({
    where: {
      householdId_endpoint_key: {
        householdId: input.householdId,
        endpoint,
        key,
      },
    },
  });

  if (existing && existing.expiresAt > now) {
    if (existing.requestHash !== requestHash) {
      throwProblem({
        status: 422,
        title: "Validation error",
        detail: "Idempotency-Key was replayed with a different request body",
        errors: [{ pointer: "#/Idempotency-Key", detail: "Idempotency key body mismatch", code: "idempotency_body_mismatch" }],
      });
    }

    input.set.status = existing.status;
    input.set.headers["idempotency-replayed"] = "true";
    return existing.responseBody as T;
  }

  if (existing) {
    await prisma.idempotencyRecord.delete({ where: { id: existing.id } });
  }

  input.set.status = input.successStatus;
  const responseBody = await input.operation();

  await prisma.idempotencyRecord.create({
    data: {
      householdId: input.householdId,
      endpoint,
      key,
      requestHash,
      status: input.successStatus,
      responseBody: toInputJsonValue(responseBody),
      expiresAt: new Date(now.getTime() + replayWindowMs),
    },
  });

  return responseBody;
}

function validateIdempotencyKey(key: string): void {
  if (key.length === 0 || key.length > 256) {
    throwProblem({
      status: 422,
      title: "Validation error",
      detail: "Idempotency-Key must be 1-256 characters",
      errors: [{ pointer: "#/Idempotency-Key", detail: "Invalid Idempotency-Key length", code: "invalid_idempotency_key" }],
    });
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value instanceof File) {
    return {
      name: value.name,
      size: value.size,
      type: value.type,
      lastModified: value.lastModified,
    };
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJson(entryValue)]),
    );
  }
  return value;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (parsed === null) {
    throwProblem({ status: 500, title: "Internal server error", detail: "Idempotent response body cannot be null" });
  }
  return parsed as Prisma.InputJsonValue;
}
