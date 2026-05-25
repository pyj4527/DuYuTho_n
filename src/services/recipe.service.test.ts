import { describe, expect, it } from "bun:test";
import type { InventoryItemDto } from "../domain/dto";
import { getAccessibleRecipeInventoryItems } from "./recipe.service";

const tomato: InventoryItemDto = {
  id: "tomato",
  name: "토마토",
  quantity: "2개",
  location: "냉장",
  expiresAt: "2026-05-28",
};

const tofu: InventoryItemDto = {
  id: "tofu",
  name: "두부",
  quantity: "1모",
  location: "냉장",
  expiresAt: "2026-05-27",
};

describe("recipe inventory access scope", () => {
  it("allows all active inventory when the user has not selected a recipe scope", () => {
    expect(getAccessibleRecipeInventoryItems([tomato, tofu], [])).toEqual([tomato, tofu]);
  });

  it("limits recipe access to user-selected inventory items", () => {
    expect(getAccessibleRecipeInventoryItems([tomato, tofu], ["tofu"])).toEqual([tofu]);
  });
});
