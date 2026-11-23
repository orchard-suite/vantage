#!/bin/sh
# Prints the headers Claude Code adds for a hub's /mcp. The plugin's hub_token
# setting is sent as a static Authorization header, and what this prints wins
# over it. Claude Code gives this script no setting values, so it asks Claude
# Code whether hub_token is set, and when it is prints nothing. Otherwise the
# token is VANTAGE_HUB_TOKEN when set, else the one `vantage login` saved in
# the hub link file (~/.config/vantage/hub.json, or under XDG_CONFIG_HOME).
set -eu
token="${VANTAGE_HUB_TOKEN:-}"

# Whether hub_token is set, asked of Claude Code about the installed plugin
# that runs from this script's root.
if [ -z "$token" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  claude="${CLAUDE_CODE_EXECPATH:-claude}"
  id="$("$claude" plugin list --json 2>/dev/null | awk -v root="${CLAUDE_PLUGIN_ROOT%/}" '
    /"id":/ { split($0, part, "\""); id = part[4] }
    /"(installPath|readFromFolder)":/ { split($0, part, "\""); if (part[4] == root) { print id; exit } }' || true)"
  if [ -n "$id" ]; then
    configured="$("$claude" plugin configure "$id" --json 2>/dev/null | tr -d ' \n' | sed -n 's/.*"configured":\[\([^]]*\)\].*/\1/p' || true)"
    case "$configured" in *'"hub_token"'*) echo '{}'; exit 0 ;; esac
  fi
fi

if [ -z "$token" ]; then
  file="${XDG_CONFIG_HOME:-$HOME/.config}/vantage/hub.json"
  if [ -f "$file" ]; then
    token=$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -1)
  fi
fi
if [ -z "$token" ]; then
  echo "vantage: no hub token; set it with /plugin configure" >&2
  echo '{}'
  exit 0
fi
printf '{"Authorization":"Bearer %s"}\n' "$token"
