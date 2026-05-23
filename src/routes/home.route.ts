import { Elysia } from "elysia";
import { getRequestContext } from "../lib/request-context";
import { homeService } from "../services/home.service";
import {
  expiryCalendarMonthSchema,
  expiryCalendarQuerySchema,
  homeSummarySchema,
} from "../schemas/api.schema";

export const homeRoute = new Elysia({ prefix: "/home" })
  .get(
    "/summary",
    ({ request }) => homeService.getSummary(getRequestContext(request).householdId),
    {
      response: homeSummarySchema,
      detail: { tags: ["Home"], summary: "Dashboard counts and state" },
    },
  )
  .get(
    "/expiry-calendar",
    ({ query, request }) => homeService.getExpiryCalendar(
      getRequestContext(request).householdId,
      query.year,
      query.month,
    ),
    {
      query: expiryCalendarQuerySchema,
      response: expiryCalendarMonthSchema,
      detail: { tags: ["Home"], summary: "Monthly expiry calendar" },
    },
  );
