import { Elysia } from "elysia";
import { runIdempotentJson } from "../lib/idempotency";
import { getRequestContext } from "../lib/request-context";
import { pushService } from "../services/push.service";
import {
  pushSubscriptionBodySchema,
  pushSubscriptionRecordListSchema,
  pushSubscriptionRecordSchema,
  pushTestBodySchema,
  pushTestResultSchema,
  subscriptionIdParamsSchema,
  vapidPublicKeySchema,
} from "../schemas/api.schema";

export const pushRoute = new Elysia({ prefix: "/push" })
  .get(
    "/vapid-public-key",
    () => pushService.getVapidPublicKey(),
    {
      response: vapidPublicKeySchema,
      detail: { tags: ["Push"], summary: "Get VAPID public key" },
    },
  )
  .post(
    "/subscriptions",
    async ({ body, request, set }) => {
      const context = getRequestContext(request);
      if (!request.headers.get("idempotency-key")) {
        const result = await pushService.upsertSubscription(context.householdId, body);
        set.status = result.created ? 201 : 200;
        return result.record;
      }

      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 201,
        operation: async () => (await pushService.upsertSubscription(context.householdId, body)).record,
      });
    },
    {
      body: pushSubscriptionBodySchema,
      response: pushSubscriptionRecordSchema,
      detail: { tags: ["Push"], summary: "Register/upsert web push subscription" },
    },
  )
  .get(
    "/subscriptions",
    ({ request }) => pushService.listSubscriptions(getRequestContext(request).householdId),
    {
      response: pushSubscriptionRecordListSchema,
      detail: { tags: ["Push"], summary: "List current push subscriptions" },
    },
  )
  .delete(
    "/subscriptions/:subscriptionId",
    async ({ params, request, set }) => {
      await pushService.deleteSubscription(getRequestContext(request).householdId, params.subscriptionId);
      set.status = 204;
    },
    {
      params: subscriptionIdParamsSchema,
      detail: { tags: ["Push"], summary: "Disable push subscription" },
    },
  )
  .post(
    "/test",
    ({ body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 200,
        operation: () => pushService.enqueueTestPush(
          context.householdId,
          body.subscriptionId,
        ),
      });
    },
    {
      body: pushTestBodySchema,
      response: pushTestResultSchema,
      detail: { tags: ["Push"], summary: "Send server-side test push to active subscriptions" },
    },
  );
