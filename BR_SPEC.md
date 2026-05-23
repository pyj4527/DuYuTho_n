# Backend Required Spec

잔반제로 frontend는 React/Vite PWA이며 현재 인벤토리, 촬영 후보, 레시피, 선택 식재료, PWA/푸시 준비 상태를 클라이언트 로컬 상태와 `localStorage`로 관리합니다. 이 문서는 **현재 구현된 기능을 그대로 백엔드/API로 연결하기 위해 백엔드가 제공해야 하는 요구사항**입니다.

> 기준 코드: `src/domain/prototype.ts`, `src/stores/usePrototypeStore.ts`, `src/screens/tabs/*`, `src/lib/lensParser.ts`, `src/lib/quantity.ts`, `src/lib/pwa.ts`, `src/sw.ts`, `src/lib/apiClient.ts`.
> 문서의 `MUST/SHOULD/MAY`는 백엔드 handoff 우선순위를 의미합니다.

## 0. Scope and priority

### P0 - frontend 기능을 실제 백엔드와 연결하기 위한 필수 계약

- `dist/` 정적 서빙, SPA fallback, PWA manifest/service worker headers.
- `/api/*` route는 SPA fallback에서 제외하고 backend API가 처리.
- 현재 frontend required DTO 필드: `InventoryItem`, `LensCandidate`, `RecipeCard`, `RecipeIngredient`, `PushSubscription`.
- 인벤토리 CRUD, 후보 일괄 등록, 레시피 추천/저장/요리 완료 차감, Web Push 구독 저장.
- RFC 9457 기반 error envelope, CORS, CSP, idempotency, upload size/type validation.

### P1 - production 운영/동기화 안정화

- `localStorage` prototype state import/migration.
- Cursor pagination, delta sync, optimistic concurrency, audit/consumption history.
- OCR/AI 분석 job 상태 조회, confidence/review workflow, duplicate merge suggestion.
- Household/profile/settings/notification preference persistence.

### P2 - 후속 고도화

- 영수증/냉장고 사진 자동 분류, 영수증 상세 파싱(구매일, 매장명, 가격), 소비기한 미정/알 수 없음 상태, 영양/알레르기/식습관 기반 레시피, 날씨/계절 기반 부패 위험도, 장보기/부족 재료 워크플로우.

## 1. API namespace, environment, and OpenAPI

Frontend API client는 `src/lib/apiClient.ts`를 통해 `/api/*` path만 호출합니다.

### Required namespace

- Backend MUST reserve `/api/*` for API routes and MUST NOT rewrite it to `index.html`.
- Recommended versioned namespace: `/api/v1/*`.
- Health endpoints MAY remain unversioned for load balancers: `/api/health`, `/api/ready`.
- If backend chooses unversioned MVP endpoints, it MUST keep future versioning migration path documented.

### Environment

```bash
VITE_API_BASE_URL=
```

- Same-origin deployment: leave `VITE_API_BASE_URL` empty and serve API under the same origin, e.g. `/api/v1/inventory`.
- Split-origin deployment: set `VITE_API_BASE_URL` to an HTTP(S) origin only, e.g. `https://api.example.com`. Path/query/hash values are rejected by frontend.
- Frontend calls still pass `/api/*`; split-origin converts to `https://api.example.com/api/*`.

### OpenAPI artifact

Backend MUST publish an OpenAPI 3.1 document:

- `GET /api/openapi.json` or `GET /api/v1/openapi.json`
- Include all request/response DTOs in this document.
- Include `application/problem+json` error responses for 4xx/5xx.
- Include `multipart/form-data` schema for image upload endpoints.

## 2. Cross-cutting wire contract

### Content types

- JSON APIs: `Content-Type: application/json; charset=utf-8`.
- Error APIs: `Content-Type: application/problem+json; charset=utf-8`.
- Image upload: `multipart/form-data`.
- All JSON responses MUST be UTF-8.

### Authentication and household model

Current UI does not implement login, but data is household-scoped (`해커톤 팀 냉장고`, `2인 가구 기준`). Backend MUST choose one of:

1. MVP anonymous household session with a stable household id; or
2. authenticated user/household membership.

All user data endpoints MUST be scoped by `householdId` on the server side. The client MUST NOT be trusted to provide someone else's `householdId` for authorization.

### Session, token, and CSRF requirements

Backend MUST define the auth/session mechanism before production API connection. The chosen model MUST meet these requirements:

- Anonymous household session ids MUST be server-generated, high-entropy, non-guessable tokens. Do not derive them from browser fingerprints, IP addresses, or user-supplied household names.
- Cookie-backed sessions MUST use `Secure`, `HttpOnly`, and explicit `SameSite` attributes. Same-origin deployments SHOULD use `SameSite=Lax` or `Strict`; split-origin cookie deployments require `SameSite=None; Secure` plus CSRF protection.
- Bearer-token deployments MUST use the `Authorization: Bearer <token>` header over HTTPS and MUST NOT place long-lived bearer tokens in query strings or logs.
- All credentialed mutating endpoints, including `multipart/form-data` upload endpoints, MUST enforce CSRF protection when cookies are used. Acceptable controls are synchronizer token/double-submit token plus Origin validation, or strict Origin/Referer validation for trusted app origins.
- CORS is not an authorization mechanism. Backend MUST reject requests from disallowed origins even if they contain valid-looking household ids.
- Session/token rotation and logout/invalidation behavior MUST be documented in the OpenAPI/security scheme description.

