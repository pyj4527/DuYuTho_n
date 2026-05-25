# Experimental Feature Roadmap

Branch: `feat/experimental`

This branch is the backend staging area for the next feature group. Production remains on `main` until these flows are implemented, tested, and promoted.

## 1. Notification Upgrade

Backend capabilities to prepare:

- Scheduled jobs for expiry-soon, expired, and daily "today to eat" push notifications.
- User notification preference model with quiet hours and preferred delivery windows.
- Delivery-time recommendation based on observed interaction and meal patterns.
- Push subscription refresh, revoke, failure cleanup, and audit events.

Candidate API surface:

- `GET /api/v1/notifications/preferences`
- `PUT /api/v1/notifications/preferences`
- `GET /api/v1/notifications/preview`
- `POST /api/v1/notifications/subscriptions`
- `DELETE /api/v1/notifications/subscriptions/:id`

## 2. Ingredient Recognition Upgrade

Backend capabilities to prepare:

- Receipt OCR analysis with grocery-line extraction.
- Fridge photo recognition with food-only guardrails.
- Duplicate ingredient detection against active inventory.
- Quantity merge suggestions instead of blind inserts.
- `needsReview` state for unclear expiry, identity, or quantity.

Candidate API surface:

- `POST /api/v1/lens/receipt`
- `POST /api/v1/lens/fridge`
- `POST /api/v1/inventory/merge-candidates`
- `PATCH /api/v1/inventory/:id/review-state`

## 3. Personalized Recommendations

Backend capabilities to prepare:

- User preference model for excluded ingredients, preferred cook time, and disliked foods.
- Recent meal history from recipe consumption.
- Recipe ranking that prioritizes expiring inventory, preference match, cook time fit, and repeat fatigue.
- Ranking reason payloads for frontend explanation chips.

Candidate API surface:

- `GET /api/v1/me/recipe-preferences`
- `PUT /api/v1/me/recipe-preferences`
- `GET /api/v1/recipes/recommendations`
- `POST /api/v1/recipes/:id/feedback`

## Readiness Gates

- All user data must remain scoped by Clerk subject and household ownership.
- New scheduled or AI flows must be idempotent and observable with request or job IDs.
- Lens endpoints must reject non-food images and avoid storing raw images unless explicitly designed.
- Push notification jobs must not send without an active subscription and opt-in preferences.
- Recommendation ranking must be deterministic enough for tests and debuggable reason output.
