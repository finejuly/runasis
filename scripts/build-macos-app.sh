#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT/Runasis.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
MODULE_CACHE_DIR="$ROOT/.build/clang-module-cache"

if ! command -v clang >/dev/null 2>&1; then
  echo "clang was not found. Install Xcode Command Line Tools first."
  exit 1
fi

mkdir -p "$MACOS_DIR"
mkdir -p "$MODULE_CACHE_DIR"
cp "$ROOT/macos/Info.plist" "$CONTENTS_DIR/Info.plist"

clang \
  -fobjc-arc \
  -fmodules \
  -fmodules-cache-path="$MODULE_CACHE_DIR" \
  "$ROOT/macos/RunasisApp.m" \
  -o "$MACOS_DIR/Runasis" \
  -framework Cocoa \
  -framework WebKit

chmod +x "$MACOS_DIR/Runasis"
touch "$APP_DIR"

echo "Built $APP_DIR"
