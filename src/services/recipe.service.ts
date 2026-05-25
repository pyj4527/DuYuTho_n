import { Prisma, type HouseholdSettings } from "../../generated/prisma/client";
import { fallbackRecipes } from "../data/fallback-recipes";
import type {
  InventoryItemDto,
  PageDto,
  RecipeConditionKey,
  RecipeConsumeRequestDto,
  RecipeConsumeResultDto,
  RecipeDto,
  RecipeFeedbackDto,
  RecipeFeedbackRequestDto,
  RecipeIngredientDto,
  RecipeIngredientMatchDto,
  RecipeListQuery,
  RecipePreferenceDto,
  RecipePreferenceUpdateDto,
  RecipeRecommendationDto,
  RecipeConsumptionLogDto,
  RecipeStepDto,
} from "../domain/dto";
import { recipeConditionKeys } from "../domain/dto";
import { calculateDaysLeft, toRfc3339 } from "../lib/date";
import { parseQuantityNumberAndUnit, reduceQuantityByExplicitAmount, reduceQuantityLabel } from "../lib/quantity";
import { throwProblem } from "../lib/problem";
import { prisma } from "../lib/prisma";
import { mapInventoryItem } from "../mappers/inventory.mapper";
import { mapConsumptionLog, mapRecipe } from "../mappers/recipe.mapper";
import { ensureHousehold } from "./household.service";
import { recipeCrawlerService, type CrawledRecipeCandidate } from "./recipe-crawler.service";
import { createOpenAIJsonCompletion, parseOpenAIJsonObject } from "./openai.service";

const defaultLimit = 50;

