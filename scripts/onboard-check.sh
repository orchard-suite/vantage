#!/bin/sh
# Runs when a session starts. Says one line, only when a repository's docs
# are not wired: it has no vantage.yaml (then whether it holds other diagram
# files, and how old they are next to its code), or its vantage.yaml names a
# document but neither it nor the estate's repos.yaml names the hub and
# workspace. Silent in a wired repository, one that declined (vantage:
# false), outside a repository, and for seven days after a person said "not
# now" (a line "<root> <epoch>" in ~/.config/vantage/onboard-snooze).
# It reads git and local files only: no network, no model.
set -u
dir="${CLAUDE_PROJECT_DIR:-$PWD}"
root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
here="$(cd "$(dirname "$0")" && pwd)"
resolved="$(sh "$here/pointer.sh" "$root")"
field() { printf '%s\n' "$resolved" | sed -n "s/^$1: //p" | head -1; }
state="$(field pointer)"
hub="$(field hub)"
workspace="$(field workspace)"
repository="$(field repository)"
[ "$state" = "declined" ] && exit 0
[ "$state" = "present" ] && [ -n "$hub" ] && [ -n "$workspace" ] && exit 0

now="$(date +%s)"
snooze="${XDG_CONFIG_HOME:-$HOME/.config}/vantage/onboard-snooze"
if [ -f "$snooze" ]; then
  until="$(awk -v r="$root" '$1 == r { t = $2 } END { print t + 7 * 86400 }' "$snooze")"
  [ "$now" -lt "$until" ] && exit 0
fi

if [ "$state" = "present" ]; then
  echo "Vantage: this repository's vantage.yaml names its docs, but no hub and workspace are mapped for ${repository:-it} here. At a natural pause, offer once to map it in ~/.config/vantage/repos.yaml with the vantage-onboard skill."
  exit 0
fi
mapped=""
[ -n "$hub" ] && [ -n "$workspace" ] && mapped=" This estate maps it to workspace $workspace on $hub."

# Diagram files by kind, from what git tracks, and Markdown that holds Mermaid or PlantUML blocks.
files="$(git -C "$root" ls-files 2>/dev/null | awk '
  { f = tolower($0) }
  f ~ /\.(drawio|dio)(\.(svg|png|xml))?$/ { print "draw.io\t" $0; next }
  f ~ /\.vsdx?$/ { print "Visio\t" $0; next }
  f ~ /\.lucid$/ { print "Lucidchart\t" $0; next }
  f ~ /\.(mmd|mermaid)$/ { print "Mermaid\t" $0; next }
  f ~ /\.(puml|plantuml|pu|iuml)$/ { print "PlantUML\t" $0; next }
  f ~ /(^|\/)workspace\.dsl$/ || f ~ /structurizr[^\/]*\.(dsl|json)$/ { print "Structurizr\t" $0; next }
  f ~ /\.ilograph$/ || f ~ /(^|\/)ilograph[^\/]*\.ya?ml$/ { print "Ilograph\t" $0; next }
  f ~ /(^|\/)docs?\/(.*\/)?[^\/]*(architecture|diagram)[^\/]*\.(png|svg|jpe?g)$/ { print "picture\t" $0; next }
')"
blocks="$(git -C "$root" grep -l -I -E '^[[:space:]]*(```|~~~)[[:space:]]*(mermaid|plantuml|puml)' -- '*.md' '*.markdown' 2>/dev/null | sed 's/^/Markdown with diagram blocks	/')"
all="$(printf '%s\n%s\n' "$files" "$blocks" | sed '/^$/d')"

if [ -z "$all" ]; then
  echo "Vantage: this repository has no vantage.yaml, so its diagrams and docs are not in Vantage. At a natural pause, not in the middle of the task, offer once to set it up with the vantage-onboard skill. If the person says never, that skill writes vantage: false.$mapped"
  exit 0
fi

counts="$(printf '%s\n' "$all" | cut -f1 | sort | uniq -c | sort -rn | awk '{ n = $1; $1 = ""; sub(/^ +/, ""); printf "%s%d %s", (NR > 1 ? ", " : ""), n, $0 } END { print "" }')"
age() {
  awk -v s="$1" -v now="$now" 'BEGIN { d = int((now - s) / 86400); if (d < 1) print "today"; else if (d < 60) print d " days ago"; else if (d < 730) print int(d / 30) " months ago"; else print int(d / 365) " years ago" }'
}
diagrams="$(printf '%s\n' "$all" | cut -f2 | tr '\n' '\0' | xargs -0 git -C "$root" log -1 --format=%ct -- 2>/dev/null)"
code="$(git -C "$root" log -1 --format=%ct 2>/dev/null)"
when=""
if [ -n "$diagrams" ] && [ -n "$code" ]; then when=", last changed $(age "$diagrams") while the code changed $(age "$code")"; fi
echo "Vantage: this repository has no vantage.yaml and holds other diagrams ($counts$when). At a natural pause, not in the middle of the task, offer once to move them into Vantage with the vantage-onboard skill, and check them against the code. If the person says never, that skill writes vantage: false.$mapped"
