#!/bin/sh
# Selects the command: web (default), worker, or migrate for the hub, or
# connector run <id> for a connector runner outside the hub.
set -eu
cmd="${1:-web}"
case "$cmd" in
  web|worker|migrate) exec bun packages/hub/src/main.ts "$cmd" ;;
  connector) exec bun packages/cli/src/main.ts "$@" ;;
  *) echo "unknown command: $cmd (expected web, worker, migrate, or connector)" >&2; exit 1 ;;
esac