### ID format

- Server-generated resource ids SHOULD be UUID v7, UUID v4, or ULID strings.
- DTO field type is always `string` because current frontend ids are strings.
- Local prototype ids like `i_...`, `c_...`, `r1` MAY appear during migration import and MUST be mapped to server ids.

### Date and time

- Date-only fields such as `expiresAt` MUST use local date format `YYYY-MM-DD`.
- Datetime fields MUST use RFC 3339 UTC strings, e.g. `2026-05-22T10:00:00Z`.
- User/household timezone MUST be an IANA timezone string. Default: `Asia/Seoul`.
- Expiry calculations in the UI use local calendar dates, not UTC midnight instants.

### Idempotency

All mutating POST endpoints SHOULD accept:

```http
Idempotency-Key: <uuid-or-random-string>
```

Rules:

- Scope keys by household/user and endpoint.
- Keep replay cache for at least 24 hours.
- Replayed response SHOULD include `Idempotency-Replayed: true`.
- Same key with different body MUST return `422` problem response.

### Pagination

List endpoints that can grow SHOULD support cursor pagination.

```ts
type PageMetaDto = {
  nextCursor: string | null
  hasMore: boolean
  limit: number
}

type PageDto<T> = {
  data: T[]
  page: PageMetaDto
}
```

Rules:

- Cursor is opaque. Client must not construct it.
- Default `limit`: 50. Maximum `limit`: 100.
- Sorts involving non-unique fields MUST include a deterministic tie-breaker such as `id`.

### Error envelope

Backend MUST use RFC 9457 Problem Details for HTTP API errors.

```ts
type ProblemDetailsDto = {
  type: string // URI or URI-reference, e.g. "https://api.example.com/problems/validation-error"
  title: string
  status: number
  detail?: string
  instance?: string
  errors?: Array<{
    pointer: string // JSON Pointer, e.g. "#/quantity"
    detail: string
    code?: string
  }>
  requestId?: string
}
```

Required status mapping:

| Status | Use case |
| --- | --- |
| `400` | malformed JSON, malformed query, invalid multipart boundary |
| `401` | unauthenticated when auth is enabled |
| `403` | authenticated but not allowed for household/resource |
| `404` | resource not found or hidden by authorization |
| `409` | edit conflict, duplicate resource conflict, stale version |
| `413` | image upload too large |
| `415` | unsupported image/content type |
| `422` | validation/domain rule failure |
| `429` | rate limit |
| `500` | unexpected server error without leaking internals |
| `503` | OCR/AI/push provider unavailable |

## 3. Shared enums and primitive schemas

These values are currently hard-coded in the frontend and MUST be preserved unless frontend is updated.

```ts
type StorageLocation = '냉장' | '냉동' | '실온'

type ExpiryStatus = 'safe' | 'soon' | 'overdue'
// safe: daysLeft > 2, soon: 0 <= daysLeft <= 2, overdue: daysLeft < 0

type CapabilityStatus =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'active'
  | 'blocked'
  | 'unsupported'
  | 'error'

type InventorySource =
  | 'manual'
  | 'lens_image'
  | 'lens_upload'
  | 'lens_text'
  | 'migration'
  | 'seed'

type InventoryItemStatus = 'active' | 'consumed' | 'discarded'

type RecipeConditionKey =
  | 'under_15_min'
  | 'no_heat'
  | 'kid_friendly'
  | 'prioritize_expiring'
```

### Quantity label compatibility

Current frontend stores quantities as display labels, not structured numbers.

```ts
type QuantityLabel = string // examples: "1모", "1/2개", "180g", "8장", "1팩"
```

Backend MUST accept and return `quantity: string` for compatibility.

Supported units currently parsed by frontend:

```ts
type QuantityUnit = 'g' | 'kg' | '개' | '팩' | '송이' | '장' | '알' | '모' | '봉' | '병' | '캔' | string
```

Backend SHOULD additionally keep structured quantity internally:

```ts
type QuantityDto = {
  label: string
  amount?: number
  unit?: QuantityUnit
}
```

Validation requirements:

- `quantity` label MUST be non-empty.
- If client sends blank amount, frontend defaults to `1`.
- Fraction labels like `1/2개` MAY be normalized to decimal internally, but response MUST preserve user-friendly label.

## 4. Inventory requirements

Implemented frontend flows:

- list all items
- search by name
- filter by `전체`, `냉장`, `냉동`, `실온`, `임박`
- add item manually
- edit `name`, `quantity`, `location`, `expiresAt`
- delete/discard item
- select items for recipe matching
- consume recipe and reduce/remove matching inventory quantities
- show home counts and expiry calendar from inventory data

### InventoryItemDto

Frontend-required fields are marked required.

