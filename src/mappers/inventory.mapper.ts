import type { InventoryItem as InventoryItemModel } from "../../generated/prisma/client";
import type {
  InventoryItemDto,
  InventoryItemStatus,
  InventorySource,
  StorageLocation,
} from "../domain/dto";
import { inventoryItemStatuses, inventorySources, storageLocations } from "../domain/dto";
import { toRfc3339 } from "../lib/date";

export function mapInventoryItem(item: InventoryItemModel): InventoryItemDto {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantityLabel,
    location: normalizeLocation(item.location),
    expiresAt: item.expiresAt,
    status: normalizeStatus(item.status),
    source: normalizeSource(item.source),
    category: item.category,
    memo: item.memo,
    createdAt: toRfc3339(item.createdAt),
    updatedAt: toRfc3339(item.updatedAt),
    discardedAt: item.discardedAt ? toRfc3339(item.discardedAt) : null,
    consumedAt: item.consumedAt ? toRfc3339(item.consumedAt) : null,
    version: item.version,
  };
}

export function normalizeLocation(value: string): StorageLocation {
  return storageLocations.includes(value as StorageLocation) ? (value as StorageLocation) : "냉장";
}

export function normalizeStatus(value: string): InventoryItemStatus {
  return inventoryItemStatuses.includes(value as InventoryItemStatus)
    ? (value as InventoryItemStatus)
    : "active";
}

export function normalizeSource(value: string): InventorySource {
  return inventorySources.includes(value as InventorySource) ? (value as InventorySource) : "manual";
}
