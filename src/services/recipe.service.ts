import { Prisma } from "../../generated/prisma/client";
import { fallbackRecipes } from "../data/fallback-recipes";
import type {
  InventoryItemDto,
  PageDto,
  RecipeConditionKey,
  RecipeConsumeRequestDto,
  RecipeConsumeResultDto,
  RecipeDto,
  RecipeIngredientDto,
  RecipeIngredientMatchDto,
  RecipeListQuery,
  RecipeRecommendationDto,
  RecipeConsumptionLogDto,
} from "../domain/dto";
import { recipeConditionKeys } from "../domain/dto";
import { calculateDaysLeft, toRfc3339 } from "../lib/date";
import { parseQuantityNumberAndUnit, reduceQuantityByExplicitAmount, reduceQuantityLabel } from "../lib/quantity";
import { throwProblem } from "../lib/problem";
import { prisma } from "../lib/prisma";
import { mapInventoryItem } from "../mappers/inventory.mapper";
import { mapConsumptionLog, mapRecipe } from "../mappers/recipe.mapper";
import { ensureHousehold } from "./household.service";

const defaultLimit = 50;

export const recipeService = {
  async listRecipes(
    householdId: string,
    query: RecipeListQuery = {},
  ): Promise<PageDto<RecipeRecommendationDto>> {
    const catalog = await getCatalog(householdId);
    const activeItems = await getActiveInventoryDtos(householdId);
    const selectedIds = query.selectedIngredientIds?.length
      ? query.selectedIngredientIds
      : await getStoredSelectedIds(householdId);
    const selectedSet = new Set(selectedIds);
    const conditions = normalizeConditions(query.conditions);

    const filtered = catalog
      .filter((recipe) => query.mode === "saved" ? recipe.saved : true)
      .filter((recipe) => matchesRecipeQuery(recipe, query.q))
      .filter((recipe) => conditions.every((condition) => matchesCondition(recipe, condition, activeItems)));

    const recommendations = filtered
      .map((recipe) => buildRecommendation(recipe, activeItems, selectedSet, conditions))
      .sort((a, b) => {
        if (a.match.selectedCount !== b.match.selectedCount) {
          return b.match.selectedCount - a.match.selectedCount;
        }
        if (a.match.matchPercentage !== b.match.matchPercentage) {
          return b.match.matchPercentage - a.match.matchPercentage;
        }
        return a.recipe.name.localeCompare(b.recipe.name, "ko");
      })
      .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));

    const limit = normalizeLimit(query.limit);
    const startIndex = query.cursor
      ? Math.max(recommendations.findIndex((recipe) => recipe.recipe.id === query.cursor) + 1, 0)
      : 0;
    const pageItems = recommendations.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < recommendations.length;
    const last = pageItems.at(-1);

    return {
      data: pageItems,
      page: {
        limit,
        hasMore,
        nextCursor: hasMore && last ? last.recipe.id : null,
      },
    };
  },

  async getRecipe(
    householdId: string,
    recipeId: string,
    selectedIngredientIds: string[] = [],
  ): Promise<RecipeRecommendationDto> {
    const recipe = await findRecipeOrThrow(householdId, recipeId);
    const activeItems = await getActiveInventoryDtos(householdId);
    const selectedSet = new Set(selectedIngredientIds.length > 0
      ? selectedIngredientIds
      : await getStoredSelectedIds(householdId));

    return buildRecommendation(recipe, activeItems, selectedSet, []);
  },

  async setSaved(householdId: string, recipeId: string, saved: boolean): Promise<RecipeDto> {
    await ensureHousehold(householdId);
    const recipe = await findRecipeOrThrow(householdId, recipeId);
    await prisma.recipeSave.upsert({
      where: { householdId_recipeId: { householdId, recipeId } },
      create: { householdId, recipeId, saved },
      update: { saved },
    });

    const dbRecipe = await prisma.recipe.findFirst({ where: { householdId, id: recipeId } });
    if (dbRecipe) {
      await prisma.recipe.update({ where: { id: recipeId }, data: { saved } });
    }

    return {
      ...recipe,
      saved,
    };
  },

  async consumeRecipe(
    householdId: string,
    recipeId: string,
    input: RecipeConsumeRequestDto,
  ): Promise<RecipeConsumeResultDto> {
    await ensureHousehold(householdId);
    const recipe = await findRecipeOrThrow(householdId, recipeId);
    const consumedAt = parseConsumedAt(input.consumedAt);
    const strategy = input.strategy ?? "frontend_label_compat";
    const selectedIds = input.selectedIngredientIds ?? await getStoredSelectedIds(householdId);
    const selectedSet = new Set(selectedIds);
    const ingredientNames = recipe.ingredients.map((ingredient) => ingredient.name.toLowerCase());
    const explicitAmounts = new Map((input.explicitAmounts ?? []).map((amount) => [amount.itemId, amount.quantity]));

    return prisma.$transaction(async (tx) => {
      const activeItems = await tx.inventoryItem.findMany({
        where: { householdId, status: "active" },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      });
      const matchingItems = strategy === "explicit_amounts"
        ? activeItems.filter((item) => explicitAmounts.has(item.id))
        : activeItems.filter((item) => ingredientNames.some((ingredientName) => {
          const itemName = item.name.toLowerCase();
          return itemName.includes(ingredientName) || ingredientName.includes(itemName);
        }));

      const updatedItems: InventoryItemDto[] = [];
      const removedItemIds: string[] = [];
      const needsReview: RecipeConsumeResultDto["needsReview"] = [];
      const matchedIds = new Set<string>();

      for (const item of matchingItems) {
        matchedIds.add(item.id);
        const explicitQuantity = explicitAmounts.get(item.id);
        const reduction = strategy === "explicit_amounts"
          ? explicitQuantity
            ? reduceQuantityByExplicitAmount(item.quantityLabel, explicitQuantity)
            : { kind: "needs_review" as const }
          : reduceQuantityLabel(item.quantityLabel);
        if (reduction.kind === "updated") {
          const parsedQuantity = parseQuantityNumberAndUnit(reduction.quantity);
          const updated = await tx.inventoryItem.update({
            where: { id: item.id },
            data: {
              quantityLabel: reduction.quantity,
              quantityAmount: parsedQuantity.amount,
              quantityUnit: parsedQuantity.unit,
              version: { increment: 1 },
            },
          });
          updatedItems.push(mapInventoryItem(updated));
        }
        if (reduction.kind === "removed") {
          await tx.inventoryItem.update({
            where: { id: item.id },
            data: {
              status: "consumed",
              consumedAt,
              version: { increment: 1 },
            },
          });
          removedItemIds.push(item.id);
        }
        if (reduction.kind === "needs_review") {
          needsReview.push({ itemId: item.id, reason: "ambiguous_quantity" });
        }
      }

      if (strategy === "explicit_amounts") {
        for (const itemId of explicitAmounts.keys()) {
          if (!matchedIds.has(itemId)) {
            needsReview.push({ itemId, reason: "not_matched" });
          }
        }
      }

      const removedSet = new Set(removedItemIds);
      const nextSelectedIds = selectedIds.filter((id) => !removedSet.has(id));
      await tx.inventorySelection.upsert({
        where: { householdId },
        create: { householdId, selectedIngredientIds: nextSelectedIds },
        update: { selectedIngredientIds: { set: nextSelectedIds } },
      });

      const log = await tx.recipeConsumptionLog.create({
        data: {
          householdId,
          recipeId,
          recipeName: recipe.name,
          consumedAt,
          selectedIngredientIds: Array.from(selectedSet),
          updatedItemIds: updatedItems.map((item) => item.id),
          removedItemIds,
        },
      });

      return {
        recipeId,
        consumedAt: toRfc3339(consumedAt),
        updatedItems,
        removedItemIds,
        selectedIngredientIds: nextSelectedIds,
        consumptionLogId: log.id,
        needsReview: needsReview.length > 0 ? needsReview : undefined,
      };
    });
  },

  async listConsumptionLogs(
    householdId: string,
    cursor: string | undefined,
    limitInput: number | undefined,
  ): Promise<PageDto<RecipeConsumptionLogDto>> {
    const limit = normalizeLimit(limitInput);
    const logs = await prisma.recipeConsumptionLog.findMany({
      where: { householdId },
      orderBy: [{ consumedAt: "desc" }, { id: "asc" }],
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: limit + 1,
    });
    const hasMore = logs.length > limit;
    const pageLogs = hasMore ? logs.slice(0, limit) : logs;
    const last = pageLogs.at(-1);

    return {
      data: pageLogs.map(mapConsumptionLog),
      page: {
        limit,
        hasMore,
        nextCursor: hasMore && last ? last.id : null,
      },
    };
  },
};

