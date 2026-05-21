import { Elysia } from "elysia";
import { prisma } from "../lib/prisma";

export const healthRoute = new Elysia({ prefix: "/health" })
  .get("/", async () => {
    await prisma.$queryRaw`SELECT 1`;

    return {
      ok: true,
      service: "fridge-waste-backend",
      db: "ok",
      timestamp: new Date().toISOString(),
    };
  })
  .get("/ping", () => {
    return {
      ok: true,
      message: "pong",
    };
  });