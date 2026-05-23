import { Elysia } from "elysia";
import { runIdempotentJson } from "../lib/idempotency";
import { getRequestContext } from "../lib/request-context";
import { inventoryService } from "../services/inventory.service";
import {
  inventoryBatchCreateBodySchema,
  inventoryBatchCreateResultSchema,
  inventoryCreateBodySchema,
  inventoryDiscardBodySchema,
  inventoryDiscardResultSchema,
  inventoryItemSchema,
  inventoryListQuerySchema,
  inventoryPageSchema,
  inventoryPatchBodySchema,
  inventorySelectionSchema,
  inventorySelectionUpdateBodySchema,
  itemIdParamsSchema,
} from "../schemas/api.schema";

export const inventoryRoute = new Elysia({ prefix: "/inventory" })
  .get(
    "/",
    ({ query, request }) => inventoryService.listItems(getRequestContext(request).householdId, query),
    {
      query: inventoryListQuerySchema,
      response: inventoryPageSchema,
      detail: { tags: ["Inventory"], summary: "List/search/filter inventory" },
    },
  )
  .post(
    "/",
    async ({ body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 201,
        operation: () => inventoryService.createItem(context.householdId, body),
      });
    },
    {
      body: inventoryCreateBodySchema,
      response: inventoryItemSchema,
      detail: { tags: ["Inventory"], summary: "Manual inventory item add" },
    },
  )
  .post(
    "/batch",
    async ({ body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 201,
        operation: () => inventoryService.createBatch(context.householdId, body),
      });
    },
    {
      body: inventoryBatchCreateBodySchema,
      response: inventoryBatchCreateResultSchema,
      detail: { tags: ["Inventory"], summary: "Batch confirm lens/manual candidates" },
    },
  )
  .get(
    "/selections",
    ({ request }) => inventoryService.getSelections(getRequestContext(request).householdId),
    {
      response: inventorySelectionSchema,
      detail: { tags: ["Inventory"], summary: "Get selected inventory item ids" },
    },
  )
  .put(
    "/selections",
    ({ body, request }) => inventoryService.updateSelections(getRequestContext(request).householdId, body),
    {
      body: inventorySelectionUpdateBodySchema,
      response: inventorySelectionSchema,
      detail: { tags: ["Inventory"], summary: "Persist recipe matching selections" },
    },
  )
  .get(
    "/:itemId",
    ({ params, request }) => inventoryService.getItem(getRequestContext(request).householdId, params.itemId),
    {
      params: itemIdParamsSchema,
      response: inventoryItemSchema,
      detail: { tags: ["Inventory"], summary: "Inventory item detail" },
    },
  )
  .patch(
    "/:itemId",
    ({ params, body, request }) => inventoryService.updateItem(getRequestContext(request).householdId, params.itemId, body),
    {
      params: itemIdParamsSchema,
      body: inventoryPatchBodySchema,
      response: inventoryItemSchema,
      detail: { tags: ["Inventory"], summary: "Edit inventory item" },
    },
  )
  .delete(
    "/:itemId",
    ({ params, body, request }) => inventoryService.discardItem(getRequestContext(request).householdId, params.itemId, body ?? undefined),
    {
      params: itemIdParamsSchema,
      body: inventoryDiscardBodySchema,
      response: inventoryDiscardResultSchema,
      detail: { tags: ["Inventory"], summary: "Discard inventory item" },
    },
  );
