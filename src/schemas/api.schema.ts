import { t } from "elysia";

const nullableString = t.Nullable(t.String());
const nullableNumber = t.Nullable(t.Number());

export const storageLocationSchema = t.Union([
  t.Literal("냉장"),
  t.Literal("냉동"),
  t.Literal("실온"),
]);

export const inventorySourceSchema = t.Union([
  t.Literal("manual"),
  t.Literal("lens_image"),
  t.Literal("lens_upload"),
  t.Literal("lens_text"),
  t.Literal("migration"),
  t.Literal("seed"),
]);

export const inventoryStatusSchema = t.Union([
  t.Literal("active"),
  t.Literal("consumed"),
  t.Literal("discarded"),
]);

export const problemDetailsSchema = t.Object({
  type: t.String(),
  title: t.String(),
  status: t.Number(),
  detail: t.Optional(t.String()),
  instance: t.Optional(t.String()),
  errors: t.Optional(
    t.Array(
      t.Object({
        pointer: t.String(),
        detail: t.String(),
        code: t.Optional(t.String()),
      }),
    ),
  ),
  requestId: t.Optional(t.String()),
});

export const pageMetaSchema = t.Object({
  nextCursor: t.Nullable(t.String()),
  hasMore: t.Boolean(),
  limit: t.Number(),
});

export const pageQuerySchema = t.Object({
  cursor: t.Optional(t.String()),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export const itemIdParamsSchema = t.Object({
  itemId: t.String({ minLength: 1 }),
});

export const recipeIdParamsSchema = t.Object({
  recipeId: t.String({ minLength: 1 }),
});

export const analysisIdParamsSchema = t.Object({
  analysisId: t.String({ minLength: 1 }),
});

export const subscriptionIdParamsSchema = t.Object({
  subscriptionId: t.String({ minLength: 1 }),
});

export const inventoryItemSchema = t.Object({
  id: t.String(),
  name: t.String(),
  quantity: t.String(),
  location: storageLocationSchema,
  expiresAt: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  status: t.Optional(inventoryStatusSchema),
  source: t.Optional(inventorySourceSchema),
  category: t.Optional(nullableString),
  memo: t.Optional(nullableString),
  createdAt: t.Optional(t.String()),
  updatedAt: t.Optional(t.String()),
  discardedAt: t.Optional(nullableString),
  consumedAt: t.Optional(nullableString),
  version: t.Optional(t.Number()),
});

export const spoilageRiskSchema = t.Object({
  level: t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high"), t.Literal("critical")]),
  score: t.Number({ minimum: 0, maximum: 1 }),
  daysLeft: t.Number(),
  reasons: t.Array(t.String()),
  recommendation: t.String(),
});

export const inventoryPageSchema = t.Object({
  data: t.Array(inventoryItemSchema),
  page: pageMetaSchema,
});

export const inventoryCreateBodySchema = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 80 }),
    quantity: t.String({ minLength: 1 }),
    location: storageLocationSchema,
    expiresAt: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
    source: t.Optional(inventorySourceSchema),
    clientRequestId: t.Optional(t.String()),
  },
  { additionalProperties: false },
);

export const inventoryPatchBodySchema = t.Partial(
  t.Object(
    {
      name: t.String({ minLength: 1, maxLength: 80 }),
      quantity: t.String({ minLength: 1 }),
      location: storageLocationSchema,
      expiresAt: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
      status: inventoryStatusSchema,
      memo: nullableString,
    },
    { additionalProperties: false },
  ),
);

