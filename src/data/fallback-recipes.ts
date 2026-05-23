import type { RecipeDto } from "../domain/dto";

export const fallbackRecipes: RecipeDto[] = [
  {
    id: "r1",
    name: "애호박 두부 덮밥",
    ingredients: [
      { name: "두부", quantity: "1모", avatar: "⬜" },
      { name: "애호박", quantity: "1/2개", avatar: "🥒" },
      { name: "버섯", quantity: "180g", avatar: "🍄" },
    ],
    saved: true,
    time: "15분",
    timeMinutes: 15,
    servings: 2,
    difficulty: "easy",
    tags: ["kid_friendly", "rice", "warm"],
    description: "임박한 두부와 애호박을 빠르게 소진하는 한 그릇 덮밥입니다.",
    steps: [
      { order: 1, description: "두부와 애호박, 버섯을 한 입 크기로 손질합니다.", durationMinutes: 4 },
      { order: 2, description: "팬에 재료를 볶고 간장 양념을 더합니다.", durationMinutes: 7 },
      { order: 3, description: "밥 위에 얹어 따뜻하게 완성합니다.", durationMinutes: 4 },
    ],
  },
  {
    id: "r2",
    name: "버섯 된장국",
    ingredients: [
      { name: "버섯", quantity: "100g", avatar: "🍄" },
      { name: "두부", quantity: "1/2모", avatar: "⬜" },
    ],
    saved: false,
    time: "12분",
    timeMinutes: 12,
    servings: 2,
    difficulty: "easy",
    tags: ["kid_friendly", "soup", "warm"],
    description: "남은 버섯과 두부를 넣어 끓이는 순한 된장국입니다.",
    steps: [
      { order: 1, description: "육수에 된장을 풀고 끓입니다.", durationMinutes: 3 },
      { order: 2, description: "버섯과 두부를 넣어 익힙니다.", durationMinutes: 7 },
      { order: 3, description: "간을 맞추고 그릇에 담습니다.", durationMinutes: 2 },
    ],
  },
  {
    id: "r3",
    name: "상추 겉절이",
    ingredients: [
      { name: "상추", quantity: "8장", avatar: "🥬" },
      { name: "고춧가루", quantity: "1큰술", avatar: "🌶️" },
    ],
    saved: false,
    time: "7분",
    timeMinutes: 7,
    servings: 2,
    difficulty: "easy",
    tags: ["no_heat", "simple", "salad"],
    description: "불 없이 바로 무치는 빠른 상추 소진 메뉴입니다.",
    steps: [
      { order: 1, description: "상추를 씻고 물기를 제거합니다.", durationMinutes: 3 },
      { order: 2, description: "양념을 넣어 숨이 죽지 않게 가볍게 버무립니다.", durationMinutes: 4 },
    ],
  },
];