async function getCatalog(householdId: string): Promise<RecipeDto[]> {
  await ensureHousehold(householdId);
  const [dbRecipes, saves] = await Promise.all([
    prisma.recipe.findMany({ where: { householdId, deletedAt: null }, orderBy: [{ createdAt: "asc" }] }),
    prisma.recipeSave.findMany({ where: { householdId } }),
  ]);
  const saveMap = new Map(saves.map((save) => [save.recipeId, save.saved]));
  const catalog = new Map<string, RecipeDto>();

  for (const fallback of fallbackRecipes) {
    catalog.set(fallback.id, {
      ...fallback,
      saved: saveMap.get(fallback.id) ?? fallback.saved,
    });
  }
  for (const recipe of dbRecipes) {
    catalog.set(recipe.id, mapRecipe(recipe, saveMap.get(recipe.id) ?? recipe.saved));
  }

  return Array.from(catalog.values());
}

async function findRecipeOrThrow(householdId: string, recipeId: string): Promise<RecipeDto> {
  const recipe = (await getCatalog(householdId)).find((candidate) => candidate.id === recipeId);
  if (!recipe) {
    throwProblem({ status: 404, title: "Not found", detail: "Recipe not found" });
  }
  return recipe;
}

async function getActiveInventoryDtos(householdId: string): Promise<InventoryItemDto[]> {
  const items = await prisma.inventoryItem.findMany({
    where: { householdId, status: "active" },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
  });

  return items.map(mapInventoryItem);
}

