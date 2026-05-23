import { Elysia } from "elysia";
import { getRequestContext } from "../lib/request-context";
import { householdService } from "../services/household.service";
import {
  clientPreferenceBodySchema,
  householdSettingsPatchBodySchema,
  householdSettingsSchema,
  profilePatchBodySchema,
} from "../schemas/api.schema";

export const profileRoute = new Elysia()
  .get(
    "/me",
    ({ request }) => householdService.getSettings(getRequestContext(request).householdId),
    {
      response: householdSettingsSchema,
      detail: { tags: ["Profile"], summary: "Current user/profile/household summary" },
    },
  )
  .patch(
    "/me/profile",
    ({ body, request }) => householdService.updateProfile(getRequestContext(request).householdId, body),
    {
      body: profilePatchBodySchema,
      detail: { tags: ["Profile"], summary: "Update current user profile" },
    },
  )
  .get(
    "/household/settings",
    ({ request }) => householdService.getSettings(getRequestContext(request).householdId),
    {
      response: householdSettingsSchema,
      detail: { tags: ["Profile"], summary: "Fetch household settings" },
    },
  )
  .patch(
    "/household/settings",
    ({ body, request }) => householdService.updateSettings(getRequestContext(request).householdId, body),
    {
      body: householdSettingsPatchBodySchema,
      response: householdSettingsSchema,
      detail: { tags: ["Profile"], summary: "Update household settings" },
    },
  )
  .patch(
    "/me/client-preferences",
    ({ body, request }) => householdService.updateClientPreferences(getRequestContext(request).householdId, body),
    {
      body: clientPreferenceBodySchema,
      detail: { tags: ["Profile"], summary: "Sync client preferences" },
    },
  );
