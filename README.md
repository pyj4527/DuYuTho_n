# 잔반제로 Backend

Bun + Elysia + Prisma/PostgreSQL backend scaffold for the sibling React/Vite PWA
contract in `../frontend/BR_SPEC.md`.

## Stack

- Bun runtime
- Elysia HTTP framework
- Prisma 7 + PostgreSQL adapter
- PostgreSQL via `podman/compose.yml`
- `@elysiajs/swagger` OpenAPI/Scalar UI

## Setup

```bash
bun install
cp .env.example .env
bun run env:local-production
```

`bun run env:local-production` generates an ECDSA P-256 VAPID key pair, writes the
backend private/public values to `.env`, and writes the matching public key to the
sibling frontend's `.env.production.local` when `../frontend` is present. To only
print a public key without writing files, run `bun run vapid:generate`. If you need
manual private-key output, run `bun scripts/generate-vapid-env.ts --print-private`
only in a private terminal and never paste that output into shared logs.

The local production generator reuses existing VAPID keys by default so local push
subscriptions keep working across repeated setup runs. Pass `--rotate` only when
you intentionally want to regenerate local VAPID keys and recreate subscriptions.

Start local PostgreSQL/MinIO if needed:

```bash
podman compose -f podman/compose.yml up -d
```

Apply migrations and generate the Prisma client:

```bash
bun run db:migrate
bun run db:generate
```

## Run

```bash
bun run dev
# or
bun run start
```

- Server: http://localhost:3000
- Swagger/Scalar: http://localhost:3000/swagger
- OpenAPI JSON: http://localhost:3000/api/openapi.json
- Health: http://localhost:3000/api/health
- Readiness: http://localhost:3000/api/ready

Product API routes are mounted under `/api/v1/*`. Frontend SPA deep links such as
`/inventory` are served from the sibling frontend build (`../frontend/dist`) when
present; `/api/*` is never rewritten to the SPA shell. Override the build output
location with `FRONTEND_DIST_DIR` when the frontend is bundled somewhere else.

## Shared local frontend/backend settings

`bun run env:local-production` keeps the two sibling projects aligned for localhost
smoke testing:

| Backend env | Frontend env | Local value |
| --- | --- | --- |
| `PORT` | `VITE_API_BASE_URL` | `3000` / `http://localhost:3000` |
| `CORS_ALLOWED_ORIGINS` | Vite dev/preview origins | `localhost:3000`, `localhost:4173`, `localhost:5173` and `127.0.0.1` variants |
| `FRONTEND_DIST_DIR` | `dist/` build output | `../frontend/dist` |
| `CLERK_SECRET_KEY` | `VITE_CLERK_PUBLISHABLE_KEY` | required for production user-scoped API access |
| — | `VITE_DEV_SERVER_HOST` | empty for local production; set only for LAN dev-server testing |
| `VAPID_PUBLIC_KEY` | `VITE_VAPID_PUBLIC_KEY` | generated public key shared to the frontend only |
| `VAPID_PRIVATE_KEY` | — | backend-only secret |

For actual same-origin production, serve the frontend through this backend and leave
`VITE_API_BASE_URL` empty in the production frontend build. For split-origin dev or
preview, keep `VITE_API_BASE_URL=http://localhost:3000` and ensure the frontend origin
is listed in `CORS_ALLOWED_ORIGINS`.

## API contract notes

- Mutating POST endpoints accept `Idempotency-Key` and replay matching responses for 24 hours.
- Lens image/text, recipe import, push test, and prototype import endpoints have in-memory scaffold rate limits from `.env.example`.
- Anonymous household scoping is local-development only: `ALLOW_ANONYMOUS_HOUSEHOLD=true` works only when `NODE_ENV` is not `production`. Production `/api/v1/*` requires Clerk bearer authentication.
- Configure `CORS_ALLOWED_ORIGINS` for split-origin clients. With an empty value, development only allows localhost app/API origins.
- Clerk-authenticated clients send `Authorization: Bearer <Clerk session token>` to `/api/v1/*`. The backend scopes data to `clerk_<userId>` households after verifying the token with `CLERK_SECRET_KEY` or optional `CLERK_JWT_KEY`; `CLERK_PUBLISHABLE_KEY` is kept server-side here only for CLI/doctor parity.
- Local production testing uses explicit localhost CORS and `CLERK_AUTHORIZED_PARTIES` origins. `bun run env:local-production` keeps anonymous fallback disabled; use Clerk locally for production-mode API tests.
- Rate limits prefer `CF-Connecting-IP` when present. `X-Forwarded-For` is ignored in production unless `RATE_LIMIT_TRUST_X_FORWARDED_FOR=true` is set behind a proxy that strips inbound spoofed values.
- Run `clerk env pull --app app_3DvEjj2KXF5R4igeuu7OYcqtlmX --file .env.clerk.local` from this backend when you need Clerk development keys locally. The server loads `.env` first and ignored `.env.clerk.local` second so Clerk keys do not overwrite DB/VAPID settings. Never expose `CLERK_SECRET_KEY` to frontend code.
- Web Push subscription setup needs `VAPID_PUBLIC_KEY`; actual push delivery also needs `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` kept on the backend only. Subscription endpoints are limited to `PUSH_ENDPOINT_ALLOWED_HOSTS`; inactive subscriptions (404/410) are automatically cleaned up.
- Lens image analysis uses OpenAI Vision (`OPENAI_VISION_MODEL`), filters non-food objects after model output, returns `422` when no edible inventory ingredient is found, and returns `503` if no usable AI result is available. Set `LENS_IMAGE_ALLOW_MOCK_FALLBACK=true` only for local demos.
- Lens natural-language text analysis uses OpenAI (`OPENAI_TEXT_MODEL`) in production, filters non-food objects after model output, returns `422` when no edible inventory ingredient is found, and returns `503` if no usable AI result is available. Set `LENS_TEXT_ALLOW_RULE_FALLBACK=true` only for local demos.
- Recipe recommendations can crawl real recipe pages (`POST /api/v1/recipes/import`) and auto-backfill from allowed recipe hosts for stocked/selected ingredients. `RECIPE_CRAWL_ALLOWED_HOSTS` defaults to `10000recipe.com,www.10000recipe.com`; OpenAI reranks recipe matches when `OPENAI_API_KEY` is configured.

## Verification

```bash
bun run build        # prisma validate + backend typecheck
bunx --bun prisma migrate status
```

The frontend production dist contract can be checked from `frontend/`:

```bash
bun install
bun run qa:production
```

## Raspberry Pi deployment

The production QA host can run a one-command deploy after commits are pushed:

```bash
ZERO_APP_ROOT=/home/eunhhu/apps/zero scripts/deploy-zero-production.sh
```

The script updates cached GitHub clones, syncs both live directories while preserving
ignored env files and `node_modules`, builds the frontend, regenerates Prisma client,
validates the backend, and restarts the `zero-backend.service` user systemd unit.
