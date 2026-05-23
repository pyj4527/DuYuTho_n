import { Elysia } from "elysia";
import { prisma } from "../lib/prisma";
import { healthSchema, readinessSchema } from "../schemas/api.schema";

export const healthRoute = new Elysia({ prefix: "/api" })
  .get(
    "/health",
    () => ({
      status: "ok" as const,
      time: new Date().toISOString(),
    }),
    {
      response: healthSchema,
      detail: { tags: ["Health"], summary: "Liveness check" },
    },
  )
  .get(
    "/ready",
    async () => {
      const startedAt = performance.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
        return {
          status: "ready" as const,
          time: new Date().toISOString(),
          dependencies: [
            {
              name: "database",
              status: "ready" as const,
              latencyMs: Math.round(performance.now() - startedAt),
            },
          ],
        };
      } catch (error) {
        if (!(error instanceof Error)) {
          console.error({ readinessError: error });
        }
        return {
          status: "down" as const,
          time: new Date().toISOString(),
          dependencies: [
            {
              name: "database",
              status: "down" as const,
              latencyMs: Math.round(performance.now() - startedAt),
            },
          ],
        };
      }
    },
    {
      response: readinessSchema,
      detail: { tags: ["Health"], summary: "Readiness check" },
    },
  );
