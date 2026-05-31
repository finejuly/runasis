#!/bin/zsh
set -euo pipefail

ROOT="${RUNASIS_PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

node_supports_runasis() {
  command -v node >/dev/null 2>&1 \
    && node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 18 && typeof fetch === "function" ? 0 : 1);' >/dev/null 2>&1
}

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"

  if [ -f "$ROOT/.nvmrc" ]; then
    nvm use --silent >/dev/null 2>&1 || true
  fi

  if ! node_supports_runasis; then
    nvm use --silent default >/dev/null 2>&1 \
      || nvm use --silent node >/dev/null 2>&1 \
      || true
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Runasis error: Node.js was not found. Install Node.js 18 or newer."
  exit 127
fi

if ! node_supports_runasis; then
  version="$(node -v 2>/dev/null || echo unknown)"
  echo "Runasis error: Node.js 18 or newer with fetch support is required. Current: $version"
  exit 1
fi

exec node server.js