```ts
type InventoryItemDto = {
  id: string // required
  name: string // required, non-empty
  quantity: string // required display label
  location: StorageLocation // required
  expiresAt: string // required YYYY-MM-DD

  // backend-supported metadata
  status?: InventoryItemStatus
  source?: InventorySource
  category?: string | null
  memo?: string | null
  createdAt?: string
  updatedAt?: string
  discardedAt?: string | null
  consumedAt?: string | null
  version?: number
}
```

Validation:

- `name`: trim, 1-80 chars.
- `location`: one of `냉장`, `냉동`, `실온`.
- `expiresAt`: valid calendar date in `YYYY-MM-DD`; reject impossible dates like `2026-02-30`.
- Duplicate names are allowed initially because frontend currently has no merge UI. Backend MAY return duplicate suggestions but MUST NOT silently merge without user confirmation.

### Inventory create/update DTOs

```ts
type InventoryItemCreateDto = {
  name: string
  quantity: string
  location: StorageLocation
  expiresAt: string
  source?: InventorySource
  clientRequestId?: string
}

type InventoryItemPatchDto = Partial<{
  name: string
  quantity: string
  location: StorageLocation
  expiresAt: string
  status: InventoryItemStatus
  memo: string | null
}>

type InventoryBatchCreateDto = {
  source: 'lens_image' | 'lens_upload' | 'lens_text' | 'manual' | 'migration'
  analysisId?: string
  items: InventoryItemCreateDto[]
}

type InventoryBatchCreateResultDto = {
  items: InventoryItemDto[]
  idMap?: Record<string, string> // client/local id -> server id
  duplicateSuggestions?: DuplicateSuggestionDto[]
}

type DuplicateSuggestionDto = {
  candidateName: string
  existingItemId: string
  existingName: string
  reason: 'same_name' | 'similar_name' | 'same_normalized_name'
  confidence: number // 0..1
}
```

Defaults and compatibility:

- If `source` is omitted on manual add, backend MUST store `source: 'manual'`.
- `InventoryItemPatchDto.status` and `memo` are backend-supported future fields. Current frontend edit UI only sends `name`, `quantity`, `location`, and `expiresAt`.

### Inventory endpoints

| Method | Path | Purpose | Request | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/inventory` | list/search/filter inventory | query below | `PageDto<InventoryItemDto>` or `InventoryItemDto[]` for MVP |
| `POST` | `/api/v1/inventory` | manual add | `InventoryItemCreateDto` | `201 InventoryItemDto` |
| `POST` | `/api/v1/inventory/batch` | lens/manual batch confirm | `InventoryBatchCreateDto` | `201 InventoryBatchCreateResultDto` |
| `GET` | `/api/v1/inventory/{itemId}` | item detail | - | `InventoryItemDto` |
| `PATCH` | `/api/v1/inventory/{itemId}` | edit item | `InventoryItemPatchDto` | `InventoryItemDto` |
| `DELETE` | `/api/v1/inventory/{itemId}` | discard/delete | optional discard body | `204` or `InventoryDiscardResultDto` |
| `PUT` | `/api/v1/inventory/selections` | persist recipe matching selections | `InventorySelectionUpdateDto` | `InventorySelectionDto` |

Query parameters for `GET /api/v1/inventory`:

```ts
type InventoryListQuery = {
  q?: string
  location?: StorageLocation
  expiry?: 'soon' | 'overdue' | 'safe'
  includeDiscarded?: boolean
  sort?: 'expiresAt' | 'createdAt' | 'name'
  direction?: 'asc' | 'desc'
  cursor?: string
  limit?: number
}
```

Selection DTO:

```ts
type InventorySelectionDto = {
  selectedIngredientIds: string[]
  updatedAt: string
}

type InventorySelectionUpdateDto = {
  selectedIngredientIds: string[]
}
```

Discard DTO:

```ts
type InventoryDiscardRequestDto = {
  reason?: 'expired' | 'spoiled' | 'used_up' | 'mistake' | 'other'
  note?: string
}

type InventoryDiscardResultDto = {
  itemId: string
  status: 'discarded'
  discardedAt: string
}
```

### Recipe consumption quantity reduction

Current frontend uses label-based reduction in `reduceQuantityLabel`:

- `200g` -> remaining `Math.round(200 * 0.65)`, delete if remaining `< 50g`.
- `2개`, `2팩`, `2송이`, `2장`, `2알`, `2모` -> decrement by `1`.
- `1개`, `1팩`, `1송이`, `1장`, `1알`, `1모` -> remove item.
- Fractional labels like `1/2개` currently remove item.

Backend SHOULD own this logic for consistency after API connection. If backend cannot safely infer quantity, it SHOULD return a `needsReview` consumption result instead of silently deleting.

## 5. Home dashboard requirements

Frontend can compute home state from inventory, but backend SHOULD provide a summary endpoint to avoid large client-side scans after real data grows.

### HomeSummaryDto

```ts
type HomeSummaryDto = {
  totalItemsCount: number
  fridgeCount: number
  freezerCount: number
  roomTempCount: number
  soonCount: number // 0 <= daysLeft <= 2
  overdueCount: number // daysLeft < 0
  priorityCount: number // soonCount + overdueCount
  todayCount: number // daysLeft === 0
  state: {
    id: 'default' | 'empty' | 'expiring' | 'overdue'
    label: string
    title: string
    description: string
    tone: 'ready' | 'empty' | 'warning' | 'danger'
  }
  generatedAt: string
}