async function getStoredSelectedIds(householdId: string): Promise<string[]> {
  const selection = await prisma.inventorySelection.findUnique({ where: { householdId } });
  return selection?.selectedIngredientIds ?? [];
}

function buildRecommendation(
  recipe: RecipeDto,
  items: InventoryItemDto[],
  selectedSet: Set<string>,
  conditions: RecipeConditionKey[],
): RecipeRecommendationDto {
  const ingredients = recipe.ingredients.map((ingredient) => matchIngredient(ingredient, items, selectedSet));
  const selectedCount = ingredients.filter((ingredient) => ingredient.status === "selected").length;
  const ownedCount = ingredients.filter((ingredient) => ingredient.status === "owned").length;
  const totalCount = recipe.ingredients.length;
  const matchPercentage = totalCount === 0 ? 0 : Math.round(((selectedCount + ownedCount) / totalCount) * 100);
  const reasons = [
    selectedCount > 0 ? `선택한 식재료 ${selectedCount}개 포함` : undefined,
    ownedCount > 0 ? `보유 식재료 ${ownedCount}개 매칭` : undefined,
    conditions.includes("prioritize_expiring") ? "임박 식재료 우선 조건 반영" : undefined,
  ].filter((reason): reason is string => typeof reason === "string");

  return {
    recipe,
    match: {
      ingredients,
      selectedCount,
      ownedCount,
      totalCount,
      matchPercentage,
    },
    rank: 0,
    reasons,
  };
}

function matchIngredient(
  ingredient: RecipeIngredientDto,
  items: InventoryItemDto[],
  selectedSet: Set<string>,
): RecipeIngredientMatchDto {
  const ingredientName = ingredient.name.toLowerCase();
  const item = items.find((candidate) => {
    const itemName = candidate.name.toLowerCase();
    return itemName.includes(ingredientName) || ingredientName.includes(itemName);
  });

  if (!item) {
    return { ...ingredient, status: "missing", itemId: null };
  }

  return {
    ...ingredient,
    status: selectedSet.has(item.id) ? "selected" : "owned",
    itemId: item.id,
  };
}

function matchesRecipeQuery(recipe: RecipeDto, query: string | undefined): boolean {
  const trimmed = query?.trim().toLowerCase();
  if (!trimmed) {
    return true;
  }
  return recipe.name.toLowerCase().includes(trimmed) ||
    recipe.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(trimmed));
}

function matchesCondition(
  recipe: RecipeDto,
  condition: RecipeConditionKey,
  items: InventoryItemDto[],
): boolean {
  if (condition === "under_15_min") {
    return (recipe.timeMinutes ?? Number.parseInt(recipe.time, 10)) <= 15;
  }
  if (condition === "no_heat") {
    return recipe.tags?.some((tag) => tag === "no_heat" || tag === "simple" || tag === "salad") ?? false;
  }
  if (condition === "kid_friendly") {
    return recipe.tags?.some((tag) => tag === "kid_friendly" || tag === "mild") ?? false;
  }
  if (condition === "prioritize_expiring") {
    const soonItems = items.filter((item) => {
      const daysLeft = calculateDaysLeft(item.expiresAt);
      return daysLeft >= 0 && daysLeft <= 2;
    });
    return recipe.ingredients.some((ingredient) => soonItems.some((item) => {
      const itemName = item.name.toLowerCase();
      const ingredientName = ingredient.name.toLowerCase();
      return itemName.includes(ingredientName) || ingredientName.includes(itemName);
    }));
  }
  return true;
}

function normalizeConditions(values: string[] | undefined): RecipeConditionKey[] {
  if (!values) {
    return [];
  }
  return values.filter(isRecipeConditionKey);
}

function isRecipeConditionKey(value: string): value is RecipeConditionKey {
  return recipeConditionKeys.includes(value as RecipeConditionKey);
}

function normalizeLimit(value: number | undefined): number {
  return Math.min(Math.max(Math.trunc(value ?? defaultLimit), 1), 100);
}

function parseConsumedAt(value: string | undefined): Date {
  if (!value) {
    return new Date();
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throwProblem({ status: 422, title: "Validation error", detail: "consumedAt must be an RFC 3339 datetime" });
  }

  return date;
}

export function recipeToPrismaCreateInput(
  householdId: string,
  recipe: RecipeDto,
): Prisma.RecipeUncheckedCreateInput {
  return {
    householdId,
    name: recipe.name,
    ingredients: recipe.ingredients as Prisma.InputJsonValue,
    saved: recipe.saved,
    time: recipe.time,
    timeMinutes: recipe.timeMinutes,
    description: recipe.description,
    imageUrl: recipe.imageUrl,
    servings: recipe.servings,
    difficulty: recipe.difficulty,
    tags: recipe.tags ?? [],
    dietaryFlags: recipe.dietaryFlags ?? [],
    steps: recipe.steps as Prisma.InputJsonValue | undefined,
    nutrition: recipe.nutrition as Prisma.InputJsonValue | undefined,
    source: "migration",
  };
}
