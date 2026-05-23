import { Elysia } from "elysia";
import type { RecipeConditionKey } from "../domain/dto";
import { recipeConditionKeys } from "../domain/dto";
import { runIdempotentJson } from "../lib/idempotency";
import { getRequestContext } from "../lib/request-context";
import { recipeService } from "../services/recipe.service";
import {
  recipeConsumeBodySchema,
  recipeConsumeResultSchema,
  recipeConsumptionLogPageSchema,
  recipeDtoSchema,
  recipeIdParamsSchema,
  recipeListQuerySchema,
  pageQuerySchema,
  recipePageSchema,
  recipeRecommendationSchema,
  recipeSavedBodySchema,
} from "../schemas/api.schema";

export const recipeRoute = new Elysia({ prefix: "/recipes" })
  .get(
    "/",
    ({ query, request }) => recipeService.listRecipes(getRequestContext(request).householdId, {
      ...query,
      conditions: query.conditions?.filter(isRecipeConditionKey),
    }),
    {
      query: recipeListQuerySchema,
      response: recipePageSchema,
      detail: { tags: ["Recipes"], summary: "List recipe recommendations" },
    },
  )
  .get(
    "/consumption-logs",
    ({ query, request }) => recipeService.listConsumptionLogs(
      getRequestContext(request).householdId,
      query.cursor,
      query.limit,
    ),
    {
      query: pageQuerySchema,
      response: recipeConsumptionLogPageSchema,
      detail: { tags: ["Recipes"], summary: "Recent recipe consumption logs" },
    },
  )
  .get(
    "/:recipeId",
    ({ params, query, request }) => recipeService.getRecipe(
      getRequestContext(request).householdId,
      params.recipeId,
      query.selectedIngredientIds ?? [],
    ),
    {
      params: recipeIdParamsSchema,
      query: recipeListQuerySchema,
      response: recipeRecommendationSchema,
      detail: { tags: ["Recipes"], summary: "Recipe detail with match info" },
    },
  )
  .put(
    "/:recipeId/saved",
    ({ params, body, request }) => recipeService.setSaved(
      getRequestContext(request).householdId,
      params.recipeId,
      body.saved,
    ),
    {
      params: recipeIdParamsSchema,
      body: recipeSavedBodySchema,
      response: recipeDtoSchema,
      detail: { tags: ["Recipes"], summary: "Save or unsave recipe" },
    },
  )
  .post(
    "/:recipeId/consume",
    ({ params, body, request, set }) => {
      const context = getRequestContext(request);
      return runIdempotentJson({
        householdId: context.householdId,
        request,
        set,
        body: { ...body, recipeId: params.recipeId },
        successStatus: 200,
        operation: () => recipeService.consumeRecipe(
          context.householdId,
          params.recipeId,
          body,
        ),
      });
    },
    {
      params: recipeIdParamsSchema,
      body: recipeConsumeBodySchema,
      response: recipeConsumeResultSchema,
      detail: { tags: ["Recipes"], summary: "Complete recipe and reduce inventory" },
    },
  );

function isRecipeConditionKey(value: string): value is RecipeConditionKey {
  return recipeConditionKeys.includes(value as RecipeConditionKey);
}