type ExpiryCalendarDayDto = {
  date: string // YYYY-MM-DD
  count: number
  tone: 'none' | 'safe' | 'soon' | 'danger'
  representativeItemName?: string
  itemIds: string[]
}

type ExpiryCalendarMonthDto = {
  year: number
  month: number // 1..12
  days: ExpiryCalendarDayDto[]
}
```

### Home endpoints

| Method | Path | Purpose | Response |
| --- | --- | --- | --- |
| `GET` | `/api/v1/home/summary` | dashboard counts/state | `HomeSummaryDto` |
| `GET` | `/api/v1/home/expiry-calendar?year=2026&month=5` | monthly expiry calendar | `ExpiryCalendarMonthDto` |

## 6. Lens / camera / OCR requirements

Implemented frontend flows:

- real camera preview via `getUserMedia`
- photo file upload (`accept="image/*"`)
- simulator capture
- natural language input, e.g. `두부 한 모 냉장 3일`
- analysis progress screen
- candidate list with edit/exclude/swipe-remove
- batch confirm into inventory

### Camera/browser support requirements

Backend/reverse proxy MUST support frontend camera API by serving secure origin:

- Production MUST be HTTPS.
- `Permissions-Policy: camera=(self), microphone=(), geolocation=()` MUST NOT be removed by proxy.
- If embedded in iframe, parent MUST use `allow="camera"`; otherwise default CSP `frame-ancestors 'none'` prevents embedding.
- Camera permission prompt must only happen after user action; frontend already follows this.

### LensCandidateDto

Frontend-required fields:

```ts
type LensCandidateDto = {
  id: string
  name: string
  quantity: string
  location: StorageLocation
  expiresAt: string // YYYY-MM-DD

  // strongly recommended backend fields
  confidence?: number // 0..1, e.g. 0.92 means 92% display confidence
  sourceText?: string
  normalizedName?: string
  needsReview?: boolean
  reviewReasons?: Array<'low_confidence' | 'missing_quantity' | 'missing_expiry' | 'ambiguous_name' | 'duplicate_possible'>
  boundingBox?: BoundingBoxDto
}

type BoundingBoxDto = {
  x: number // 0..1
  y: number // 0..1
  width: number // 0..1
  height: number // 0..1
}
```

Candidate validation:

- Backend MUST always return `name`, `quantity`, `location`, `expiresAt` for candidates shown in the current UI.
- If unknown, use safe defaults and mark `needsReview: true`:
  - `quantity`: `1개` or ingredient-specific default.
  - `location`: `냉장`.
  - `expiresAt`: current local date + 3 days.
- `confidence` MUST be numeric `0..1`. The UI displays it as `Math.round(confidence * 100)%`; backend MUST NOT send `92` for 92%.

### Natural text parsing requirements

Current local parser supports:

- Korean counts: `한 모`, `두 개`, `세 팩` -> `1모`, `2개`, `3팩`.
- Units: `g`, `kg`, `개`, `팩`, `송이`, `장`, `알`, `모`, `봉`, `병`, `캔`.
- Locations: `냉장`, `냉동`, `실온`.
- Relative expiry: `3일`, `14일`, `D-3`, `3 days`.
- Absolute expiry: `YYYY-MM-DD`.

Backend text analyzer SHOULD preserve these rules and may improve them.

### Lens request/response DTOs

```ts
type LensAnalyzeMetadataDto = {
  source: 'camera' | 'upload' | 'simulator'
  timezone: string // IANA, default Asia/Seoul
  clientCapturedAt?: string
  languageHints?: string[] // e.g. ['ko', 'en']
  maxCandidates?: number
  confidenceThreshold?: number // 0..1
}

type LensAnalyzeTextRequestDto = {
  text: string
  timezone?: string
  baseDate?: string // YYYY-MM-DD, defaults to server/client today in timezone
}

type LensAnalyzeResponseDto = {
  analysisId: string
  status: 'completed' | 'needs_review'
  source: 'camera' | 'upload' | 'simulator' | 'natural_text'
  candidates: LensCandidateDto[]
  imageQuality?: {
    score: number // 0..1
    warnings: Array<'blur' | 'glare' | 'too_dark' | 'too_far' | 'rotated'>
  }
  rawText?: string
  provider?: {
    name: string
    model?: string
    latencyMs?: number
  }
}

type LensAnalyzeJobDto = {
  analysisId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress?: number // 0..100
  result?: LensAnalyzeResponseDto
  error?: ProblemDetailsDto
}
```

### Lens endpoints

| Method | Path | Purpose | Request | Response |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/lens/analyze-image` | OCR/AI from camera/upload image | `multipart/form-data` | `200 LensAnalyzeResponseDto` or `202 LensAnalyzeJobDto` |
| `POST` | `/api/v1/lens/analyze-text` | natural language parse/normalize | `LensAnalyzeTextRequestDto` | `LensAnalyzeResponseDto` |
| `GET` | `/api/v1/lens/analyses/{analysisId}` | fetch async result | - | `LensAnalyzeJobDto` or `LensAnalyzeResponseDto` |

