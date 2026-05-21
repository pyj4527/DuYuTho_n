import { prisma } from "../lib/prisma";
import type {
  CreateInventoryItemBody,
  UpdateInventoryItemBody,
} from "../schemas/inventory.schema";

const DEV_USER_ID = "dev-user";

export class InventoryItemNotFoundError extends Error {
  constructor() {
    super("Inventory item not found");
    this.name = "InventoryItemNotFoundError";
  }
}

function parseNullableDate(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value.trim() === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid expiresAt date");
  }

  return date;
}

function normalizeNullableString(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

async function findInventoryItemOrThrow(id: string) {
  const item = await prisma.inventoryItem.findFirst({
    where: {
      id,
      userId: DEV_USER_ID,
      status: {
        not: "DELETED",
      },
    },
  });

  if (!item) {
    throw new InventoryItemNotFoundError();
  }

  return item;
}

export const inventoryService = {
  async listActiveItems() {
    return prisma.inventoryItem.findMany({
      where: {
        userId: DEV_USER_ID,
        status: "ACTIVE",
      },
      orderBy: [
        {
          expiresAt: "asc",
        },
        {
          createdAt: "desc",
        },
      ],
    });
  },

  async createItem(input: CreateInventoryItemBody) {
    const expiresAt = parseNullableDate(input.expiresAt);

    return prisma.inventoryItem.create({
      data: {
        userId: DEV_USER_ID,

        name: input.name,
        category: normalizeNullableString(input.category) ?? null,

        quantity: input.quantity ?? null,
        unit: normalizeNullableString(input.unit) ?? null,
        location: normalizeNullableString(input.location) ?? null,

        expiresAt: expiresAt ?? null,
        expiresAtSource: expiresAt ? "USER" : "UNKNOWN",

        freshnessScore: input.freshnessScore ?? null,
        freshnessSource:
          input.freshnessScore === undefined || input.freshnessScore === null
            ? "UNKNOWN"
            : "USER",

        perishabilityScore: input.perishabilityScore ?? null,
        perishabilitySource:
          input.perishabilityScore === undefined ||
          input.perishabilityScore === null
            ? "UNKNOWN"
            : "USER_ADJUSTED",

        status: "ACTIVE",
        sourceType: "MANUAL",
      },
    });
  },

  async updateItem(id: string, input: UpdateInventoryItemBody) {
    await findInventoryItemOrThrow(id);

    const data: Record<string, unknown> = {};

    if (input.name !== undefined) {
      data.name = input.name;
    }

    if (input.category !== undefined) {
      data.category = normalizeNullableString(input.category);
    }

    if (input.quantity !== undefined) {
      data.quantity = input.quantity;
    }

    if (input.unit !== undefined) {
      data.unit = normalizeNullableString(input.unit);
    }

    if (input.location !== undefined) {
      data.location = normalizeNullableString(input.location);
    }

    if (input.expiresAt !== undefined) {
      const expiresAt = parseNullableDate(input.expiresAt);

      data.expiresAt = expiresAt;
      data.expiresAtSource = expiresAt ? "USER" : "UNKNOWN";
    }

    if (input.freshnessScore !== undefined) {
      data.freshnessScore = input.freshnessScore;
      data.freshnessSource =
        input.freshnessScore === null ? "UNKNOWN" : "USER";
    }

    if (input.perishabilityScore !== undefined) {
      data.perishabilityScore = input.perishabilityScore;
      data.perishabilitySource =
        input.perishabilityScore === null ? "UNKNOWN" : "USER_ADJUSTED";
    }

    if (input.status !== undefined) {
      data.status = input.status;

      if (input.status === "DELETED") {
        data.deletedAt = new Date();
      }
    }

    return prisma.inventoryItem.update({
      where: {
        id,
      },
      data,
    });
  },

  async softDeleteItem(id: string) {
    await findInventoryItemOrThrow(id);

    return prisma.inventoryItem.update({
      where: {
        id,
      },
      data: {
        status: "DELETED",
        deletedAt: new Date(),
      },
    });
  },
};