import { Prisma } from "../../generated/prisma/client";
import type {
  PrototypeImportRequestDto,
  PrototypeImportResultDto,
  RecipeDto,
  SyncPullRequestDto,
  SyncPullResponseDto,
} from "../domain/dto";
import { isIsoLocalDateString } from "../lib/date";
import { prisma } from "../lib/prisma";
import { throwProblem } from "../lib/problem";
import { mapInventoryItem } from "../mappers/inventory.mapper";
import { mapRecipe } from "../mappers/recipe.mapper";
import { inventoryService } from "./inventory.service";
import { recipeToPrismaCreateInput } from "./recipe.service";
import { ensureHousehold } from "./household.service";

export const syncService = {
  async importPrototypeState(
    householdId: string,
    input: PrototypeImportRequestDto,
  ): Promise<PrototypeImportResultDto> {
    await ensureHousehold(householdId);
    const clientGeneratedAt = new Date(input.clientGeneratedAt);
    if (Number.isNaN(clientGeneratedAt.getTime())) {
      throwProblem({ status: 422, title: "Validation error", detail: "clientGeneratedAt must be an RFC 3339 datetime" });
    }

    const skipped: PrototypeImportResultDto["skipped"] = [];
    const idMap: PrototypeImportResultDto["idMap"] = { items: {}, recipes: {} };
    const existingItemsCount = await prisma.inventoryItem.count({ where: { householdId, status: "active" } });
    const shouldImport = input.strategy !== "dry_run" && (input.strategy !== "replace_if_empty" || existingItemsCount === 0);

    if (!shouldImport && input.strategy === "replace_if_empty" && existingItemsCount > 0) {
      for (const item of input.state.items) {
        skipped.push({ type: "item", clientId: item.id, reason: "household_inventory_not_empty" });
      }
    }

    let importedItems = 0;
    if (shouldImport) {
      for (const item of input.state.items) {
        if (!isIsoLocalDateString(item.expiresAt)) {
          skipped.push({ type: "item", clientId: item.id, reason: "invalid_expiresAt" });
          continue;
        }
        const created = await inventoryService.createItem(householdId, {
          name: item.name,
          quantity: item.quantity,
          location: item.location,
          expiresAt: item.expiresAt,
          source: "migration",
          clientRequestId: item.id,
        });
        idMap.items[item.id] = created.id;
        importedItems += 1;
      }
    }

    let importedRecipes = 0;
    if (shouldImport) {
      for (const recipe of input.state.recipes) {
        const created = await prisma.recipe.create({
          data: recipeToPrismaCreateInput(householdId, recipe as RecipeDto),
        });
        idMap.recipes[recipe.id] = created.id;
        importedRecipes += 1;
      }
    }

    const mappedSelectionIds = input.state.selectedIngredientIds.flatMap((id) => {
      const mapped = idMap.items[id];
      return mapped ? [mapped] : [];
    });
    let importedSelections = 0;
    if (shouldImport && mappedSelectionIds.length > 0) {
      await prisma.inventorySelection.upsert({
        where: { householdId },
        create: { householdId, selectedIngredientIds: mappedSelectionIds },
        update: { selectedIngredientIds: { set: mappedSelectionIds } },
      });
      importedSelections = mappedSelectionIds.length;
    }

    const result: PrototypeImportResultDto = {
      imported: {
        items: importedItems,
        recipes: importedRecipes,
        selectedIngredientIds: importedSelections,
      },
      idMap,
      skipped,
    };

    if (input.strategy !== "dry_run") {
      await prisma.prototypeImport.create({
        data: {
          householdId,
          source: input.source,
          clientGeneratedAt,
          strategy: input.strategy,
          importedItems,
          importedRecipes,
          importedSelections,
          idMap: result.idMap as Prisma.InputJsonObject,
          skipped: result.skipped as Prisma.InputJsonValue,
        },
      });
    }

    return result;
  },

  async pull(householdId: string, input: SyncPullRequestDto): Promise<SyncPullResponseDto> {
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100);
    const since = input.since ? new Date(input.since) : undefined;
    if (input.since && (!since || Number.isNaN(since.getTime()))) {
      throwProblem({ status: 422, title: "Validation error", detail: "since must be an RFC 3339 datetime" });
    }

    const [items, deletedItems, dbRecipes, deletedRecipes, selection] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: {
          householdId,
          status: "active",
          updatedAt: since ? { gt: since } : undefined,
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        cursor: input.cursor ? { id: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0,
        take: limit + 1,
      }),
      prisma.inventoryItem.findMany({
        where: {
          householdId,
          status: { in: ["discarded", "consumed"] },
          updatedAt: since ? { gt: since } : undefined,
        },
        select: { id: true },
      }),
      prisma.recipe.findMany({ where: { householdId, deletedAt: null } }),
      prisma.recipe.findMany({
        where: {
          householdId,
          deletedAt: since ? { gt: since } : { not: null },
        },
        select: { id: true },
      }),
      prisma.inventorySelection.findUnique({ where: { householdId } }),
    ]);

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const last = pageItems.at(-1);

    return {
      items: pageItems.map(mapInventoryItem),
      recipes: dbRecipes.map((recipe) => mapRecipe(recipe, recipe.saved)),
      selectedIngredientIds: selection?.selectedIngredientIds ?? [],
      deletedIds: {
        items: deletedItems.map((item) => item.id),
        recipes: deletedRecipes.map((recipe) => recipe.id),
      },
      nextCursor: hasMore && last ? last.id : null,
      syncToken: new Date().toISOString(),
    };
  },
};