export const recipeService = {
  async listRecipes(
    householdId: string,
    query: RecipeListQuery = {},
  ): Promise<PageDto<RecipeRecommendationDto>> {
    await ensureHousehold(householdId);
    const activeItems = await getActiveInventoryDtos(householdId);
    const selectedIds = query.selectedIngredientIds?.length
      ? query.selectedIngredientIds
      : await getStoredSelectedIds(householdId);
    const accessibleItems = getAccessibleRecipeInventoryItems(activeItems, selectedIds);
    const selectedSet = new Set(selectedIds);
    const conditions = normalizeConditions(query.conditions);
    if (query.mode !== "saved") {
      await maybeBackfillCrawledRecipes(householdId, accessibleItems, selectedIds, query);
    }
    let catalog = await getCatalog(householdId);
    let deterministicRecommendations = buildDeterministicRecommendations(
      catalog,
      query,
      accessibleItems,
      selectedSet,
      conditions,
    );
    if (query.mode !== "saved" && accessibleItems.length > 0 && deterministicRecommendations.length === 0) {
      await maybeBackfillInventoryGeneratedRecipes(householdId, accessibleItems, conditions);
      catalog = await getCatalog(householdId);
      deterministicRecommendations = buildDeterministicRecommendations(
        catalog,
        query,
        accessibleItems,
        selectedSet,
        conditions,
      );
    }
    const preferenceSettings = await getRecipePreferenceSettings(householdId);
    const recentMeals = await getRecentRecipeConsumptionLogs(householdId, 20);
    const personalizedRecommendations = personalizeRecipeRecommendations(
      deterministicRecommendations,
      accessibleItems,
      preferenceSettings,
      recentMeals,
    );
    const recommendations = personalizeRecipeRecommendations(
      await rerankRecommendationsWithOpenAI(
        personalizedRecommendations,
        accessibleItems,
        conditions,
      ),
      accessibleItems,
      preferenceSettings,
      recentMeals,
    );

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

  async listPersonalizedRecommendations(
    householdId: string,
    query: RecipeListQuery = {},
  ): Promise<PageDto<RecipeRecommendationDto>> {
    return this.listRecipes(householdId, query);
  },

  async getRecipe(
    householdId: string,
    recipeId: string,
    selectedIngredientIds: string[] = [],
  ): Promise<RecipeRecommendationDto> {
    const recipe = await findRecipeOrThrow(householdId, recipeId);
    const activeItems = await getActiveInventoryDtos(householdId);
    const selectedIds = selectedIngredientIds.length > 0
      ? selectedIngredientIds
      : await getStoredSelectedIds(householdId);
    const selectedSet = new Set(selectedIds);
    const accessibleItems = getAccessibleRecipeInventoryItems(activeItems, selectedIds);

    return buildRecommendation(recipe, accessibleItems, selectedSet, []);
  },

  async importRecipeFromUrl(
    householdId: string,
    url: string,
    selectedIngredientIds: string[] = [],
  ): Promise<RecipeRecommendationDto> {
    await ensureHousehold(householdId);
    const recipe = await importCrawledRecipe(householdId, url);
    const activeItems = await getActiveInventoryDtos(householdId);
    const selectedIds = selectedIngredientIds.length > 0
      ? selectedIngredientIds
      : await getStoredSelectedIds(householdId);
    const selectedSet = new Set(selectedIds);
    const accessibleItems = getAccessibleRecipeInventoryItems(activeItems, selectedIds);

    return buildRecommendation(recipe, accessibleItems, selectedSet, []);
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

  async getRecipePreferences(householdId: string): Promise<RecipePreferenceDto> {
    const household = await ensureHousehold(householdId);
    const recentMeals = await getRecentRecipeConsumptionLogs(householdId, 10);

    return recipePreferenceFromSettings(household.settings, recentMeals);
  },

  async updateRecipePreferences(
    householdId: string,
    input: RecipePreferenceUpdateDto,
  ): Promise<RecipePreferenceDto> {
    await ensureHousehold(householdId);
    const data: Prisma.HouseholdSettingsUpdateInput = {};

    if (input.excludedIngredients !== undefined) {
      data.excludedIngredients = normalizePreferenceTerms(input.excludedIngredients);
    }
    if (input.dislikedFoods !== undefined) {
      data.dislikedFoods = normalizePreferenceTerms(input.dislikedFoods);
    }
    if (input.allergies !== undefined) {
      data.allergies = normalizePreferenceTerms(input.allergies);
    }
    if (input.preferredCookTimeMinutes !== undefined) {
      data.preferredCookTimeMinutes = input.preferredCookTimeMinutes === null
        ? null
        : normalizePreferredCookTime(input.preferredCookTimeMinutes);
    }
    if (input.mildFlavorPreferred !== undefined) {
      data.mildFlavorPreferred = input.mildFlavorPreferred;
    }

    if (Object.keys(data).length > 0) {
      await prisma.householdSettings.update({ where: { householdId }, data });
    }

    return this.getRecipePreferences(householdId);
  },

  async recordFeedback(
    householdId: string,
    recipeId: string,
    input: RecipeFeedbackRequestDto,
  ): Promise<RecipeFeedbackDto> {
    await ensureHousehold(householdId);
    const recipe = await findRecipeOrThrow(householdId, recipeId);

    if (input.action === "cooked") {
      await prisma.recipeConsumptionLog.create({
        data: {
          householdId,
          recipeId,
          recipeName: recipe.name,
          consumedAt: new Date(),
          selectedIngredientIds: await getStoredSelectedIds(householdId),
          updatedItemIds: [],
          removedItemIds: [],
        },
      });
    }

    if (input.action === "disliked") {
      const settings = await prisma.householdSettings.findUnique({ where: { householdId } });
      if (!settings) {
        throwProblem({ status: 404, title: "Not found", detail: "Household settings not found" });
      }
      const nextDislikedFoods = normalizePreferenceTerms([
        ...settings.dislikedFoods,
        ...(input.ingredientNames?.length ? input.ingredientNames : [recipe.name]),
      ]);
      await prisma.householdSettings.update({
        where: { householdId },
        data: { dislikedFoods: nextDislikedFoods },
      });

      return {
        accepted: true,
        recipeId,
        action: input.action,
        updatedPreferences: await this.getRecipePreferences(householdId),
      };
    }

    return {
      accepted: true,
      recipeId,
      action: input.action,
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

export function getAccessibleRecipeInventoryItems(
  activeItems: InventoryItemDto[],
  selectedIngredientIds: string[],
): InventoryItemDto[] {
  if (selectedIngredientIds.length === 0) {
    return activeItems;
  }

  const selectedSet = new Set(selectedIngredientIds);
  return activeItems.filter((item) => selectedSet.has(item.id));
}

type RecipePreferenceSettings = Pick<
  RecipePreferenceDto,
  "excludedIngredients" | "dislikedFoods" | "allergies" | "preferredCookTimeMinutes" | "mildFlavorPreferred"
>;

export function personalizeRecipeRecommendations(
  recommendations: RecipeRecommendationDto[],
  inventoryItems: InventoryItemDto[],
  preferences: RecipePreferenceSettings,
  recentMeals: RecipeConsumptionLogDto[] = [],
): RecipeRecommendationDto[] {
  const blockedTerms = normalizePreferenceTerms([
    ...preferences.excludedIngredients,
    ...preferences.allergies,
    ...preferences.dislikedFoods,
  ]);
  const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
  const recentRecipeNames = recentMeals.map((meal) => normalizePreferenceTerm(meal.recipeName));

  return recommendations
    .filter((recommendation) => !recommendationContainsBlockedTerm(recommendation, blockedTerms))
    .map((recommendation) => {
      const expiringMatches = recommendation.match.ingredients.filter((ingredient) => {
        if (!ingredient.itemId) return false;
        const item = itemById.get(ingredient.itemId);
        if (!item) return false;
        const daysLeft = calculateDaysLeft(item.expiresAt);
        return daysLeft <= 2;
      }).length;
      const timeMinutes = recommendation.recipe.timeMinutes ?? Number.parseInt(recommendation.recipe.time, 10);
      const preferredTime = preferences.preferredCookTimeMinutes;
      const normalizedRecipeName = normalizePreferenceTerm(recommendation.recipe.name);
      const wasRecentlyCooked = recentRecipeNames.includes(normalizedRecipeName);
      const mildMatch = preferences.mildFlavorPreferred
        ? recommendation.recipe.tags?.some((tag) => ["kid_friendly", "mild", "no_heat", "simple"].includes(tag)) ?? false
        : false;
      const reasons = [
        ...recommendation.reasons,
        expiringMatches > 0 ? `임박 재료 ${expiringMatches}개 우선 사용` : undefined,
        preferredTime !== undefined && Number.isFinite(timeMinutes) && timeMinutes <= preferredTime
          ? `선호 조리시간 ${preferredTime}분 이내`
          : undefined,
        mildMatch ? "순한 맛 선호 반영" : undefined,
        wasRecentlyCooked ? "최근 먹은 메뉴라 뒤로 배치" : undefined,
      ].filter((reason): reason is string => typeof reason === "string");

      const score = buildPersonalizedRecipeScore({
        recommendation,
        expiringMatches,
        timeMinutes,
        preferredTime,
        mildMatch,
        wasRecentlyCooked,
      });

      return {
        recommendation: {
          ...recommendation,
          reasons: Array.from(new Set(reasons)),
        },
        score,
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.recommendation.rank - right.recommendation.rank;
    })
    .map(({ recommendation }, index) => ({ ...recommendation, rank: index + 1 }));
}

function buildPersonalizedRecipeScore(input: {
  recommendation: RecipeRecommendationDto;
  expiringMatches: number;
  timeMinutes: number;
  preferredTime?: number;
  mildMatch: boolean;
  wasRecentlyCooked: boolean;
}): number {
  const { recommendation, expiringMatches, timeMinutes, preferredTime, mildMatch, wasRecentlyCooked } = input;
  let score = recommendation.match.selectedCount * 120 +
    recommendation.match.ownedCount * 60 +
    recommendation.match.matchPercentage;

  score += expiringMatches * 90;
  if (preferredTime !== undefined && Number.isFinite(timeMinutes)) {
    score += timeMinutes <= preferredTime ? 25 : -Math.min(70, timeMinutes - preferredTime);
  }
  if (mildMatch) {
    score += 15;
  }
  if (wasRecentlyCooked) {
    score -= 80;
  }

  return score;
}

function recommendationContainsBlockedTerm(
  recommendation: RecipeRecommendationDto,
  blockedTerms: string[],
): boolean {
  if (blockedTerms.length === 0) {
    return false;
  }

  const names = [
    recommendation.recipe.name,
    ...recommendation.recipe.ingredients.map((ingredient) => ingredient.name),
  ].map(normalizePreferenceTerm);

  return names.some((name) => blockedTerms.some((term) => (
    name.includes(term) || term.includes(name)
  )));
}

async function getRecipePreferenceSettings(householdId: string): Promise<RecipePreferenceSettings> {
  const household = await ensureHousehold(householdId);
  return recipePreferenceSettingsFromSettings(household.settings);
}

async function getRecentRecipeConsumptionLogs(
  householdId: string,
  take: number,
): Promise<RecipeConsumptionLogDto[]> {
  const logs = await prisma.recipeConsumptionLog.findMany({
    where: { householdId },
    orderBy: [{ consumedAt: "desc" }, { id: "asc" }],
    take,
  });

  return logs.map(mapConsumptionLog);
}

function recipePreferenceFromSettings(
  settings: HouseholdSettings,
  recentMeals: RecipeConsumptionLogDto[],
): RecipePreferenceDto {
  return {
    excludedIngredients: settings.excludedIngredients,
    dislikedFoods: settings.dislikedFoods,
    allergies: settings.allergies,
    preferredCookTimeMinutes: settings.preferredCookTimeMinutes ?? undefined,
    mildFlavorPreferred: settings.mildFlavorPreferred ?? undefined,
    recentMeals,
  };
}

function recipePreferenceSettingsFromSettings(settings: HouseholdSettings): RecipePreferenceSettings {
  return {
    excludedIngredients: settings.excludedIngredients,
    dislikedFoods: settings.dislikedFoods,
    allergies: settings.allergies,
    preferredCookTimeMinutes: settings.preferredCookTimeMinutes ?? undefined,
    mildFlavorPreferred: settings.mildFlavorPreferred ?? undefined,
  };
}

function normalizePreferenceTerms(values: string[]): string[] {
  return Array.from(
    new Set(values.map(normalizePreferenceTerm).filter((value) => value.length > 0)),
  ).slice(0, 50);
}

function normalizePreferenceTerm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePreferredCookTime(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 5), 240);
}

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

async function importCrawledRecipe(householdId: string, url: string): Promise<RecipeDto> {
  const crawled = await recipeCrawlerService.crawlAndNormalize(url);
  const source = buildCrawledSource(crawled.sourceUrl);
  const existing = await prisma.recipe.findFirst({
    where: { householdId, source, deletedAt: null },
  });
  const saved = await getSavedState(householdId, existing?.id);

  if (existing) {
    return mapRecipe(existing, saved ?? existing.saved);
  }

  const recipe = crawledRecipeToDto(crawled, false);
  const created = await prisma.recipe.create({
    data: {
      ...recipeToPrismaCreateInput(householdId, recipe),
      source,
      tags: Array.from(new Set([...(recipe.tags ?? []), "web_crawled"])),
    },
  });

  return mapRecipe(created, false);
}

async function getSavedState(householdId: string, recipeId: string | undefined): Promise<boolean | undefined> {
  if (!recipeId) {
    return undefined;
  }
  const save = await prisma.recipeSave.findUnique({
    where: { householdId_recipeId: { householdId, recipeId } },
  });
  return save?.saved;
}

function crawledRecipeToDto(crawled: CrawledRecipeCandidate, saved: boolean): RecipeDto {
  return {
    id: `web_${hashString(crawled.sourceUrl)}`,
    name: crawled.name,
    ingredients: crawled.ingredients,
    saved,
    time: crawled.time,
    timeMinutes: crawled.timeMinutes,
    description: crawled.description,
    imageUrl: crawled.imageUrl,
    servings: crawled.servings,
    difficulty: crawled.difficulty,
    tags: crawled.tags,
    dietaryFlags: crawled.dietaryFlags,
    steps: crawled.steps,
    nutrition: crawled.nutrition,
  };
}

async function maybeBackfillCrawledRecipes(
  householdId: string,
  activeItems: InventoryItemDto[],
  selectedIds: string[],
  query: RecipeListQuery,
): Promise<void> {
  if (process.env.RECIPE_AUTO_CRAWL_ENABLED === "false") {
    return;
  }

  const targetCount = Number(process.env.RECIPE_AUTO_CRAWL_TARGET_COUNT ?? 6);
  const existingCount = await prisma.recipe.count({
    where: { householdId, deletedAt: null, source: { startsWith: "crawled:" } },
  });
  if (existingCount >= targetCount) {
    return;
  }

  const selectedSet = new Set(selectedIds);
  const searchTerms = buildRecipeSearchTerms(activeItems, selectedSet, query).slice(0, 2);
  const maxImports = Math.max(0, targetCount - existingCount);
  let imported = 0;

  for (const term of searchTerms) {
    if (imported >= maxImports) break;
    const urls = await recipeCrawlerService.discoverRecipeUrls(term, 4).catch(() => []);
    for (const url of urls) {
      if (imported >= maxImports) break;
      const alreadyExists = await prisma.recipe.findFirst({
        where: { householdId, source: buildCrawledSource(url), deletedAt: null },
        select: { id: true },
      });
      if (alreadyExists) {
        continue;
      }
      try {
        await importCrawledRecipe(householdId, url);
        imported += 1;
      } catch {
        continue;
      }
    }
  }
}

function buildRecipeSearchTerms(
  activeItems: InventoryItemDto[],
  selectedSet: Set<string>,
  query: RecipeListQuery,
): string[] {
  const explicitQuery = query.q?.trim();
  const selectedNames = activeItems
    .filter((item) => selectedSet.has(item.id))
    .map((item) => item.name);
  const expiringNames = activeItems
    .filter((item) => {
      const daysLeft = calculateDaysLeft(item.expiresAt);
      return daysLeft >= 0 && daysLeft <= 3;
    })
    .map((item) => item.name);
  const stockedNames = activeItems.map((item) => item.name);

  return Array.from(new Set([
    explicitQuery,
    ...selectedNames,
    ...expiringNames,
    ...stockedNames,
  ].filter((term): term is string => typeof term === "string" && term.trim().length > 0)))
    .slice(0, 5);
}

function buildCrawledSource(url: string): string {
  return `crawled:${normalizeCrawledUrl(url)}`;
}

function normalizeCrawledUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.searchParams.sort();
  return parsed.toString();
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
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

function buildDeterministicRecommendations(
  catalog: RecipeDto[],
  query: RecipeListQuery,
  activeItems: InventoryItemDto[],
  selectedSet: Set<string>,
  conditions: RecipeConditionKey[],
): RecipeRecommendationDto[] {
  return catalog
    .filter((recipe) => query.mode === "saved" ? recipe.saved : true)
    .filter((recipe) => matchesRecipeQuery(recipe, query.q))
    .filter((recipe) => conditions.every((condition) => matchesCondition(recipe, condition, activeItems)))
    .map((recipe) => buildRecommendation(recipe, activeItems, selectedSet, conditions))
    .filter((recommendation) => (
      query.mode === "saved" ||
      recommendation.match.selectedCount + recommendation.match.ownedCount > 0
    ))
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
}

async function maybeBackfillInventoryGeneratedRecipes(
  householdId: string,
  activeItems: InventoryItemDto[],
  conditions: RecipeConditionKey[],
): Promise<void> {
  if (process.env.RECIPE_GENERATED_FALLBACK_ENABLED === "false") {
    return;
  }

  const usableItems = activeItems.filter(isUsableRecipeInventoryItem).slice(0, 8);
  if (usableItems.length === 0) {
    return;
  }

  const aiRecipes = await generateInventoryRecipesWithOpenAI(usableItems, conditions);
  const recipes = aiRecipes.length > 0
    ? aiRecipes
    : buildDeterministicInventoryRecipes(usableItems);

  for (const [index, recipe] of recipes.slice(0, 3).entries()) {
    if (!recipeUsesInventoryIngredient(recipe, usableItems)) {
      continue;
    }

    const source = buildInventoryGeneratedSource(recipe, usableItems, index);
    const existing = await prisma.recipe.findFirst({
      where: { householdId, source, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      continue;
    }

    await prisma.recipe.create({
      data: {
        ...recipeToPrismaCreateInput(householdId, recipe),
        source,
        tags: Array.from(new Set([...(recipe.tags ?? []), "inventory_generated"])),
      },
    });
  }
}

const nonRecipeIngredientTerms = [
  "사람",
  "얼굴",
  "셀카",
  "손",
  "person",
  "face",
  "selfie",
  "human",
  "object",
  "plate",
  "bowl",
  "table",
];

const pantryIngredients = [
  { name: "밥", quantity: "1공기", avatar: "rice_bowl" },
  { name: "간장", quantity: "1큰술", avatar: "soup_kitchen" },
  { name: "올리브유", quantity: "1큰술", avatar: "soup_kitchen" },
  { name: "마늘", quantity: "1작은술", avatar: "eco" },
];

async function generateInventoryRecipesWithOpenAI(
  items: InventoryItemDto[],
  conditions: RecipeConditionKey[],
): Promise<RecipeDto[]> {
  try {
    const completion = await createOpenAIJsonCompletion({
      maxTokens: 2000,
      messages: [
        {
          role: "system",
          content:
            "You create practical Korean home-cooking recipe recommendations for an inventory app. Each recipe must use at least one provided edible inventory item exactly by name. You may add only common pantry staples such as rice, salt, soy sauce, oil, garlic, pepper, sugar, vinegar, water, or gochujang. Never include people, faces, selfies, tableware, appliances, or non-food objects as ingredients. Return JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            inventory: items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              expiresAt: item.expiresAt,
              location: item.location,
            })),
            conditions,
            outputShape: {
              recipes: [{
                name: "Korean recipe name",
                ingredients: [{ name: "must include inventory item exact name", quantity: "amount" }],
                timeMinutes: 15,
                description: "short Korean description",
                tags: ["simple"],
                steps: [{ order: 1, description: "Korean step", durationMinutes: 5 }],
              }],
            },
          }),
        },
      ],
    });
    if (!completion) {
      return [];
    }

    const parsed = parseOpenAIJsonObject(completion.content);
    const values = Array.isArray(parsed?.recipes) ? parsed.recipes : [];
    return values
      .flatMap((value, index) => {
        const recipe = parseGeneratedRecipe(value, index);
        return recipe ? [recipe] : [];
      })
      .filter((recipe) => recipeUsesInventoryIngredient(recipe, items));
  } catch {
    return [];
  }
}

function buildDeterministicInventoryRecipes(items: InventoryItemDto[]): RecipeDto[] {
  return items.slice(0, 3).map((item, index) => {
    const mainIngredient = {
      name: item.name,
      quantity: item.quantity || "적당량",
      avatar: "restaurant",
    };
    const isFishOrMeat = /연어|생선|참치|고기|소고기|돼지|닭|chicken|salmon|fish|beef|pork/iu.test(item.name);
    const name = isFishOrMeat ? `${item.name} 간장 덮밥` : `${item.name} 소진 볶음`;
    const steps = isFishOrMeat
      ? [
        { order: 1, description: `${item.name}의 물기를 제거하고 먹기 좋은 크기로 준비합니다.`, durationMinutes: 3 },
        { order: 2, description: "팬에 기름을 두르고 재료를 익힌 뒤 간장과 마늘로 간합니다.", durationMinutes: 8 },
        { order: 3, description: "밥 위에 올려 남은 양념을 곁들입니다.", durationMinutes: 4 },
      ]
      : [
        { order: 1, description: `${item.name}을 먹기 좋은 크기로 손질합니다.`, durationMinutes: 4 },
        { order: 2, description: "팬에 기름과 마늘을 두르고 재료를 빠르게 볶습니다.", durationMinutes: 7 },
        { order: 3, description: "간장으로 간을 맞춰 바로 담아냅니다.", durationMinutes: 3 },
      ];

    return {
      id: `generated_${hashString(`${item.id}:${index}`)}`,
      name,
      ingredients: [
        mainIngredient,
        ...pantryIngredients.slice(0, isFishOrMeat ? 2 : 3),
      ],
      saved: false,
      time: isFishOrMeat ? "15분" : "14분",
      timeMinutes: isFishOrMeat ? 15 : 14,
      servings: 1,
      difficulty: "easy",
      tags: ["simple", "inventory_generated", isFishOrMeat ? "rice" : "stir_fry"],
      description: `보관 중인 ${item.name}을 우선 소진하는 빠른 추천 요리입니다.`,
      steps,
    };
  });
}

function parseGeneratedRecipe(value: unknown, index: number): RecipeDto | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = getString(value.name);
  if (!name) {
    return null;
  }

  const ingredients = Array.isArray(value.ingredients)
    ? value.ingredients.flatMap(parseGeneratedIngredient).slice(0, 12)
    : [];
  if (ingredients.length === 0) {
    return null;
  }

  const timeMinutes = normalizePositiveInteger(value.timeMinutes) ?? 15;
  const steps = Array.isArray(value.steps)
    ? value.steps.flatMap(parseGeneratedStep).slice(0, 10)
    : [];

  return {
    id: `generated_ai_${hashString(`${name}:${index}`)}`,
    name,
    ingredients,
    saved: false,
    time: `${timeMinutes}분`,
    timeMinutes,
    servings: normalizePositiveInteger(value.servings) ?? 1,
    difficulty: parseDifficulty(value.difficulty) ?? "easy",
    tags: Array.from(new Set(["inventory_generated", ...getStringArray(value.tags)])),
    description: getString(value.description),
    steps,
  };
}

