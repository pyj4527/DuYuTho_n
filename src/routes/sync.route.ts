import { Elysia } from "elysia";
import { runIdempotentJson } from "../lib/idempotency";
import { getRequestContext } from "../lib/request-context";
import { syncService } from "../services/sync.service";
import {
  prototypeImportBodySchema,
  prototypeImportResultSchema,
  syncPullBodySchema,
  syncPullResponseSchema,
} from "../schemas/api.schema";

export const syncRoute = new Elysia({ prefix: "/sync" })
  .post(
    "/import-prototype-state",
    ({ body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 200,
        operation: () => syncService.importPrototypeState(context.householdId, body),
      });
    },
    {
      body: prototypeImportBodySchema,
      response: prototypeImportResultSchema,
      detail: { tags: ["Sync"], summary: "Import frontend prototype localStorage state" },
    },
  )
  .post(
    "/pull",
    ({ body, request }) => syncService.pull(getRequestContext(request).householdId, body),
    {
      body: syncPullBodySchema,
      response: syncPullResponseSchema,
      detail: { tags: ["Sync"], summary: "Delta sync pull scaffold" },
    },
  );