Multipart fields for image analysis:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `image` | binary | yes | JPEG/PNG/WebP/HEIC image |
| `metadata` | JSON string | no | `LensAnalyzeMetadataDto` |

Upload limits:

- Max image size: 10 MB for MVP.
- Accepted MIME: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`.
- Backend MUST validate MIME by magic bytes, not only client header.
- Backend MUST decode images with safe decoder settings and reject decompression bombs or images exceeding configured pixel/dimension limits. Suggested MVP limit: max 24 megapixels and max 8192 px per side.
- Return `413` for too large and `415` for unsupported media.

## 7. Recipe requirements

Implemented frontend flows:

- list recommended recipes and saved recipes
- filter by conditions
- rank by selected/owned ingredient match percentage
- display recipe ingredients with `selected`, `owned`, `missing` status
- save/unsave recipe
- recipe detail with ingredients and cooking steps
- complete recipe and reduce/remove matching inventory items

### Recipe DTOs

Frontend-required shape:

```ts
type RecipeIngredientDto = {
  name: string
  quantity: string
  avatar: string // emoji or small display token, e.g. "🥬"
}

type RecipeCardDto = {
  id: string
  ingredients: RecipeIngredientDto[]
  name: string
  saved: boolean
  time: string // display label, e.g. "15분"
}
```

Compatibility requirements:

- `time` is required for current frontend display and MUST remain a Korean minute label that starts with a parseable integer, e.g. `"15분"`, unless frontend filtering is updated.
- Backend SHOULD additionally provide `timeMinutes` so the `under_15_min` condition can be evaluated without parsing display text.

Backend SHOULD support richer fields while preserving frontend-required fields:

```ts
type RecipeDto = RecipeCardDto & {
  description?: string
  imageUrl?: string
  timeMinutes?: number
  servings?: number
  difficulty?: 'easy' | 'medium' | 'hard'
  tags?: string[]
  dietaryFlags?: string[]
  steps?: RecipeStepDto[]
  nutrition?: RecipeNutritionDto
  createdAt?: string
  updatedAt?: string
}

type RecipeStepDto = {
  order: number
  description: string
  durationMinutes?: number
}

type RecipeNutritionDto = Partial<{
  caloriesKcal: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  sodiumMg: number
}>
```

### Recipe matching DTOs

```ts
type RecipeIngredientMatchStatus = 'selected' | 'owned' | 'missing'

type RecipeIngredientMatchDto = RecipeIngredientDto & {
  status: RecipeIngredientMatchStatus
  itemId: string | null
}

type RecipeMatchDto = {
  ingredients: RecipeIngredientMatchDto[]
  selectedCount: number
  ownedCount: number
  totalCount: number
  matchPercentage: number // integer 0..100
}

type RecipeRecommendationDto = {
  recipe: RecipeDto
  match: RecipeMatchDto
  rank: number
  reasons: string[]
}
```

Matching rules to preserve current UI behavior:

- Ingredient match is currently case-insensitive substring match in both directions.
- `selected` outranks `owned`; selected recipes sort first by selectedCount, then matchPercentage.
- `임박 식재료 최우선` means at least one recipe ingredient matches an inventory item with `0 <= daysLeft <= 2`.

### Recipe endpoints

| Method | Path | Purpose | Request/query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/recipes` | list recipes | query below | `PageDto<RecipeRecommendationDto>` or `RecipeRecommendationDto[]` |
| `GET` | `/api/v1/recipes/{recipeId}` | recipe detail | selected item ids optional | `RecipeRecommendationDto` |
| `PUT` | `/api/v1/recipes/{recipeId}/saved` | save/unsave | `{ saved: boolean }` | `RecipeDto` |
| `POST` | `/api/v1/recipes/{recipeId}/consume` | complete recipe and reduce inventory | `RecipeConsumeRequestDto` | `RecipeConsumeResultDto` |

Recipe list query:

```ts
type RecipeListQuery = {
  mode?: 'recommend' | 'saved'
  selectedIngredientIds?: string[]
  conditions?: RecipeConditionKey[]
  q?: string
  cursor?: string
  limit?: number
}
```

Condition mapping:

| UI label | API key | Required behavior |
| --- | --- | --- |
| `15분 이하 요리` | `under_15_min` | `timeMinutes <= 15` or parse `time` |
| `불 없이 간편하게` | `no_heat` | recipe tagged no-heat/simple |
| `아이용 순한 맛` | `kid_friendly` | recipe tagged mild/kid-friendly |
| `임박 식재료 최우선` | `prioritize_expiring` | prioritize recipes using soon items |

Consumption DTO:

```ts
type RecipeConsumeRequestDto = {
  selectedIngredientIds?: string[]
  consumedAt?: string
  strategy?: 'frontend_label_compat' | 'explicit_amounts'
  explicitAmounts?: Array<{
    itemId: string
    quantity: string
  }>
}

type RecipeConsumeResultDto = {
  recipeId: string
  consumedAt: string
  updatedItems: InventoryItemDto[]
  removedItemIds: string[]
  selectedIngredientIds: string[]
  consumptionLogId: string
  needsReview?: Array<{
    itemId: string
    reason: 'ambiguous_quantity' | 'insufficient_quantity' | 'not_matched'
  }>
}
```

