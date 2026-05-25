import { Elysia } from "elysia";
import { runIdempotentJson } from "../lib/idempotency";
import { getRequestContext } from "../lib/request-context";
import { notificationService } from "../services/notification.service";
import {
  notificationDispatchBodySchema,
  notificationDispatchResultSchema,
  notificationPreferencePatchBodySchema,
  notificationPreferenceSchema,
  notificationPreviewSchema,
} from "../schemas/api.schema";

export const notificationRoute = new Elysia({ prefix: "/notifications" })
  .get(
    "/preferences",
    ({ request }) => notificationService.getPreferences(getRequestContext(request).householdId),
    {
      response: notificationPreferenceSchema,
      detail: { tags: ["Notifications"], summary: "Fetch notification preferences and recommended time" },
    },
  )
  .put(
    "/preferences",
    ({ body, request }) => notificationService.updatePreferences(getRequestContext(request).householdId, body),
    {
      body: notificationPreferencePatchBodySchema,
      response: notificationPreferenceSchema,
      detail: { tags: ["Notifications"], summary: "Update notification preferences" },
    },
  )
  .get(
    "/preview",
    ({ request }) => notificationService.preview(getRequestContext(request).householdId),
    {
      response: notificationPreviewSchema,
      detail: { tags: ["Notifications"], summary: "Preview expiry and today-to-eat notifications" },
    },
  )
  .post(
    "/send-due",
    ({ body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 200,
        operation: () => notificationService.dispatchDue(context.householdId, body ?? {}),
      });
    },
    {
      body: notificationDispatchBodySchema,
      response: notificationDispatchResultSchema,
      detail: { tags: ["Notifications"], summary: "Dispatch due notification payloads to active subscriptions" },
    },
  );
