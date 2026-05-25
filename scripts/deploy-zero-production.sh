#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

APP_ROOT="${ZERO_APP_ROOT:-$HOME/apps/zero}"
BACKEND_BRANCH="${ZERO_BACKEND_BRANCH:-main}"
BACKEND_LIVE="${ZERO_BACKEND_LIVE:-$APP_ROOT/DuYuTho_n}"
BACKEND_REPO="${ZERO_BACKEND_REPO:-https://github.com/pyj4527/DuYuTho_n.git}"
BACKEND_SRC="${ZERO_BACKEND_SRC:-$APP_ROOT/_src/DuYuTho_n}"
FRONTEND_BRANCH="${ZERO_FRONTEND_BRANCH:-dev/eunhhu}"
FRONTEND_LIVE="${ZERO_FRONTEND_LIVE:-$APP_ROOT/frontend}"
FRONTEND_REPO="${ZERO_FRONTEND_REPO:-https://github.com/duyuthon2026/frontend.git}"
FRONTEND_SRC="${ZERO_FRONTEND_SRC:-$APP_ROOT/_src/frontend}"
SERVICE_NAME="${ZERO_SERVICE_NAME:-zero-backend.service}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 127
  }
}

update_repo() {
  local repo_url="$1"
  local branch="$2"
  local directory="$3"

  if [ ! -d "$directory/.git" ]; then
    mkdir -p "$(dirname "$directory")"
    git clone "$repo_url" "$directory"
  fi

  git -C "$directory" fetch --prune origin "$branch"
  git -C "$directory" checkout -B "$branch" "origin/$branch"
  git -C "$directory" reset --hard "origin/$branch"
  git -C "$directory" clean -fd --exclude=node_modules --exclude=dist --exclude=.env --exclude=.env.* --exclude=generated
}

sync_tree() {
  local source_dir="$1"
  local target_dir="$2"

  mkdir -p "$target_dir"
  rsync -a --delete \
    --exclude .git \
    --exclude node_modules \
    --exclude dist \
    --exclude .env \
    --exclude '.env.*' \
    "$source_dir/" "$target_dir/"
}

read_env_value() {
  local env_file="$1"
  local key="$2"

  if [ ! -f "$env_file" ]; then
    return 0
  fi

  local value
  value="$(grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

require_env_value() {
  local env_file="$1"
  local key="$2"
  local value

  value="$(read_env_value "$env_file" "$key")"
  if [ -z "$value" ]; then
    echo "Missing required env: $key in $env_file" >&2
    exit 1
  fi
}

require_env_equals() {
  local env_file="$1"
  local key="$2"
  local expected="$3"
  local value

  value="$(read_env_value "$env_file" "$key")"
  if [ "$value" != "$expected" ]; then
    echo "Invalid env: $key in $env_file must be $expected" >&2
    exit 1
  fi
}

validate_production_env() {
  local backend_env="$BACKEND_LIVE/.env"
  local frontend_env="$FRONTEND_LIVE/.env.production.local"

  require_env_value "$backend_env" CLERK_PUBLISHABLE_KEY
  require_env_value "$backend_env" CLERK_SECRET_KEY
  require_env_value "$backend_env" CLERK_AUTHORIZED_PARTIES
  require_env_value "$backend_env" CORS_ALLOWED_ORIGINS
  require_env_equals "$backend_env" ALLOW_ANONYMOUS_HOUSEHOLD false

  require_env_value "$frontend_env" VITE_CLERK_PUBLISHABLE_KEY
  require_env_equals "$frontend_env" VITE_ALLOW_ANONYMOUS_BACKEND false

  local backend_publishable_key
  local frontend_publishable_key
  backend_publishable_key="$(read_env_value "$backend_env" CLERK_PUBLISHABLE_KEY)"
  frontend_publishable_key="$(read_env_value "$frontend_env" VITE_CLERK_PUBLISHABLE_KEY)"

  if [ "$backend_publishable_key" != "$frontend_publishable_key" ]; then
    echo "Clerk publishable key mismatch between backend and frontend env files" >&2
    exit 1
  fi
}

require_command bun
require_command git
require_command rsync
require_command systemctl

update_repo "$FRONTEND_REPO" "$FRONTEND_BRANCH" "$FRONTEND_SRC"
update_repo "$BACKEND_REPO" "$BACKEND_BRANCH" "$BACKEND_SRC"

sync_tree "$FRONTEND_SRC" "$FRONTEND_LIVE"
sync_tree "$BACKEND_SRC" "$BACKEND_LIVE"
validate_production_env

cd "$FRONTEND_LIVE"
bun install --frozen-lockfile
bun run build

cd "$BACKEND_LIVE"
bun install --frozen-lockfile
bun run db:generate
bun run build

systemctl --user restart "$SERVICE_NAME"
systemctl --user --no-pager --full status "$SERVICE_NAME" | sed -n '1,18p'