function parseGeneratedIngredient(value: unknown): RecipeIngredientDto[] {
  if (!isRecord(value)) {
    return [];
  }
  const name = getString(value.name);
  if (!name || isBlockedRecipeIngredientName(name)) {
    return [];
  }
  return [{
    name,
    quantity: getString(value.quantity) ?? "적당량",
    avatar: "restaurant",
  }];
}

function parseGeneratedStep(value: unknown): RecipeStepDto[] {
  if (!isRecord(value)) {
    return [];
  }
  const description = getString(value.description);
  if (!description) {
    return [];
  }
  return [{
    order: normalizePositiveInteger(value.order) ?? 1,
    description,
    durationMinutes: normalizePositiveInteger(value.durationMinutes),
  }];
}

function isUsableRecipeInventoryItem(item: InventoryItemDto): boolean {
  return !isBlockedRecipeIngredientName(item.name);
}

function isBlockedRecipeIngredientName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.length === 0 ||
    nonRecipeIngredientTerms.some((term) => normalized.includes(term));
}

function recipeUsesInventoryIngredient(recipe: RecipeDto, items: InventoryItemDto[]): boolean {
  return recipe.ingredients.some((ingredient) => items.some((item) => {
    const ingredientName = ingredient.name.toLowerCase();
    const itemName = item.name.toLowerCase();
    return ingredientName.includes(itemName) || itemName.includes(ingredientName);
  }));
}

