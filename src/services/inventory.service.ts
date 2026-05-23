import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";
import type {
  DuplicateSuggestionDto,
  InventoryBatchCreateDto,
  InventoryBatchCreateResultDto,
  InventoryDiscardRequestDto,
  InventoryDiscardResultDto,
  InventoryItemCreateDto,
  InventoryItemDto,
  InventoryItemPatchDto,
  InventoryListQuery,
  InventorySelectionDto,
  InventorySelectionUpdateDto,
  PageDto,
} from "../domain/dto";
import { calculateDaysLeft, getRelativeDateString, isIsoLocalDateString, toRfc3339 } from "../lib/date";
import { parseQuantityNumberAndUnit } from "../lib/quantity";
import { mapInventoryItem } from "../mappers/inventory.mapper";
import { ensureHousehold } from "./household.service";
import { throwProblem } from "../lib/problem";

const defaultLimit = 50;
const maxLimit = 100;

export class InventoryItemNotFoundError extends Error {
  constructor() {
    super("Inventory item not found");
    this.name = "InventoryItemNotFoundError";
  }
}

export const inventoryService = {
  async listItems(householdId: string, query: InventoryListQuery = {}): Promise<PageDto<InventoryItemDto>> {
    const limit = normalizeLimit(query.limit);
    const where = buildInventoryWhere(householdId, query);
    const items = await prisma.inventoryItem.findMany({
      where,
      orderBy: buildOrderBy(query.sort, query.direction),
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const lastItem = pageItems.at(-1);

    return {
      data: pageItems.map(mapInventoryItem),
      page: {
        hasMore,
        limit,
        nextCursor: hasMore && lastItem ? lastItem.id : null,
      },
    };
  },

  async listActiveItems(householdId: string): Promise<InventoryItemDto[]> {
    const items = await prisma.inventoryItem.findMany({
      where: {
        householdId,
        status: "active",
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
    });

    return items.map(mapInventoryItem);
  },

  async getItem(householdId: string, itemId: string): Promise<InventoryItemDto> {
    return mapInventoryItem(await findInventoryItemOrThrow(householdId, itemId));
  },

  async createItem(householdId: string, input: InventoryItemCreateDto): Promise<InventoryItemDto> {
    await ensureHousehold(householdId);
    const normalized = normalizeCreateInput(input, "manual");

    const item = await prisma.inventoryItem.create({
      data: {
        householdId,
        ...normalized,
      },
    });

    return mapInventoryItem(item);
  },

  async createBatch(
    householdId: string,
    input: InventoryBatchCreateDto,
  ): Promise<InventoryBatchCreateResultDto> {
    await ensureHousehold(householdId);

    const existing = await prisma.inventoryItem.findMany({
      where: { householdId, status: "active" },
      select: { id: true, name: true },
    });
    const duplicateSuggestions = buildDuplicateSuggestions(input.items, existing);
    const created = await prisma.$transaction(
      input.items.map((item) => prisma.inventoryItem.create({
        data: {
          householdId,
          ...normalizeCreateInput(item, input.source),
          sourceAnalysisId: input.analysisId,
        },
      })),
    );

    const idMapEntries = input.items.flatMap((item, index) => {
      const createdItem = created[index];
      return item.clientRequestId && createdItem ? [[item.clientRequestId, createdItem.id] as const] : [];
    });

    return {
      items: created.map(mapInventoryItem),
      idMap: idMapEntries.length > 0 ? Object.fromEntries(idMapEntries) : undefined,
      duplicateSuggestions: duplicateSuggestions.length > 0 ? duplicateSuggestions : undefined,
    };
  },

  async updateItem(
    householdId: string,
    itemId: string,
    input: InventoryItemPatchDto,
  ): Promise<InventoryItemDto> {
    await findInventoryItemOrThrow(householdId, itemId);

    const data: Prisma.InventoryItemUncheckedUpdateInput = {
      version: { increment: 1 },
    };

    if (input.name !== undefined) {
      const name = normalizeName(input.name);
      data.name = name;
    }
    if (input.quantity !== undefined) {
      const quantity = normalizeQuantity(input.quantity);
      const parsed = parseQuantityNumberAndUnit(quantity);
      data.quantityLabel = quantity;
      data.quantityAmount = parsed.amount;
      data.quantityUnit = parsed.unit;
    }
    if (input.location !== undefined) {
      data.location = input.location;
    }
    if (input.expiresAt !== undefined) {
      data.expiresAt = normalizeExpiresAt(input.expiresAt);
    }
    if (input.memo !== undefined) {
      data.memo = input.memo === null ? null : input.memo.trim();
    }
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === "discarded") {
        data.discardedAt = new Date();
        data.deletedAt = new Date();
      }
      if (input.status === "consumed") {
        data.consumedAt = new Date();
      }
    }

    const item = await prisma.inventoryItem.update({
      where: { id: itemId },
      data,
    });

    return mapInventoryItem(item);
  },

  async discardItem(
    householdId: string,
    itemId: string,
    _input: InventoryDiscardRequestDto | undefined,
  ): Promise<InventoryDiscardResultDto> {
    await findInventoryItemOrThrow(householdId, itemId);
    const discardedAt = new Date();

    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: {
        status: "discarded",
        discardedAt,
        deletedAt: discardedAt,
        version: { increment: 1 },
      },
    });

    await removeIdsFromSelection(householdId, [itemId]);

    return {
      itemId,
      status: "discarded",
      discardedAt: toRfc3339(discardedAt),
    };
  },

  async getSelections(householdId: string): Promise<InventorySelectionDto> {
    await ensureHousehold(householdId);
    const selection = await prisma.inventorySelection.upsert({
      where: { householdId },
      create: { householdId },
      update: {},
    });

    return {
      selectedIngredientIds: selection.selectedIngredientIds,
      updatedAt: toRfc3339(selection.updatedAt),
    };
  },

  async updateSelections(
    householdId: string,
    input: InventorySelectionUpdateDto,
  ): Promise<InventorySelectionDto> {
    await ensureHousehold(householdId);
    const activeItems = await prisma.inventoryItem.findMany({
      where: { householdId, status: "active", id: { in: input.selectedIngredientIds } },
      select: { id: true },
    });
    const validIds = activeItems.map((item) => item.id);
    const selection = await prisma.inventorySelection.upsert({
      where: { householdId },
      create: { householdId, selectedIngredientIds: validIds },
      update: { selectedIngredientIds: { set: validIds } },
    });

    return {
      selectedIngredientIds: selection.selectedIngredientIds,
      updatedAt: toRfc3339(selection.updatedAt),
    };
  },

  async removeIdsFromSelection(householdId: string, itemIds: string[]): Promise<string[]> {
    return removeIdsFromSelection(householdId, itemIds);
  },
};

