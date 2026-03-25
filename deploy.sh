#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building hub frontend..."
cd "$SCRIPT_DIR/hub"
pnpm install --frozen-lockfile
pnpm build

echo "==> Copying hub dist to runtime..."
rm -rf "$SCRIPT_DIR/runtime/hub-dist"
cp -r "$SCRIPT_DIR/hub/dist" "$SCRIPT_DIR/runtime/hub-dist"

echo "==> Deploying to Fly.io..."
cd "$SCRIPT_DIR/runtime"
fly deploy

echo "==> Cleaning up..."
rm -rf "$SCRIPT_DIR/runtime/hub-dist"

echo "==> Done! Hub available at https://fyrk-agent-runtime.fly.dev/hub/"
