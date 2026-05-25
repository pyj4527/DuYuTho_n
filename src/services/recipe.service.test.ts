import { describe, expect, it } from "bun:test";
import type { InventoryItemDto, RecipeRecommendationDto } from "../domain/dto";
import { getRelativeDateString } from "../lib/date";
import { getAccessibleRecipeInventoryItems, personalizeRecipeRecommendations } from "./recipe.service";

const tomato: InventoryItemDto = {
  id: "tomato",
  name: "토마토",
  quantity: "2개",
  location: "냉장",
  expiresAt: getRelativeDateString(1),
};

const tofu: InventoryItemDto = {
  id: "tofu",
  name: "두부",
  quantity: "1모",
  location: "냉장",
  expiresAt: getRelativeDateString(7),
};

describe("recipe inventory access scope", () => {
  it("allows all active inventory when the user has not selected a recipe scope", () => {
    expect(getAccessibleRecipeInventoryItems([tomato, tofu], [])).toEqual([tomato, tofu]);
  });

  it("limits recipe access to user-selected inventory items", () => {
    expect(getAccessibleRecipeInventoryItems([tomato, tofu], ["tofu"])).toEqual([tofu]);
  });
});

describe("recipe personalization", () => {
  const tomatoRecipe: RecipeRecommendationDto = {
    recipe: {
      id: "tomato-recipe",
      name: "토마토 볶음",
      ingredients: [{ name: "토마토", quantity: "2개", avatar: "restaurant" }],
      saved: false,
      time: "12분",
      timeMinutes: 12,
      tags: ["simple"],
    },
    match: {
      ingredients: [{ name: "토마토", quantity: "2개", avatar: "restaurant", status: "owned", itemId: "tomato" }],
      selectedCount: 0,
      ownedCount: 1,
      totalCount: 1,
      matchPercentage: 100,
    },
    rank: 2,
    reasons: ["보유 식재료 1개 매칭"],
  };
  const tofuRecipe: RecipeRecommendationDto = {
    recipe: {
      id: "tofu-recipe",
      name: "두부 구이",
      ingredients: [{ name: "두부", quantity: "1모", avatar: "restaurant" }],
      saved: false,
      time: "25분",
      timeMinutes: 25,
    },
    match: {
      ingredients: [{ name: "두부", quantity: "1모", avatar: "restaurant", status: "selected", itemId: "tofu" }],
      selectedCount: 1,
      ownedCount: 0,
      totalCount: 1,
      matchPercentage: 100,
    },
    rank: 1,
    reasons: ["선택한 식재료 1개 포함"],
  };

  it("filters excluded ingredients before ranking", () => {
    const ranked = personalizeRecipeRecommendations(
      [tofuRecipe, tomatoRecipe],
      [tomato, tofu],
      {
        excludedIngredients: ["두부"],
        dislikedFoods: [],
        allergies: [],
      },
    );

    expect(ranked.map((recommendation) => recommendation.recipe.id)).toEqual(["tomato-recipe"]);
  });

  it("promotes expiring inventory and preferred cook time", () => {
    const ranked = personalizeRecipeRecommendations(
      [tofuRecipe, tomatoRecipe],
      [tomato, tofu],
      {
        excludedIngredients: [],
        dislikedFoods: [],
        allergies: [],
        preferredCookTimeMinutes: 15,
        mildFlavorPreferred: true,
      },
    );

    expect(ranked[0]?.recipe.id).toBe("tomato-recipe");
    expect(ranked[0]?.reasons).toContain("임박 재료 1개 우선 사용");
    expect(ranked[0]?.reasons).toContain("선호 조리시간 15분 이내");
  });
});
