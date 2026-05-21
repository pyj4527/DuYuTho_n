import { t } from "elysia";

const nullableString = t.Union([t.String(), t.Null()]);
const nullableNumber = t.Union([t.Number(), t.Null()]);

export const inventoryIdParamsSchema = t.Object({
  id: t.String({
    minLength: 1,
    description: "InventoryItem ID",
  }),
});

export const createInventoryItemBodySchema = t.Object(
  {
    name: t.String({
      minLength: 1,
      description: "식재료 이름",
    }),

    category: t.Optional(nullableString),
    quantity: t.Optional(nullableNumber),
    unit: t.Optional(nullableString),
    location: t.Optional(nullableString),

    expiresAt: t.Optional(
      t.Union([
        t.String({
          description: "소비기한. 예: 2026-05-24 또는 2026-05-24T00:00:00.000Z",
        }),
        t.Null(),
      ])
    ),

    freshnessScore: t.Optional(
      t.Union([
        t.Number({
          minimum: 0,
          maximum: 100,
          description: "신선도 점수. 0~100",
        }),
        t.Null(),
      ])
    ),

    perishabilityScore: t.Optional(
      t.Union([
        t.Number({
          minimum: 0,
          maximum: 100,
          description: "부패 민감도 점수. 0~100",
        }),
        t.Null(),
      ])
    ),
  },
  {
    additionalProperties: false,
  }
);

export const updateInventoryItemBodySchema = t.Object(
  {
    name: t.Optional(
      t.String({
        minLength: 1,
      })
    ),

    category: t.Optional(nullableString),
    quantity: t.Optional(nullableNumber),
    unit: t.Optional(nullableString),
    location: t.Optional(nullableString),

    expiresAt: t.Optional(t.Union([t.String(), t.Null()])),

    freshnessScore: t.Optional(
      t.Union([
        t.Number({
          minimum: 0,
          maximum: 100,
        }),
        t.Null(),
      ])
    ),

    perishabilityScore: t.Optional(
      t.Union([
        t.Number({
          minimum: 0,
          maximum: 100,
        }),
        t.Null(),
      ])
    ),

    status: t.Optional(
      t.Union([
        t.Literal("ACTIVE"),
        t.Literal("CONSUMED"),
        t.Literal("WASTED"),
        t.Literal("EXPIRED"),
        t.Literal("DELETED"),
      ])
    ),
  },
  {
    additionalProperties: false,
  }
);

export type CreateInventoryItemBody =
  typeof createInventoryItemBodySchema.static;

export type UpdateInventoryItemBody =
  typeof updateInventoryItemBodySchema.static;