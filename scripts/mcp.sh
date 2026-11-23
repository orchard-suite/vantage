#!/bin/sh
# Starts the Vantage MCP server from a checkout, installing dependencies and building the viewer on first run.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
if ! command -v bun >/dev/null 2>&1; then
  echo "vantage: bun is required (https://bun.sh)" >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  bun install --frozen-lockfile >&2
fi
if [ ! -f packages/viewer/dist/viewer.js ] || [ ! -f packages/viewer/dist/engine.js ]; then
  bun run build >&2
fi
exec bun packages/cli/src/main.ts mcp