function buildInventoryGeneratedSource(
  recipe: RecipeDto,
  items: InventoryItemDto[],
  index: number,
): string {
  const itemKey = items.map((item) => item.name.trim().toLowerCase()).sort().join("|");
  return `generated-inventory:${hashString(`${itemKey}:${recipe.name}:${index}`)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function parseDifficulty(value: unknown): RecipeDto["difficulty"] | undefined {
  return value === "easy" || value === "medium" || value === "hard" ? value : undefined;
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

async function rerankRecommendationsWithOpenAI(
  recommendations: RecipeRecommendationDto[],
  items: InventoryItemDto[],
  conditions: RecipeConditionKey[],
): Promise<RecipeRecommendationDto[]> {
  if (
    process.env.RECIPE_AI_RERANK_ENABLED === "false" ||
    recommendations.length <= 1
  ) {
    return recommendations.map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
  }

  try {
    const candidates = recommendations.slice(0, Number(process.env.RECIPE_AI_RERANK_MAX_CANDIDATES ?? 20));
    const completion = await createOpenAIJsonCompletion({
      maxTokens: 1600,
      messages: [
        {
          role: "system",
          content:
            "You rerank real/crawled recipes for a Korean household inventory app. Prefer selected and expiring ingredients, fewer missing ingredients, shorter requested time, and allergy/dislike exclusions already filtered by backend. Return JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            inventory: items.map((item) => ({
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              expiresAt: item.expiresAt,
              location: item.location,
            })).slice(0, 60),
            conditions,
            candidates: candidates.map((recommendation) => ({
              id: recommendation.recipe.id,
              name: recommendation.recipe.name,
              timeMinutes: recommendation.recipe.timeMinutes,
              tags: recommendation.recipe.tags ?? [],
              ingredients: recommendation.match.ingredients.map((ingredient) => ({
                name: ingredient.name,
                status: ingredient.status,
              })),
              matchPercentage: recommendation.match.matchPercentage,
              selectedCount: recommendation.match.selectedCount,
              ownedCount: recommendation.match.ownedCount,
            })),
            outputShape: {
              ranked: [{ id: "recipe id", reason: "short Korean reason grounded in inventory match" }],
            },
          }),
        },
      ],
    });
    if (!completion) {
      return recommendations.map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
    }

    const parsed = parseOpenAIJsonObject(completion.content);
    const ranked = Array.isArray(parsed?.ranked) ? parsed.ranked.filter(isRankedRecipeRecord) : [];
    if (ranked.length === 0) {
      return recommendations.map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
    }

    const order = new Map(ranked.map((item, index) => [item.id, index]));
    const aiReasons = new Map(ranked.map((item) => [item.id, item.reason]));
    return recommendations
      .map((recommendation, originalIndex) => ({ recommendation, originalIndex }))
      .sort((left, right) => {
        const leftOrder = order.get(left.recommendation.recipe.id);
        const rightOrder = order.get(right.recommendation.recipe.id);
        if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
        if (leftOrder !== undefined) return -1;
        if (rightOrder !== undefined) return 1;
        return left.originalIndex - right.originalIndex;
      })
      .map(({ recommendation }, index) => {
        const reason = aiReasons.get(recommendation.recipe.id);
        return {
          ...recommendation,
          rank: index + 1,
          reasons: reason ? [reason, ...recommendation.reasons] : recommendation.reasons,
        };
      });
  } catch {
    return recommendations.map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
  }
}

function isRankedRecipeRecord(value: unknown): value is { id: string; reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.reason === "string";
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
