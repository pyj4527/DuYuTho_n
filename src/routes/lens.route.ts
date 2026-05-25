import { Elysia, t } from "elysia";
import { runIdempotentJson } from "../lib/idempotency";
import { getRequestContext } from "../lib/request-context";
import { lensService } from "../services/lens.service";
import {
  analysisIdParamsSchema,
  lensAnalyzeImageBodySchema,
  lensAnalyzeJobSchema,
  lensAnalyzeResponseSchema,
  lensAnalyzeTextBodySchema,
} from "../schemas/api.schema";

export const lensRoute = new Elysia({ prefix: "/lens" })
  .post(
    "/analyze-text",
    ({ body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 200,
        operation: () => lensService.analyzeText(context.householdId, body),
      });
    },
    {
      body: lensAnalyzeTextBodySchema,
      response: lensAnalyzeResponseSchema,
      detail: { tags: ["Lens"], summary: "Analyze natural language ingredient text" },
    },
  )
  .post(
    "/analyze-image",
    ({ body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 200,
        operation: () => lensService.analyzeImage(
          context.householdId,
          body.image,
          body.metadata,
        ),
      });
    },
    {
      body: lensAnalyzeImageBodySchema,
      response: lensAnalyzeResponseSchema,
      detail: { tags: ["Lens"], summary: "Analyze food image with backend AI vision" },
    },
  )
  .post(
    "/receipt",
    ({ body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 200,
        operation: () => lensService.analyzeReceiptImage(
          context.householdId,
          body.image,
          body.metadata,
        ),
      });
    },
    {
      body: lensAnalyzeImageBodySchema,
      response: lensAnalyzeResponseSchema,
      detail: { tags: ["Lens"], summary: "Analyze receipt image with OCR-oriented review guards" },
    },
  )
  .post(
    "/fridge",
    ({ body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body,
        successStatus: 200,
        operation: () => lensService.analyzeFridgeImage(
          context.householdId,
          body.image,
          body.metadata,
        ),
      });
    },
    {
      body: lensAnalyzeImageBodySchema,
      response: lensAnalyzeResponseSchema,
      detail: { tags: ["Lens"], summary: "Analyze fridge image with duplicate and confidence review guards" },
    },
  )
  .get(
    "/analyses/:analysisId",
    ({ params, request }) => lensService.getAnalysis(getRequestContext(request).householdId, params.analysisId),
    {
      params: analysisIdParamsSchema,
      response: t.Union([lensAnalyzeResponseSchema, lensAnalyzeJobSchema]),
      detail: { tags: ["Lens"], summary: "Fetch lens analysis result/job" },
    },
  );
