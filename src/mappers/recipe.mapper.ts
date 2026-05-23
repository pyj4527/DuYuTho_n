import type { Recipe, RecipeConsumptionLog } from "../../generated/prisma/client";
import type {
  RecipeConsumptionLogDto,
  RecipeDto,
  RecipeIngredientDto,
  RecipeNutritionDto,
  RecipeStepDto,
} from "../domain/dto";
import { toRfc3339 } from "../lib/date";
import { getString, isRecord } from "../lib/json";

export function mapRecipe(recipe: Recipe, saved: boolean): RecipeDto {
  return {
    id: recipe.id,
    name: recipe.name,
    ingredients: parseIngredients(recipe.ingredients),
    saved,
    time: recipe.time,
    timeMinutes: recipe.timeMinutes ?? undefined,
    description: recipe.description ?? undefined,
    imageUrl: recipe.imageUrl ?? undefined,
    servings: recipe.servings ?? undefined,
    difficulty: parseDifficulty(recipe.difficulty),
    tags: recipe.tags,
    dietaryFlags: recipe.dietaryFlags,
    steps: parseSteps(recipe.steps),
    nutrition: parseNutrition(recipe.nutrition),
    createdAt: toRfc3339(recipe.createdAt),
    updatedAt: toRfc3339(recipe.updatedAt),
  };
}

export function mapConsumptionLog(log: RecipeConsumptionLog): RecipeConsumptionLogDto {
  return {
    id: log.id,
    recipeId: log.recipeId,
    recipeName: log.recipeName,
    consumedAt: toRfc3339(log.consumedAt),
    selectedIngredientIds: log.selectedIngredientIds,
    updatedItemIds: log.updatedItemIds,
    removedItemIds: log.removedItemIds,
  };
}

export function parseIngredients(value: unknown): RecipeIngredientDto[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const name = getString(item.name);
    if (!name) {
      return [];
    }

    return [{
      name,
      quantity: getString(item.quantity) ?? "적당량",
      avatar: getString(item.avatar) ?? "🍽️",
    }];
  });
}

function parseSteps(value: unknown): RecipeStepDto[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const steps = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const order = typeof item.order === "number" ? item.order : undefined;
    const description = getString(item.description);
    if (order === undefined || !description) {
      return [];
    }

    return [{
      order,
      description,
      durationMinutes: typeof item.durationMinutes === "number" ? item.durationMinutes : undefined,
    }];
  });

  return steps.length > 0 ? steps : undefined;
}

function parseNutrition(value: unknown): RecipeNutritionDto | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nutrition: RecipeNutritionDto = {};
  const keys = [
    "caloriesKcal",
    "proteinG",
    "carbsG",
    "fatG",
    "fiberG",
    "sodiumMg",
  ] as const;

  for (const key of keys) {
    const numberValue = value[key];
    if (typeof numberValue === "number") {
      nutrition[key] = numberValue;
    }
  }

  return Object.keys(nutrition).length > 0 ? nutrition : undefined;
}

function parseDifficulty(value: string | null): RecipeDto["difficulty"] {
  return value === "easy" || value === "medium" || value === "hard" ? value : undefined;
}
