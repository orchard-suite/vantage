#!/bin/sh
# Says where a repository's Vantage docs live: the hub and workspace, and
# what its vantage.yaml names. Prints one "key: value" line each, then
# exits 0. It reads git and two files only: no network, no model.
#
#   sh scripts/pointer.sh [dir]
#
# The repository's key is its origin remote without scheme, user, port, or
# .git, in lower case (git@github.com:Acme/App.git is github.com/acme/app).
# `hub` and `workspace` come from the repository's vantage.yaml when it
# names them (a repository that is an estate's own), else from the estate's
# file, ${VANTAGE_REPOS_CONFIG:-~/.config/vantage/repos.yaml}: a list of
# { match, hub, workspace }, where match is a key or a prefix ending in /*,
# and the most specific match wins. `from` says which file gave the hub.
#
# Lines: repository, hub, workspace, from, pointer (present, declined, or
# none), then every other key vantage.yaml holds, as written. A value it
# cannot find is left out. Outside a repository it prints nothing.
set -u
dir="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}"
root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
estate="${VANTAGE_REPOS_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/vantage/repos.yaml}"

# The repository key, from the origin remote.
remote="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
key="$(printf '%s\n' "$remote" | awk '
  NF {
    u = $0
    scheme = sub(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "", u)
    sub(/^[^\/@]*@/, "", u)                                  # user
    if (scheme && match(u, /^[^\/]*:[0-9]*\//)) {             # host:port/path
      host = substr(u, 1, RLENGTH - 1); sub(/:[0-9]*$/, "", host); u = host "/" substr(u, RLENGTH + 1)
    } else if (!scheme && match(u, /^[^\/]*:/)) {             # scp form host:path
      u = substr(u, 1, RLENGTH - 1) "/" substr(u, RLENGTH + 1)
    }
    sub(/\/+$/, "", u); sub(/\.git$/, "", u)
    print tolower(u)
  }')"

# One value from a flat YAML file: the first top-level "name: value".
value() {
  [ -f "$2" ] || return 0
  awk -v k="$1" '
    $0 ~ "^" k ":" {
      v = substr($0, length(k) + 2)
      sub(/^[ \t]+/, "", v); sub(/[ \t]+#.*$/, "", v); sub(/[ \t]+$/, "", v)
      if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) v = substr(v, 2, length(v) - 2)
      print v; exit
    }' "$2"
}

pointer="$root/vantage.yaml"
hub="$(value hub "$pointer")"
workspace="$(value workspace "$pointer")"
from=""
[ -n "$hub" ] && from="vantage.yaml"

# The estate's match: exact beats prefix, a longer prefix beats a shorter one.
if [ -n "$key" ] && [ -f "$estate" ] && { [ -z "$hub" ] || [ -z "$workspace" ]; }; then
  found="$(awk -v key="$key" '
    function clean(v) {
      sub(/^[ \t]+/, "", v); sub(/[ \t]+#.*$/, "", v); sub(/[ \t]+$/, "", v)
      if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) v = substr(v, 2, length(v) - 2)
      return v
    }
    function done() {
      if (m == "") return
      p = tolower(m); score = -1
      if (p == key) score = 100000
      else if (p ~ /\/\*$/) { pre = substr(p, 1, length(p) - 1); if (index(key, pre) == 1) score = length(pre) }
      else if (p == "*") score = 0
      if (score > best && (h != "" || w != "")) { best = score; bh = h; bw = w }
      m = ""; h = ""; w = ""
    }
    BEGIN { best = -1 }
    /^[ \t]*#/ || /^[ \t]*$/ { next }
    /^-/ { done(); sub(/^-[ \t]*/, "") }
    {
      line = $0; sub(/^[ \t]+/, "", line)
      c = index(line, ":"); if (c == 0) next
      k = substr(line, 1, c - 1); v = clean(substr(line, c + 1))
      if (k == "match") m = v; else if (k == "hub") h = v; else if (k == "workspace") w = v
    }
    END { done(); if (best >= 0) printf "%s\t%s\n", bh, bw }' "$estate")"
  if [ -n "$found" ]; then
    eh="$(printf '%s' "$found" | cut -f1)"
    ew="$(printf '%s' "$found" | cut -f2)"
    if [ -z "$hub" ] && [ -n "$eh" ]; then hub="$eh"; from="$estate"; fi
    [ -z "$workspace" ] && workspace="$ew"
  fi
fi

state="none"
if [ -f "$pointer" ]; then
  if [ "$(value vantage "$pointer")" = "false" ]; then state="declined"; else state="present"; fi
fi

[ -n "$key" ] && echo "repository: $key"
[ -n "$hub" ] && echo "hub: $hub"
[ -n "$workspace" ] && echo "workspace: $workspace"
[ -n "$from" ] && echo "from: $from"
echo "pointer: $state"
# The rest of vantage.yaml as written, without the keys printed above.
if [ -f "$pointer" ]; then
  awk '
    /^[ \t]*#/ || /^[ \t]*$/ { next }
    /^[^ \t-]/ { skip = ($0 ~ /^(hub|workspace|vantage):/) }
    !skip { print }' "$pointer"
fi
exit 0
