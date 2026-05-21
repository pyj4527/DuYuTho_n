import { Elysia } from "elysia";

import {
  inventoryService,
  InventoryItemNotFoundError,
} from "../services/inventory.service";

import {
  createInventoryItemBodySchema,
  inventoryIdParamsSchema,
  updateInventoryItemBodySchema,
  type CreateInventoryItemBody,
  type UpdateInventoryItemBody,
} from "../schemas/inventory.schema";

function getInventoryErrorResponse(error: unknown) {
  if (error instanceof InventoryItemNotFoundError) {
    return {
      status: 404,
      body: {
        error: "INVENTORY_ITEM_NOT_FOUND",
        message: "해당 식재료를 찾을 수 없습니다.",
      },
    };
  }

  if (error instanceof Error && error.message === "Invalid expiresAt date") {
    return {
      status: 400,
      body: {
        error: "INVALID_EXPIRES_AT",
        message: "expiresAt은 올바른 날짜 형식이어야 합니다.",
      },
    };
  }

  console.error(error);

  return {
    status: 500,
    body: {
      error: "INTERNAL_SERVER_ERROR",
      message: "서버 내부 오류가 발생했습니다.",
    },
  };
}

export const inventoryRoute = new Elysia({ prefix: "/inventory" })
  .get(
    "/",
    async () => {
      const items = await inventoryService.listActiveItems();

      return {
        items,
      };
    },
    {
      detail: {
        tags: ["Inventory"],
        summary: "현재 활성 식재료 조회",
      },
    }
  )

  .post(
    "/",
    async ({ body, set }) => {
      try {
        const item = await inventoryService.createItem(
          body as CreateInventoryItemBody
        );

        set.status = 201;

        return {
          item,
        };
      } catch (error) {
        const response = getInventoryErrorResponse(error);

        set.status = response.status;

        return response.body;
      }
    },
    {
      body: createInventoryItemBodySchema,
      detail: {
        tags: ["Inventory"],
        summary: "수동 식재료 추가",
      },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const item = await inventoryService.updateItem(
          params.id,
          body as UpdateInventoryItemBody
        );

        return {
          item,
        };
      } catch (error) {
        const response = getInventoryErrorResponse(error);

        set.status = response.status;

        return response.body;
      }
    },
    {
      params: inventoryIdParamsSchema,
      body: updateInventoryItemBodySchema,
      detail: {
        tags: ["Inventory"],
        summary: "식재료 정보 수정",
      },
    }
  )

  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const item = await inventoryService.softDeleteItem(params.id);

        return {
          item,
        };
      } catch (error) {
        const response = getInventoryErrorResponse(error);

        set.status = response.status;

        return response.body;
      }
    },
    {
      params: inventoryIdParamsSchema,
      detail: {
        tags: ["Inventory"],
        summary: "식재료 soft-delete",
      },
    }
  );