async function findInventoryItemOrThrow(householdId: string, itemId: string) {
  const item = await prisma.inventoryItem.findFirst({
    where: {
      id: itemId,
      householdId,
      status: { not: "discarded" },
    },
  });

  if (!item) {
    throw new InventoryItemNotFoundError();
  }

  return item;
}

function normalizeCreateInput(input: InventoryItemCreateDto, sourceFallback: string) {
  const name = normalizeName(input.name);
  const quantity = normalizeQuantity(input.quantity);
  const parsedQuantity = parseQuantityNumberAndUnit(quantity);

  return {
    name,
    quantityLabel: quantity,
    quantityAmount: parsedQuantity.amount,
    quantityUnit: parsedQuantity.unit,
    location: input.location,
    expiresAt: normalizeExpiresAt(input.expiresAt),
    source: input.source ?? sourceFallback,
    clientRequestId: input.clientRequestId,
    status: "active",
  };
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80) {
    throwProblem({ status: 422, title: "Validation error", detail: "name must be 1-80 characters" });
  }
  return name;
}

function normalizeQuantity(value: string): string {
  const quantity = value.trim();
  if (!quantity) {
    throwProblem({ status: 422, title: "Validation error", detail: "quantity is required" });
  }
  return quantity;
}

function normalizeExpiresAt(value: string): string {
  if (!isIsoLocalDateString(value)) {
    throwProblem({
      status: 422,
      title: "Validation error",
      detail: "expiresAt must be a valid YYYY-MM-DD calendar date",
      errors: [{ pointer: "#/expiresAt", detail: "Invalid YYYY-MM-DD date", code: "invalid_date" }],
    });
  }
  return value;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return defaultLimit;
  }
  return Math.min(Math.max(Math.trunc(value), 1), maxLimit);
}

function buildInventoryWhere(
  householdId: string,
  query: InventoryListQuery,
): Prisma.InventoryItemWhereInput {
  const where: Prisma.InventoryItemWhereInput = {
    householdId,
  };

  if (!query.includeDiscarded) {
    where.status = "active";
  }
  if (query.q?.trim()) {
    where.name = { contains: query.q.trim() };
  }
  if (query.location) {
    where.location = query.location;
  }
  if (query.expiry) {
    const today = getRelativeDateString(0);
    const soonBoundary = getRelativeDateString(2);
    if (query.expiry === "overdue") {
      where.expiresAt = { lt: today };
    }
    if (query.expiry === "soon") {
      where.expiresAt = { gte: today, lte: soonBoundary };
    }
    if (query.expiry === "safe") {
      where.expiresAt = { gt: soonBoundary };
    }
  }

  return where;
}

function buildOrderBy(
  sort: InventoryListQuery["sort"] = "expiresAt",
  direction: InventoryListQuery["direction"] = "asc",
): Prisma.InventoryItemOrderByWithRelationInput[] {
  if (sort === "createdAt") {
    return [{ createdAt: direction }, { id: "asc" }];
  }
  if (sort === "name") {
    return [{ name: direction }, { id: "asc" }];
  }
  return [{ expiresAt: direction }, { id: "asc" }];
}

function buildDuplicateSuggestions(
  candidates: InventoryItemCreateDto[],
  existing: Array<{ id: string; name: string }>,
): DuplicateSuggestionDto[] {
  return candidates.flatMap((candidate) => {
    const normalizedCandidateName = normalizeForDuplicate(candidate.name);
    const exact = existing.find((item) => normalizeForDuplicate(item.name) === normalizedCandidateName);
    return exact
      ? [{
        candidateName: candidate.name,
        existingItemId: exact.id,
        existingName: exact.name,
        reason: "same_normalized_name" as const,
        confidence: 0.95,
      }]
      : [];
  });
}

function normalizeForDuplicate(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

async function removeIdsFromSelection(householdId: string, itemIds: string[]): Promise<string[]> {
  const selection = await prisma.inventorySelection.findUnique({ where: { householdId } });
  if (!selection) {
    return [];
  }

  const removedIds = new Set(itemIds);
  const selectedIngredientIds = selection.selectedIngredientIds.filter((id) => !removedIds.has(id));
  const updated = await prisma.inventorySelection.update({
    where: { householdId },
    data: { selectedIngredientIds: { set: selectedIngredientIds } },
  });

  return updated.selectedIngredientIds;
}

export function getExpiryStatus(expiresAt: string): "safe" | "soon" | "overdue" {
  const daysLeft = calculateDaysLeft(expiresAt);
  if (daysLeft < 0) {
    return "overdue";
  }
  if (daysLeft <= 2) {
    return "soon";
  }
  return "safe";
}