If `strategy` is omitted, backend MUST default to `frontend_label_compat` to preserve the current frontend `consumeRecipe` behavior.

Consumption history SHOULD be queryable for future My/history surfaces:

```ts
type RecipeConsumptionLogDto = {
  id: string
  recipeId: string
  recipeName: string
  consumedAt: string
  selectedIngredientIds: string[]
  updatedItemIds: string[]
  removedItemIds: string[]
}
```

| Method | Path | Purpose | Response |
| --- | --- | --- | --- |
| `GET` | `/api/v1/recipes/consumption-logs` | recent cooking/consumption history | `PageDto<RecipeConsumptionLogDto>` |

## 8. Profile, household, and settings requirements

Current My tab shows household profile and disabled settings groups. Backend SHOULD support these schemas so settings can be enabled without redesign.

```ts
type HouseholdDto = {
  id: string
  name: string // current display: "해커톤 팀 냉장고"
  memberCount: number // current display: 2
  timezone: string // default Asia/Seoul
  defaultStorageLocation: StorageLocation
  createdAt: string
  updatedAt: string
}

type UserProfileDto = {
  id: string
  householdId: string
  nickname: string
  email?: string
  avatarUrl?: string
  createdAt: string
  updatedAt: string
}

type DietaryPreferenceDto = {
  excludedIngredients: string[]
  dislikedFoods: string[]
  allergies: string[]
  preferredCookTimeMinutes?: number
  mildFlavorPreferred?: boolean
}

type NotificationPreferenceDto = {
  expiryReminderEnabled: boolean
  expiryReminderDaysBefore: number[] // e.g. [2, 0]
  expiryReminderTime: string // HH:mm local time
  recipeConsumeReminderEnabled: boolean
  reviewPendingReminderEnabled: boolean
  quietHours?: {
    start: string // HH:mm
    end: string // HH:mm
  }
}

type HouseholdSettingsDto = {
  household: HouseholdDto
  profile: UserProfileDto
  dietary: DietaryPreferenceDto
  notifications: NotificationPreferenceDto
}

type ClientPreferenceDto = {
  theme?: 'light' | 'dark' | 'system'
  onboardingCompleted?: boolean
  onboardingCompletedAt?: string | null
}
```

`ClientPreferenceDto` is P1/P2 sync support. Current frontend keeps theme in browser storage and onboarding is prototype content; backend persistence is optional until cross-device preference sync is enabled.

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/me` | current user/profile/household summary |
| `PATCH` | `/api/v1/me/profile` | update nickname/avatar/email fields |
| `GET` | `/api/v1/household/settings` | fetch settings |
| `PATCH` | `/api/v1/household/settings` | update default storage, household size, dietary/notification settings |
| `PATCH` | `/api/v1/me/client-preferences` | sync theme/onboarding preferences |

## 9. PWA and Web Push requirements

Current frontend can register a service worker, request notification permission, create a `PushSubscription`, and show a local test notification. Backend is responsible for VAPID, subscription persistence, push delivery, and scheduling.

### VAPID

Backend MUST:

- Generate ECDSA P-256 VAPID key pair.
- Store private key in secret manager/env, never in frontend repo.
- Provide public key to frontend build env (`VITE_VAPID_PUBLIC_KEY`) or via runtime config endpoint.
- Use VAPID auth when sending to push services.

Optional endpoint:

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/v1/push/vapid-public-key` | `{ publicKey: string }` |

### PushSubscriptionDto

Browser `PushSubscription.toJSON()` returns `endpoint`, `expirationTime`, and `keys`.

```ts
type PushSubscriptionDto = {
  endpoint: string
  expirationTime: number | null
  keys: {
    p256dh: string
    auth: string
  }
}

type PushSubscriptionUpsertRequestDto = {
  subscription: PushSubscriptionDto
  userAgent?: string
  timezone: string
  deviceLabel?: string
}

type PushSubscriptionRecordDto = {
  id: string
  endpoint: string
  expirationTime: number | null
  userAgent?: string
  timezone: string
  active: boolean
  createdAt: string
  updatedAt: string
  lastSuccessAt?: string
  lastFailureAt?: string
}
```

Validation:

- `endpoint` MUST be an HTTPS URL.
- `keys.p256dh` and `keys.auth` MUST be non-empty URL-safe base64 strings.
- Store one record per `(household/user, endpoint)` and upsert if repeated.
- Treat `endpoint` as sensitive capability URL; do not log full value.

Endpoints:

