export const storageLocations = ["냉장", "냉동", "실온"] as const;
export type StorageLocation = (typeof storageLocations)[number];

export const inventorySources = [
  "manual",
  "lens_image",
  "lens_upload",
  "lens_text",
  "migration",
  "seed",
] as const;
export type InventorySource = (typeof inventorySources)[number];

export const inventoryItemStatuses = [
  "active",
  "consumed",
  "discarded",
] as const;
export type InventoryItemStatus = (typeof inventoryItemStatuses)[number];

export const recipeConditionKeys = [
  "under_15_min",
  "no_heat",
  "kid_friendly",
  "prioritize_expiring",
] as const;
export type RecipeConditionKey = (typeof recipeConditionKeys)[number];

export type ExpiryStatus = "safe" | "soon" | "overdue";
export type CapabilityStatus =
  | "idle"
  | "checking"
  | "ready"
  | "active"
  | "blocked"
  | "unsupported"
  | "error";

export type ProblemDetailsDto = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Array<{
    pointer: string;
    detail: string;
    code?: string;
  }>;
  requestId?: string;
};

export type PageMetaDto = {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

export type PageDto<T> = {
  data: T[];
  page: PageMetaDto;
};

export type InventoryItemDto = {
  id: string;
  name: string;
  quantity: string;
  location: StorageLocation;
  expiresAt: string;
  status?: InventoryItemStatus;
  source?: InventorySource;
  category?: string | null;
  memo?: string | null;
  createdAt?: string;
  updatedAt?: string;
  discardedAt?: string | null;
  consumedAt?: string | null;
  version?: number;
};

export type InventoryItemCreateDto = {
  name: string;
  quantity: string;
  location: StorageLocation;
  expiresAt: string;
  source?: InventorySource;
  clientRequestId?: string;
};

export type InventoryItemPatchDto = Partial<{
  name: string;
  quantity: string;
  location: StorageLocation;
  expiresAt: string;
  status: InventoryItemStatus;
  memo: string | null;
}>;

export type InventoryBatchCreateDto = {
  source: "lens_image" | "lens_upload" | "lens_text" | "manual" | "migration";
  analysisId?: string;
  items: InventoryItemCreateDto[];
};

export type DuplicateSuggestionDto = {
  candidateName: string;
  existingItemId: string;
  existingName: string;
  reason: "same_name" | "similar_name" | "same_normalized_name";
  confidence: number;
  candidateRisk?: SpoilageRiskDto;
  existingRisk?: SpoilageRiskDto;
  recommendation?: string;
};

export type InventoryBatchCreateResultDto = {
  items: InventoryItemDto[];
  idMap?: Record<string, string>;
  duplicateSuggestions?: DuplicateSuggestionDto[];
};

export type InventoryMergeCandidateDto = InventoryItemCreateDto & {
  candidateId?: string;
};

export type InventoryMergePreviewDto = {
  candidates: InventoryMergeCandidateDto[];
  duplicateSuggestions: DuplicateSuggestionDto[];
  mergeGroups: Array<{
    candidateName: string;
    existingItemId: string;
    existingName: string;
    suggestedQuantity: string;
    suggestedExpiresAt: string;
    recommendation: string;
  }>;
};

export type InventoryReviewStateUpdateDto = {
  reviewState: "needs_review" | "confirmed";
  reasons?: Array<
    | "low_confidence"
    | "missing_quantity"
    | "missing_expiry"
    | "ambiguous_name"
    | "duplicate_possible"
  >;
  note?: string | null;
};

export type InventoryListQuery = {
  q?: string;
  location?: StorageLocation;
  expiry?: ExpiryStatus;
  includeDiscarded?: boolean;
  sort?: "expiresAt" | "createdAt" | "name";
  direction?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};

export type InventorySelectionDto = {
  selectedIngredientIds: string[];
  updatedAt: string;
};

export type InventorySelectionUpdateDto = {
  selectedIngredientIds: string[];
};

export type InventoryDiscardRequestDto = {
  reason?: "expired" | "spoiled" | "used_up" | "mistake" | "other";
  note?: string;
};

export type InventoryDiscardResultDto = {
  itemId: string;
  status: "discarded";
  discardedAt: string;
};

export type HomeSummaryDto = {
  totalItemsCount: number;
  fridgeCount: number;
  freezerCount: number;
  roomTempCount: number;
  soonCount: number;
  overdueCount: number;
  priorityCount: number;
  todayCount: number;
  state: {
    id: "default" | "empty" | "expiring" | "overdue";
    label: string;
    title: string;
    description: string;
    tone: "ready" | "empty" | "warning" | "danger";
  };
  generatedAt: string;
};

export type ExpiryCalendarDayDto = {
  date: string;
  count: number;
  tone: "none" | "safe" | "soon" | "danger";
  representativeItemName?: string;
  itemIds: string[];
};

export type ExpiryCalendarMonthDto = {
  year: number;
  month: number;
  days: ExpiryCalendarDayDto[];
};

export type BoundingBoxDto = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SpoilageRiskDto = {
  level: "low" | "medium" | "high" | "critical";
  score: number;
  daysLeft: number;
  reasons: Array<
    | "expires_soon"
    | "expired"
    | "room_temp_sensitive"
    | "short_fridge_life"
    | "freezer_safe"
    | "low_confidence"
    | "image_quality_warning"
    | "hot_weather"
    | "humid_weather"
    | "warm_season"
    | "weather_unavailable"
  >;
  recommendation: string;
};

export type WeatherSeasonDto = "spring" | "summer" | "autumn" | "winter";

export type SpoilageWeatherContextDto = {
  observedAt: string;
  source: "open_meteo" | "seasonal_fallback";
  locationLabel: string;
  temperatureC: number;
  relativeHumidity: number;
  season: WeatherSeasonDto;
  riskLevel: "normal" | "elevated" | "high";
  freshnessWindowAdjustmentDays: number;
  recommendation: string;
};

export type InventorySpoilageRiskItemDto = {
  item: InventoryItemDto;
  spoilageRisk: SpoilageRiskDto;
  weatherImpact: {
    scoreDelta: number;
    adjustedDaysLeft: number;
    reasons: SpoilageRiskDto["reasons"];
    recommendation: string;
  };
};

export type InventorySpoilageRiskReportDto = {
  generatedAt: string;
  weather: SpoilageWeatherContextDto;
  summary: {
    totalItemsCount: number;
    highRiskCount: number;
    criticalRiskCount: number;
    weatherRiskLevel: SpoilageWeatherContextDto["riskLevel"];
    title: string;
    body: string;
  };
  items: InventorySpoilageRiskItemDto[];
};

export type LensCandidateDto = {
  id: string;
  name: string;
  quantity: string;
  location: StorageLocation;
  expiresAt: string;
  confidence?: number;
  sourceText?: string;
  normalizedName?: string;
  needsReview?: boolean;
  reviewReasons?: Array<
    | "low_confidence"
    | "missing_quantity"
    | "missing_expiry"
    | "ambiguous_name"
    | "duplicate_possible"
  >;
  boundingBox?: BoundingBoxDto;
  spoilageRisk?: SpoilageRiskDto;
};

export type LensAnalyzeMetadataDto = {
  source: "camera" | "upload" | "simulator";
  timezone: string;
  clientCapturedAt?: string;
  languageHints?: string[];
  maxCandidates?: number;
  confidenceThreshold?: number;
};

export type LensAnalyzeTextRequestDto = {
  text: string;
  timezone?: string;
  baseDate?: string;
};

export type LensAnalyzeResponseDto = {
  analysisId: string;
  status: "completed" | "needs_review";
  source: "camera" | "upload" | "simulator" | "natural_text";
  candidates: LensCandidateDto[];
  imageQuality?: {
    score: number;
    warnings: Array<"blur" | "glare" | "too_dark" | "too_far" | "rotated">;
  };
  rawText?: string;
  provider?: {
    name: string;
    model?: string;
    latencyMs?: number;
  };
};

export type LensMode = "receipt" | "fridge";

export type LensAnalyzeJobDto = {
  analysisId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  result?: LensAnalyzeResponseDto;
  error?: ProblemDetailsDto;
};

export type RecipeIngredientDto = {
  name: string;
  quantity: string;
  avatar: string;
};

export type RecipeCardDto = {
  id: string;
  ingredients: RecipeIngredientDto[];
  name: string;
  saved: boolean;
  time: string;
};

export type RecipeStepDto = {
  order: number;
  description: string;
  durationMinutes?: number;
};

export type RecipeNutritionDto = Partial<{
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
}>;

export type RecipeDto = RecipeCardDto & {
  description?: string;
  imageUrl?: string;
  timeMinutes?: number;
  servings?: number;
  difficulty?: "easy" | "medium" | "hard";
  tags?: string[];
  dietaryFlags?: string[];
  steps?: RecipeStepDto[];
  nutrition?: RecipeNutritionDto;
  createdAt?: string;
  updatedAt?: string;
};

export type RecipeIngredientMatchStatus = "selected" | "owned" | "missing";

export type RecipeIngredientMatchDto = RecipeIngredientDto & {
  status: RecipeIngredientMatchStatus;
  itemId: string | null;
};

export type RecipeMatchDto = {
  ingredients: RecipeIngredientMatchDto[];
  selectedCount: number;
  ownedCount: number;
  totalCount: number;
  matchPercentage: number;
};

export type RecipeRecommendationDto = {
  recipe: RecipeDto;
  match: RecipeMatchDto;
  rank: number;
  reasons: string[];
};

export type RecipeListQuery = {
  mode?: "recommend" | "saved";
  selectedIngredientIds?: string[];
  conditions?: RecipeConditionKey[];
  q?: string;
  cursor?: string;
  limit?: number;
};

export type RecipeImportRequestDto = {
  url: string;
  selectedIngredientIds?: string[];
};

export type RecipeConsumeRequestDto = {
  selectedIngredientIds?: string[];
  consumedAt?: string;
  strategy?: "frontend_label_compat" | "explicit_amounts";
  explicitAmounts?: Array<{
    itemId: string;
    quantity: string;
  }>;
};

export type RecipeConsumeResultDto = {
  recipeId: string;
  consumedAt: string;
  updatedItems: InventoryItemDto[];
  removedItemIds: string[];
  selectedIngredientIds: string[];
  consumptionLogId: string;
  needsReview?: Array<{
    itemId: string;
    reason: "ambiguous_quantity" | "insufficient_quantity" | "not_matched";
  }>;
};

export type RecipeConsumptionLogDto = {
  id: string;
  recipeId: string;
  recipeName: string;
  consumedAt: string;
  selectedIngredientIds: string[];
  updatedItemIds: string[];
  removedItemIds: string[];
};

export type RecipePreferenceDto = {
  excludedIngredients: string[];
  dislikedFoods: string[];
  allergies: string[];
  preferredCookTimeMinutes?: number;
  mildFlavorPreferred?: boolean;
  recentMeals: RecipeConsumptionLogDto[];
};

export type RecipePreferenceUpdateDto = Partial<{
  excludedIngredients: string[];
  dislikedFoods: string[];
  allergies: string[];
  preferredCookTimeMinutes: number | null;
  mildFlavorPreferred: boolean | null;
}>;

export type RecipeFeedbackDto = {
  accepted: true;
  recipeId: string;
  action: "cooked" | "not_today" | "disliked";
  updatedPreferences?: RecipePreferenceDto;
};

export type RecipeFeedbackRequestDto = {
  action: "cooked" | "not_today" | "disliked";
  ingredientNames?: string[];
  note?: string;
};

export type HouseholdDto = {
  id: string;
  name: string;
  memberCount: number;
  timezone: string;
  defaultStorageLocation: StorageLocation;
  createdAt: string;
  updatedAt: string;
};

export type UserProfileDto = {
  id: string;
  householdId: string;
  nickname: string;
  email?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type DietaryPreferenceDto = {
  excludedIngredients: string[];
  dislikedFoods: string[];
  allergies: string[];
  preferredCookTimeMinutes?: number;
  mildFlavorPreferred?: boolean;
};

export type NotificationPreferenceDto = {
  expiryReminderEnabled: boolean;
  expiryReminderDaysBefore: number[];
  expiryReminderTime: string;
  recipeConsumeReminderEnabled: boolean;
  reviewPendingReminderEnabled: boolean;
  quietHours?: {
    start: string;
    end: string;
  };
};

export type HouseholdSettingsDto = {
  household: HouseholdDto;
  profile: UserProfileDto;
  dietary: DietaryPreferenceDto;
  notifications: NotificationPreferenceDto;
};

export type ClientPreferenceDto = {
  theme?: "light" | "dark" | "system";
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: string | null;
};

export type PushSubscriptionDto = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type PushSubscriptionUpsertRequestDto = {
  subscription: PushSubscriptionDto;
  userAgent?: string;
  timezone: string;
  deviceLabel?: string;
};

export type PushSubscriptionRecordDto = {
  id: string;
  endpoint: string;
  expirationTime: number | null;
  userAgent?: string;
  timezone: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
};

export type PushPayload = {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
};

export type NotificationPreferenceUpdateDto = Partial<{
  expiryReminderEnabled: boolean;
  expiryReminderDaysBefore: number[];
  expiryReminderTime: string;
  recipeConsumeReminderEnabled: boolean;
  reviewPendingReminderEnabled: boolean;
  quietHours: { start: string; end: string } | null;
}>;

export type NotificationPreferenceResponseDto = NotificationPreferenceDto & {
  recommendedTime: string;
  recommendationReason: string;
};

export type NotificationPreviewDto = {
  generatedAt: string;
  recommendedTime: string;
  summary: {
    todayCount: number;
    overdueCount: number;
    soonCount: number;
    needsReviewCount: number;
    title: string;
    body: string;
  };
  items: Array<{
    id: string;
    name: string;
    expiresAt: string;
    daysLeft: number;
    bucket: "today" | "overdue" | "soon";
  }>;
  nextNotifications: Array<{
    type: "expiry_reminder" | "expiry_overdue" | "today_summary" | "review_pending";
    scheduledLocalTime: string;
    title: string;
    body: string;
    tag: string;
    url: string;
  }>;
};

export type NotificationDispatchResultDto = {
  queued: true;
  dryRun: boolean;
  sent: number;
  failed: number;
  inactiveIds: string[];
  payloads: PushPayload[];
};

export type SpoilageRiskDispatchResultDto = NotificationDispatchResultDto & {
  householdsScanned: number;
  householdsNotified: number;
};

export type PrototypePersistedStateV2Dto = {
  version: 2;
  items: InventoryItemDto[];
  recipes: RecipeCardDto[];
  selectedIngredientIds: string[];
};

export type PrototypeImportRequestDto = {
  source: "prototype-store";
  clientGeneratedAt: string;
  state: PrototypePersistedStateV2Dto;
  strategy: "merge" | "replace_if_empty" | "dry_run";
};

export type PrototypeImportResultDto = {
  imported: {
    items: number;
    recipes: number;
    selectedIngredientIds: number;
  };
  idMap: {
    items: Record<string, string>;
    recipes: Record<string, string>;
  };
  skipped: Array<{
    type: "item" | "recipe" | "selection";
    clientId?: string;
    reason: string;
  }>;
};

export type SyncPullRequestDto = {
  since?: string;
  cursor?: string;
  limit?: number;
};

export type SyncPullResponseDto = {
  items: InventoryItemDto[];
  recipes: RecipeDto[];
  selectedIngredientIds: string[];
  deletedIds: {
    items: string[];
    recipes: string[];
  };
  nextCursor: string | null;
  syncToken: string;
};

export type ReadinessDto = {
  status: "ready" | "degraded" | "down";
  time: string;
  dependencies: Array<{
    name: "database" | "object_storage" | "ocr_provider" | "push_provider" | string;
    status: "ready" | "degraded" | "down";
    latencyMs?: number;
  }>;
};
