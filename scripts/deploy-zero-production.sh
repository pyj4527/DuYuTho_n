#!/usr/bin/env bash
set -euo pipefail

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

require_command bun
require_command git
require_command rsync
require_command systemctl

update_repo "$FRONTEND_REPO" "$FRONTEND_BRANCH" "$FRONTEND_SRC"
update_repo "$BACKEND_REPO" "$BACKEND_BRANCH" "$BACKEND_SRC"

sync_tree "$FRONTEND_SRC" "$FRONTEND_LIVE"
sync_tree "$BACKEND_SRC" "$BACKEND_LIVE"

cd "$FRONTEND_LIVE"
bun install --frozen-lockfile
bun run build

cd "$BACKEND_LIVE"
bun install --frozen-lockfile
bun run db:generate
bun run build

systemctl --user restart "$SERVICE_NAME"
systemctl --user --no-pager --full status "$SERVICE_NAME" | sed -n '1,18p'