| Method | Path | Purpose | Request | Response |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/push/subscriptions` | register/upsert subscription | `PushSubscriptionUpsertRequestDto` | `201/200 PushSubscriptionRecordDto` |
| `GET` | `/api/v1/push/subscriptions` | list current user's devices | - | `PushSubscriptionRecordDto[]` |
| `DELETE` | `/api/v1/push/subscriptions/{subscriptionId}` | disable subscription | - | `204` |
| `POST` | `/api/v1/push/test` | send server-side test push | `{ subscriptionId?: string }` | `{ queued: true }` |

### Push payload contract

Service worker accepts the following payload and sanitizes external/malformed URLs.

```ts
type PushPayload = {
  title?: string
  body?: string
  icon?: string // same-origin asset path only, e.g. "/icon.png"
  badge?: string // same-origin asset path only; current frontend defaults to "/icon.png" if omitted
  tag?: string
  url?: string // same-origin client path only, e.g. "/inventory"
}
```

Backend MUST send JSON payloads matching this shape. Requirements:

- `url` MUST be a same-origin client path. External origins are discarded by frontend.
- `icon` MUST be a same-origin asset path. External origins are discarded by frontend.
- `badge`, if supported by the connected frontend build, MUST follow the same same-origin asset-path rule. Current service worker uses `/icon.png` as the default badge.
- Malformed payloads degrade to default title/body; backend should still validate before sending.
- Suggested `tag` values: `expiry-reminder`, `expiry-overdue`, `recipe-suggestion`, `review-pending`.

### Notification scheduling

Backend SHOULD implement scheduled jobs for:

- expiry reminders: D-2, D-0, overdue D+1 according to household preferences.
- recipe suggestions when multiple soon/overdue items exist.
- review pending reminders for low-confidence OCR candidates, if async approval is introduced.

```ts
type ScheduledNotificationDto = {
  id: string
  type: 'expiry_reminder' | 'expiry_overdue' | 'recipe_suggestion' | 'review_pending'
  scheduledAt: string // UTC
  timezone: string
  payload: PushPayload
  status: 'scheduled' | 'sent' | 'failed' | 'cancelled'
}
```

If push service returns `404`/`410` for an expired subscription, backend MUST mark the subscription inactive.

## 10. Sync and localStorage migration requirements

Current persisted frontend state name/version:

- Zustand persist key: `prototype-store`
- Version: `2`
- Persisted fields: `items`, `recipes`, `selectedIngredientIds`

Backend SHOULD provide a one-time import endpoint so existing prototype users do not lose data.

```ts
type PrototypePersistedStateV2Dto = {
  version: 2
  items: InventoryItemDto[]
  recipes: RecipeCardDto[]
  selectedIngredientIds: string[]
}

type PrototypeImportRequestDto = {
  source: 'prototype-store'
  clientGeneratedAt: string
  state: PrototypePersistedStateV2Dto
  strategy: 'merge' | 'replace_if_empty' | 'dry_run'
}

type PrototypeImportResultDto = {
  imported: {
    items: number
    recipes: number
    selectedIngredientIds: number
  }
  idMap: {
    items: Record<string, string>
    recipes: Record<string, string>
  }
  skipped: Array<{
    type: 'item' | 'recipe' | 'selection'
    clientId?: string
    reason: string
  }>
}
```

Endpoint:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/sync/import-prototype-state` | migrate local prototype data |

Delta sync SHOULD use:

```ts
type SyncPullRequestDto = {
  since?: string
  cursor?: string
  limit?: number
}

type SyncPullResponseDto = {
  items: InventoryItemDto[]
  recipes: RecipeDto[]
  selectedIngredientIds: string[]
  deletedIds: {
    items: string[]
    recipes: string[]
  }
  nextCursor: string | null
  syncToken: string
}
```

## 11. Static serving and PWA hosting contract

Frontend build 산출물은 `bun run build` 후 생성되는 `dist/`입니다. 기본 배포 계약은 **root path(`/`) 서빙**입니다.

### Required routing

| Request | Response |
| --- | --- |
| `GET /` | `dist/index.html` |
| SPA deep link such as `/inventory`, `/recipes`, `/lens/*` | `dist/index.html` |
| `GET /assets/*` | actual hashed asset file, 404 if missing |
| `GET /manifest.webmanifest` | manifest file |
| `GET /sw.js` | service worker file |
| `GET /icon.png`, `/icon-192.png`, `/icon-512.png`, `/icon.svg`, `/text.svg` | public assets |
| `/api/*` | backend route, never frontend fallback |

Sub-path deployment such as `/app/` is not the current contract. If needed, backend and frontend must change all of Vite `base`, PWA manifest `scope/start_url`, service worker path/scope, and rewrite rules together.

### Required production headers

```http
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=()
```

HTTPS production:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

`/sw.js`:

```http
Service-Worker-Allowed: /
```

Recommended CSP for current `index.html` inline theme bootstrap and Google Fonts:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

### Required MIME and cache policy

| Path | MIME | Cache-Control |
| --- | --- | --- |
| `/index.html` | `text/html; charset=utf-8` | `no-cache, no-store, must-revalidate` or at least `no-cache` |
| `/sw.js` | `text/javascript` or `application/javascript` | `no-cache, no-store, must-revalidate` |
| `/manifest.webmanifest` | `application/manifest+json` | `no-cache` or short TTL |
| `/assets/*` | correct JS/CSS MIME | `public, max-age=31536000, immutable` |
| `/icon*.png` | `image/png` | short TTL or versioned long TTL |
| `/icon.svg`, `/text.svg` | `image/svg+xml` | short TTL or versioned long TTL |

