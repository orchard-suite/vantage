#!/usr/bin/env bash
# Fails when a TypeScript source file exceeds the hard cap (600 lines) unless
# its first line carries a @file-size-exception marker.
set -euo pipefail
cd "$(dirname "$0")/.."
cap=600
fail=0
while IFS= read -r f; do
  lines=$(wc -l < "$f")
  if [ "$lines" -gt "$cap" ]; then
    if head -1 "$f" | grep -q "@file-size-exception"; then continue; fi
    echo "too long ($lines > $cap): $f"
    fail=1
  fi
done < <(find packages -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -name '*.d.ts')
exit $fail