export const inventoryListQuerySchema = t.Object({
  q: t.Optional(t.String()),
  location: t.Optional(storageLocationSchema),
  expiry: t.Optional(t.Union([t.Literal("soon"), t.Literal("overdue"), t.Literal("safe")])),
  includeDiscarded: t.Optional(t.BooleanString()),
  sort: t.Optional(t.Union([t.Literal("expiresAt"), t.Literal("createdAt"), t.Literal("name")])),
  direction: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
  cursor: t.Optional(t.String()),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export const inventoryBatchCreateBodySchema = t.Object(
  {
    source: t.Union([
      t.Literal("lens_image"),
      t.Literal("lens_upload"),
      t.Literal("lens_text"),
      t.Literal("manual"),
      t.Literal("migration"),
    ]),
    analysisId: t.Optional(t.String()),
    items: t.Array(inventoryCreateBodySchema, { minItems: 1, maxItems: 100 }),
  },
  { additionalProperties: false },
);

export const inventoryBatchCreateResultSchema = t.Object({
  items: t.Array(inventoryItemSchema),
  idMap: t.Optional(t.Record(t.String(), t.String())),
  duplicateSuggestions: t.Optional(
    t.Array(
      t.Object({
        candidateName: t.String(),
        existingItemId: t.String(),
        existingName: t.String(),
        reason: t.Union([
          t.Literal("same_name"),
          t.Literal("similar_name"),
          t.Literal("same_normalized_name"),
        ]),
        confidence: t.Number({ minimum: 0, maximum: 1 }),
        candidateRisk: t.Optional(spoilageRiskSchema),
        existingRisk: t.Optional(spoilageRiskSchema),
        recommendation: t.Optional(t.String()),
      }),
    ),
  ),
});

export const inventoryMergePreviewBodySchema = t.Object(
  {
    candidates: t.Array(
      t.Composite([
        inventoryCreateBodySchema,
        t.Object({
          candidateId: t.Optional(t.String()),
        }),
      ]),
      { minItems: 1, maxItems: 100 },
    ),
  },
  { additionalProperties: false },
);

export const inventoryMergePreviewSchema = t.Object({
  candidates: t.Array(
    t.Composite([
      inventoryCreateBodySchema,
      t.Object({
        candidateId: t.Optional(t.String()),
      }),
    ]),
  ),
  duplicateSuggestions: t.Array(
    t.Object({
      candidateName: t.String(),
      existingItemId: t.String(),
      existingName: t.String(),
      reason: t.Union([
        t.Literal("same_name"),
        t.Literal("similar_name"),
        t.Literal("same_normalized_name"),
      ]),
      confidence: t.Number({ minimum: 0, maximum: 1 }),
      candidateRisk: t.Optional(spoilageRiskSchema),
      existingRisk: t.Optional(spoilageRiskSchema),
      recommendation: t.Optional(t.String()),
    }),
  ),
  mergeGroups: t.Array(
    t.Object({
      candidateName: t.String(),
      existingItemId: t.String(),
      existingName: t.String(),
      suggestedQuantity: t.String(),
      suggestedExpiresAt: t.String(),
      recommendation: t.String(),
    }),
  ),
});

export const inventoryReviewStateBodySchema = t.Object(
  {
    reviewState: t.Union([t.Literal("needs_review"), t.Literal("confirmed")]),
    reasons: t.Optional(t.Array(t.Union([
      t.Literal("low_confidence"),
      t.Literal("missing_quantity"),
      t.Literal("missing_expiry"),
      t.Literal("ambiguous_name"),
      t.Literal("duplicate_possible"),
    ]))),
    note: t.Optional(nullableString),
  },
  { additionalProperties: false },
);

export const inventorySelectionSchema = t.Object({
  selectedIngredientIds: t.Array(t.String()),
  updatedAt: t.String(),
});

export const inventorySelectionUpdateBodySchema = t.Object(
  {
    selectedIngredientIds: t.Array(t.String()),
  },
  { additionalProperties: false },
);

export const inventoryDiscardBodySchema = t.Optional(
  t.Object(
    {
      reason: t.Optional(
        t.Union([
          t.Literal("expired"),
          t.Literal("spoiled"),
          t.Literal("used_up"),
          t.Literal("mistake"),
          t.Literal("other"),
        ]),
      ),
      note: t.Optional(t.String({ maxLength: 500 })),
    },
    { additionalProperties: false },
  ),
);

export const inventoryDiscardResultSchema = t.Object({
  itemId: t.String(),
  status: t.Literal("discarded"),
  discardedAt: t.String(),
});

export const healthSchema = t.Object({
  status: t.Literal("ok"),
  time: t.String(),
});

export const readinessSchema = t.Object({
  status: t.Union([t.Literal("ready"), t.Literal("degraded"), t.Literal("down")]),
  time: t.String(),
  dependencies: t.Array(
    t.Object({
      name: t.String(),
      status: t.Union([t.Literal("ready"), t.Literal("degraded"), t.Literal("down")]),
      latencyMs: t.Optional(t.Number()),
    }),
  ),
});

export const homeSummarySchema = t.Object({
  totalItemsCount: t.Number(),
  fridgeCount: t.Number(),
  freezerCount: t.Number(),
  roomTempCount: t.Number(),
  soonCount: t.Number(),
  overdueCount: t.Number(),
  priorityCount: t.Number(),
  todayCount: t.Number(),
  state: t.Object({
    id: t.Union([t.Literal("default"), t.Literal("empty"), t.Literal("expiring"), t.Literal("overdue")]),
    label: t.String(),
    title: t.String(),
    description: t.String(),
    tone: t.Union([t.Literal("ready"), t.Literal("empty"), t.Literal("warning"), t.Literal("danger")]),
  }),
  generatedAt: t.String(),
});

export const expiryCalendarMonthSchema = t.Object({
  year: t.Number(),
  month: t.Number(),
  days: t.Array(
    t.Object({
      date: t.String(),
      count: t.Number(),
      tone: t.Union([t.Literal("none"), t.Literal("safe"), t.Literal("soon"), t.Literal("danger")]),
      representativeItemName: t.Optional(t.String()),
      itemIds: t.Array(t.String()),
    }),
  ),
});

export const expiryCalendarQuerySchema = t.Object({
  year: t.Numeric({ minimum: 1970, maximum: 3000 }),
  month: t.Numeric({ minimum: 1, maximum: 12 }),
});

export const lensCandidateSchema = t.Object({
  id: t.String(),
  name: t.String(),
  quantity: t.String(),
  location: storageLocationSchema,
  expiresAt: t.String(),
  confidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  sourceText: t.Optional(t.String()),
  normalizedName: t.Optional(t.String()),
  needsReview: t.Optional(t.Boolean()),
  reviewReasons: t.Optional(t.Array(t.String())),
  boundingBox: t.Optional(
    t.Object({
      x: t.Number(),
      y: t.Number(),
      width: t.Number(),
      height: t.Number(),
    }),
  ),
  spoilageRisk: t.Optional(spoilageRiskSchema),
});

export const lensAnalyzeTextBodySchema = t.Object(
  {
    text: t.String({ minLength: 1, maxLength: 4000 }),
    timezone: t.Optional(t.String()),
    baseDate: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  },
  { additionalProperties: false },
);

export const lensAnalyzeResponseSchema = t.Object({
  analysisId: t.String(),
  status: t.Union([t.Literal("completed"), t.Literal("needs_review")]),
  source: t.Union([t.Literal("camera"), t.Literal("upload"), t.Literal("simulator"), t.Literal("natural_text")]),
  candidates: t.Array(lensCandidateSchema),
  imageQuality: t.Optional(
    t.Object({
      score: t.Number(),
      warnings: t.Array(t.String()),
    }),
  ),
  rawText: t.Optional(t.String()),
  provider: t.Optional(
    t.Object({
      name: t.String(),
      model: t.Optional(t.String()),
      latencyMs: t.Optional(t.Number()),
    }),
  ),
});

export const lensAnalyzeJobSchema = t.Object({
  analysisId: t.String(),
  status: t.Union([t.Literal("queued"), t.Literal("processing"), t.Literal("completed"), t.Literal("failed")]),
  progress: t.Optional(t.Number()),
  result: t.Optional(lensAnalyzeResponseSchema),
  error: t.Optional(problemDetailsSchema),
});

export const lensAnalyzeImageBodySchema = t.Object({
  image: t.File({
    type: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    maxSize: "10m",
  }),
  metadata: t.Optional(t.Union([
    t.String(),
    t.Object({
      source: t.Optional(t.Union([t.Literal("camera"), t.Literal("upload"), t.Literal("simulator")])),
      timezone: t.Optional(t.String()),
      clientCapturedAt: t.Optional(t.String()),
      languageHints: t.Optional(t.Array(t.String())),
      maxCandidates: t.Optional(t.Number()),
      confidenceThreshold: t.Optional(t.Number()),
    }),
  ])),
});

export const recipeIngredientSchema = t.Object({
  name: t.String(),
  quantity: t.String(),
  avatar: t.String(),
});

export const recipeDtoSchema = t.Object({
  id: t.String(),
  ingredients: t.Array(recipeIngredientSchema),
  name: t.String(),
  saved: t.Boolean(),
  time: t.String(),
  description: t.Optional(t.String()),
  imageUrl: t.Optional(t.String()),
  timeMinutes: t.Optional(t.Number()),
  servings: t.Optional(t.Number()),
  difficulty: t.Optional(t.Union([t.Literal("easy"), t.Literal("medium"), t.Literal("hard")])),
  tags: t.Optional(t.Array(t.String())),
  dietaryFlags: t.Optional(t.Array(t.String())),
  steps: t.Optional(t.Array(t.Object({ order: t.Number(), description: t.String(), durationMinutes: t.Optional(t.Number()) }))),
  nutrition: t.Optional(t.Record(t.String(), t.Number())),
  createdAt: t.Optional(t.String()),
  updatedAt: t.Optional(t.String()),
});

export const recipeRecommendationSchema = t.Object({
  recipe: recipeDtoSchema,
  match: t.Object({
    ingredients: t.Array(
      t.Composite([
        recipeIngredientSchema,
        t.Object({
          status: t.Union([t.Literal("selected"), t.Literal("owned"), t.Literal("missing")]),
          itemId: t.Nullable(t.String()),
        }),
      ]),
    ),
    selectedCount: t.Number(),
    ownedCount: t.Number(),
    totalCount: t.Number(),
    matchPercentage: t.Number(),
  }),
  rank: t.Number(),
  reasons: t.Array(t.String()),
});

export const recipePageSchema = t.Object({
  data: t.Array(recipeRecommendationSchema),
  page: pageMetaSchema,
});

export const recipeListQuerySchema = t.Object({
  mode: t.Optional(t.Union([t.Literal("recommend"), t.Literal("saved")])),
  selectedIngredientIds: t.Optional(t.ArrayQuery(t.String())),
  conditions: t.Optional(t.ArrayQuery(t.String())),
  q: t.Optional(t.String()),
  cursor: t.Optional(t.String()),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
});

export const recipeImportBodySchema = t.Object(
  {
    url: t.String({ minLength: 1, maxLength: 2048 }),
    selectedIngredientIds: t.Optional(t.Array(t.String())),
  },
  { additionalProperties: false },
);

export const recipeSavedBodySchema = t.Object(
  {
    saved: t.Boolean(),
  },
  { additionalProperties: false },
);

export const recipeConsumeBodySchema = t.Object(
  {
    selectedIngredientIds: t.Optional(t.Array(t.String())),
    consumedAt: t.Optional(t.String()),
    strategy: t.Optional(t.Union([t.Literal("frontend_label_compat"), t.Literal("explicit_amounts")])),
    explicitAmounts: t.Optional(t.Array(t.Object({ itemId: t.String(), quantity: t.String() }))),
  },
  { additionalProperties: false },
);

export const recipeConsumeResultSchema = t.Object({
  recipeId: t.String(),
  consumedAt: t.String(),
  updatedItems: t.Array(inventoryItemSchema),
  removedItemIds: t.Array(t.String()),
  selectedIngredientIds: t.Array(t.String()),
  consumptionLogId: t.String(),
  needsReview: t.Optional(
    t.Array(
      t.Object({
        itemId: t.String(),
        reason: t.Union([t.Literal("ambiguous_quantity"), t.Literal("insufficient_quantity"), t.Literal("not_matched")]),
      }),
    ),
  ),
});

export const recipeConsumptionLogSchema = t.Object({
  id: t.String(),
  recipeId: t.String(),
  recipeName: t.String(),
  consumedAt: t.String(),
  selectedIngredientIds: t.Array(t.String()),
  updatedItemIds: t.Array(t.String()),
  removedItemIds: t.Array(t.String()),
});

export const recipeConsumptionLogPageSchema = t.Object({
  data: t.Array(recipeConsumptionLogSchema),
  page: pageMetaSchema,
});

export const recipePreferenceSchema = t.Object({
  excludedIngredients: t.Array(t.String()),
  dislikedFoods: t.Array(t.String()),
  allergies: t.Array(t.String()),
  preferredCookTimeMinutes: t.Optional(t.Number()),
  mildFlavorPreferred: t.Optional(t.Boolean()),
  recentMeals: t.Array(recipeConsumptionLogSchema),
});

export const recipePreferencePatchBodySchema = t.Partial(
  t.Object({
    excludedIngredients: t.Array(t.String()),
    dislikedFoods: t.Array(t.String()),
    allergies: t.Array(t.String()),
    preferredCookTimeMinutes: nullableNumber,
    mildFlavorPreferred: t.Nullable(t.Boolean()),
  }),
);

export const recipeFeedbackBodySchema = t.Object(
  {
    action: t.Union([t.Literal("cooked"), t.Literal("not_today"), t.Literal("disliked")]),
    ingredientNames: t.Optional(t.Array(t.String())),
    note: t.Optional(t.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export const recipeFeedbackSchema = t.Object({
  accepted: t.Literal(true),
  recipeId: t.String(),
  action: t.Union([t.Literal("cooked"), t.Literal("not_today"), t.Literal("disliked")]),
  updatedPreferences: t.Optional(recipePreferenceSchema),
});

export const householdSettingsSchema = t.Object({
  household: t.Object({
    id: t.String(),
    name: t.String(),
    memberCount: t.Number(),
    timezone: t.String(),
    defaultStorageLocation: storageLocationSchema,
    createdAt: t.String(),
    updatedAt: t.String(),
  }),
  profile: t.Object({
    id: t.String(),
    householdId: t.String(),
    nickname: t.String(),
    email: t.Optional(t.String()),
    avatarUrl: t.Optional(t.String()),
    createdAt: t.String(),
    updatedAt: t.String(),
  }),
  dietary: t.Object({
    excludedIngredients: t.Array(t.String()),
    dislikedFoods: t.Array(t.String()),
    allergies: t.Array(t.String()),
    preferredCookTimeMinutes: t.Optional(t.Number()),
    mildFlavorPreferred: t.Optional(t.Boolean()),
  }),
  notifications: t.Object({
    expiryReminderEnabled: t.Boolean(),
    expiryReminderDaysBefore: t.Array(t.Number()),
    expiryReminderTime: t.String(),
    recipeConsumeReminderEnabled: t.Boolean(),
    reviewPendingReminderEnabled: t.Boolean(),
    quietHours: t.Optional(t.Object({ start: t.String(), end: t.String() })),
  }),
});

export const profilePatchBodySchema = t.Partial(
  t.Object({
    nickname: t.String({ minLength: 1, maxLength: 80 }),
    email: nullableString,
    avatarUrl: nullableString,
  }),
);

export const householdSettingsPatchBodySchema = t.Partial(
  t.Object({
    household: t.Optional(
      t.Partial(
        t.Object({
          name: t.String({ minLength: 1, maxLength: 80 }),
          memberCount: t.Number({ minimum: 1, maximum: 20 }),
          timezone: t.String(),
          defaultStorageLocation: storageLocationSchema,
        }),
      ),
    ),
    dietary: t.Optional(
      t.Partial(
        t.Object({
          excludedIngredients: t.Array(t.String()),
          dislikedFoods: t.Array(t.String()),
          allergies: t.Array(t.String()),
          preferredCookTimeMinutes: nullableNumber,
          mildFlavorPreferred: t.Nullable(t.Boolean()),
        }),
      ),
    ),
    notifications: t.Optional(
      t.Partial(
        t.Object({
          expiryReminderEnabled: t.Boolean(),
          expiryReminderDaysBefore: t.Array(t.Number()),
          expiryReminderTime: t.String(),
          recipeConsumeReminderEnabled: t.Boolean(),
          reviewPendingReminderEnabled: t.Boolean(),
          quietHours: t.Nullable(t.Object({ start: t.String(), end: t.String() })),
        }),
      ),
    ),
  }),
);

export const clientPreferenceBodySchema = t.Partial(
  t.Object({
    theme: t.Optional(t.Union([t.Literal("light"), t.Literal("dark"), t.Literal("system")])),
    onboardingCompleted: t.Optional(t.Boolean()),
    onboardingCompletedAt: t.Optional(t.Nullable(t.String())),
  }),
);

export const pushSubscriptionBodySchema = t.Object(
  {
    subscription: t.Object({
      endpoint: t.String(),
      expirationTime: t.Nullable(t.Number()),
      keys: t.Object({
        p256dh: t.String({ minLength: 1 }),
        auth: t.String({ minLength: 1 }),
      }),
    }),
    userAgent: t.Optional(t.String()),
    timezone: t.String(),
    deviceLabel: t.Optional(t.String()),
  },
  { additionalProperties: false },
);

export const pushSubscriptionRecordSchema = t.Object({
  id: t.String(),
  endpoint: t.String(),
  expirationTime: t.Nullable(t.Number()),
  userAgent: t.Optional(t.String()),
  timezone: t.String(),
  active: t.Boolean(),
  createdAt: t.String(),
  updatedAt: t.String(),
  lastSuccessAt: t.Optional(t.String()),
  lastFailureAt: t.Optional(t.String()),
});

export const pushSubscriptionRecordListSchema = t.Array(pushSubscriptionRecordSchema);

export const pushTestBodySchema = t.Object({
  subscriptionId: t.Optional(t.String()),
});

export const pushTestResultSchema = t.Object({
  queued: t.Literal(true),
  sent: t.Number(),
  failed: t.Number(),
  inactiveIds: t.Array(t.String()),
});

export const vapidPublicKeySchema = t.Object({
  publicKey: t.String(),
});

export const notificationPreferenceSchema = t.Object({
  expiryReminderEnabled: t.Boolean(),
  expiryReminderDaysBefore: t.Array(t.Number()),
  expiryReminderTime: t.String(),
  recipeConsumeReminderEnabled: t.Boolean(),
  reviewPendingReminderEnabled: t.Boolean(),
  quietHours: t.Optional(t.Object({ start: t.String(), end: t.String() })),
  recommendedTime: t.String(),
  recommendationReason: t.String(),
});

export const notificationPreferencePatchBodySchema = t.Partial(
  t.Object({
    expiryReminderEnabled: t.Boolean(),
    expiryReminderDaysBefore: t.Array(t.Number()),
    expiryReminderTime: t.String(),
    recipeConsumeReminderEnabled: t.Boolean(),
    reviewPendingReminderEnabled: t.Boolean(),
    quietHours: t.Nullable(t.Object({ start: t.String(), end: t.String() })),
  }),
);

export const notificationPreviewSchema = t.Object({
  generatedAt: t.String(),
  recommendedTime: t.String(),
  summary: t.Object({
    todayCount: t.Number(),
    overdueCount: t.Number(),
    soonCount: t.Number(),
    needsReviewCount: t.Number(),
    title: t.String(),
    body: t.String(),
  }),
  items: t.Array(t.Object({
    id: t.String(),
    name: t.String(),
    expiresAt: t.String(),
    daysLeft: t.Number(),
    bucket: t.Union([t.Literal("today"), t.Literal("overdue"), t.Literal("soon")]),
  })),
  nextNotifications: t.Array(t.Object({
    type: t.Union([
      t.Literal("expiry_reminder"),
      t.Literal("expiry_overdue"),
      t.Literal("today_summary"),
      t.Literal("review_pending"),
    ]),
    scheduledLocalTime: t.String(),
    title: t.String(),
    body: t.String(),
    tag: t.String(),
    url: t.String(),
  })),
});

export const notificationDispatchBodySchema = t.Object({
  dryRun: t.Optional(t.Boolean()),
});

export const notificationDispatchResultSchema = t.Object({
  queued: t.Literal(true),
  dryRun: t.Boolean(),
  sent: t.Number(),
  failed: t.Number(),
  inactiveIds: t.Array(t.String()),
  payloads: t.Array(t.Object({
    title: t.Optional(t.String()),
    body: t.Optional(t.String()),
    icon: t.Optional(t.String()),
    badge: t.Optional(t.String()),
    tag: t.Optional(t.String()),
    url: t.Optional(t.String()),
  })),
});

export const prototypeImportBodySchema = t.Object({
  source: t.Literal("prototype-store"),
  clientGeneratedAt: t.String(),
  state: t.Object({
    version: t.Literal(2),
    items: t.Array(inventoryItemSchema),
    recipes: t.Array(
      t.Object({
        id: t.String(),
        ingredients: t.Array(recipeIngredientSchema),
        name: t.String(),
        saved: t.Boolean(),
        time: t.String(),
      }),
    ),
    selectedIngredientIds: t.Array(t.String()),
  }),
  strategy: t.Union([t.Literal("merge"), t.Literal("replace_if_empty"), t.Literal("dry_run")]),
});

export const prototypeImportResultSchema = t.Object({
  imported: t.Object({
    items: t.Number(),
    recipes: t.Number(),
    selectedIngredientIds: t.Number(),
  }),
  idMap: t.Object({
    items: t.Record(t.String(), t.String()),
    recipes: t.Record(t.String(), t.String()),
  }),
  skipped: t.Array(
    t.Object({
      type: t.Union([t.Literal("item"), t.Literal("recipe"), t.Literal("selection")]),
      clientId: t.Optional(t.String()),
      reason: t.String(),
    }),
  ),
});

export const syncPullBodySchema = t.Object({
  since: t.Optional(t.String()),
  cursor: t.Optional(t.String()),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
});

export const syncPullResponseSchema = t.Object({
  items: t.Array(inventoryItemSchema),
  recipes: t.Array(recipeDtoSchema),
  selectedIngredientIds: t.Array(t.String()),
  deletedIds: t.Object({
    items: t.Array(t.String()),
    recipes: t.Array(t.String()),
  }),
  nextCursor: t.Nullable(t.String()),
  syncToken: t.String(),
});