Backend release gate MUST run:

```bash
bun run lint
bun run test
bun run build
bun run qa:production
```

`bun run qa:production` verifies SPA fallback, PWA assets, `/api/*` exclusion, missing asset 404, service worker headers, and camera `Permissions-Policy` reference headers.

## 12. CORS requirements

Same-origin deployment is preferred. For split-origin API deployments, backend MUST support preflight.

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, Idempotency-Key, If-Match
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
Vary: Origin
```

Rules:

- Do not use `Access-Control-Allow-Origin: *` with credentials.
- `OPTIONS` preflight for `/api/*` must not redirect.
- If using bearer auth only and no cookies, credentials can be disabled, but CORS headers must still allow `Authorization`.

## 13. Health, readiness, and observability

Endpoints:

| Method | Path | Purpose | Response |
| --- | --- | --- | --- |
| `GET` | `/api/health` | liveness | `{ status: 'ok', time: string }` |
| `GET` | `/api/ready` | readiness with dependencies | `ReadinessDto` |

```ts
type ReadinessDto = {
  status: 'ready' | 'degraded' | 'down'
  time: string
  dependencies: Array<{
    name: 'database' | 'object_storage' | 'ocr_provider' | 'push_provider' | string
    status: 'ready' | 'degraded' | 'down'
    latencyMs?: number
  }>
}
```

Backend SHOULD include `X-Request-Id` on all responses and log it with errors. Problem responses SHOULD include the same `requestId`.

## 14. Security and privacy requirements

- Image uploads may contain private household/receipt data. Store with private ACL by default and encrypt at rest when storage supports it.
- Do not log raw push endpoints, raw VAPID private keys, full OCR text, provider payloads, or image URLs with long-lived signed tokens.
- Uploaded images, raw OCR text, provider request/response bodies, and signed URLs MUST have a retention/deletion policy. Suggested MVP retention: delete raw uploads and provider payloads within 30 days unless the user explicitly saves them.
- Signed image/object URLs MUST be short-lived. Suggested max TTL: 15 minutes.
- Validate image content by magic bytes and strip EXIF metadata before provider upload/storage unless the provider contract explicitly requires it.
- Push payload URL, icon, and badge must be same-origin client paths.
- Authorization must be enforced server-side by household/user membership.
- Rate limits MUST be stricter for OCR/image endpoints than plain JSON endpoints and MUST return `429` Problem Details with `Retry-After` when exceeded.
- Required abuse limits:
  - Lens image analyze: max 30 requests/hour/household and an additional IP/session fallback limit for anonymous users.
  - Lens text analyze: max 120 requests/hour/household and an additional IP/session fallback limit for anonymous users.
  - Push test: max 10 requests/hour/user.
  - Prototype import: max 20 requests/day/household.
  - Session/household creation, if anonymous: rate-limit by IP and coarse request metadata without turning that metadata into stable tracking identifiers.

## 15. Backend handoff checklist

- [ ] Static `dist/` root serving configured.
- [ ] SPA deep links rewrite to `index.html`.
- [ ] `/api/*` and missing static assets do not rewrite to `index.html`.
- [ ] HTTPS redirect, HSTS, CSP, CORS, `Permissions-Policy` configured.
- [ ] Session/token model, CSRF/Origin checks, and authZ scoping implemented.
- [ ] `/sw.js` served with no-cache and `Service-Worker-Allowed: /`.
- [ ] `manifest.webmanifest` served as `application/manifest+json`.
- [ ] OpenAPI 3.1 published.
- [ ] RFC 9457 problem responses implemented.
- [ ] Inventory CRUD and batch create implemented.
- [ ] Lens image/text analyze returns frontend-required candidate fields.
- [ ] Recipe recommendation/save/consume implemented.
- [ ] Web Push VAPID key and subscription persistence implemented.
- [ ] Mandatory OCR/upload/push-test/import rate limits implemented.
- [ ] Prototype localStorage import/migration endpoint implemented or explicitly deferred.
- [ ] Health/readiness endpoints implemented.
- [ ] Release gate includes `bun run qa:production`.

## 16. Minimum smoke scenarios after backend connection

1. HTTPS origin에서 app load -> `/sw.js` ready -> My tab shows SW ready.
2. Lens tab -> camera permission allowed -> preview active.
3. Lens tab -> camera blocked -> upload/natural text fallback visible.
4. Natural text `두부 한 모 냉장 3일` -> `LensCandidateDto` -> batch confirm -> inventory item created.
5. Image upload under 10 MB -> candidate list with confidence and required fields.
6. Inventory add/edit/delete -> refresh -> server state persists.
7. `/inventory` and `/lens/camera-check` direct refresh -> app shell renders, not 404.
8. `/api/health` -> JSON, never `index.html`.
9. Recipe list -> match status includes `selected`/`owned`/`missing` -> save toggles persist.
10. Recipe consume -> matching inventory quantity reduces/removes -> selected ids pruned.
11. Push enable with VAPID -> subscription stored -> server test push opens same-origin client path.
12. Split-origin API, if used -> preflight succeeds for `Authorization`, `Content-Type`, `Idempotency-Key`.
