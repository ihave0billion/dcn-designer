#!/usr/bin/env bash
# Download + extract the official Cisco Visio stencil packs used by the Visio export.
# Listing: https://www.cisco.com/c/en/us/products/visio-stencil-listing.html
# Pattern: https://www.cisco.com/c/dam/assets/prod/visio/visio/<name>.zip
#
# Usage: fetch-stencils.sh <dest dir> [family ...]   (default families: nexus9000 ucs)
# The packs are Cisco-copyrighted and 80-150 MB — keep <dest dir> out of git.
set -euo pipefail
dest="${1:?dest dir}"; shift || true
declare -A URL=(
  [nexus9000]="https://www.cisco.com/c/dam/assets/prod/visio/visio/switches_cisco_nexus_9000.zip"
  [ucs]="https://www.cisco.com/c/dam/assets/prod/visio/visio/unified-computing-system-hyperflex-systems.zip"
)
fams=("$@"); [ ${#fams[@]} -gt 0 ] || fams=(nexus9000 ucs)
for f in "${fams[@]}"; do
  u="${URL[$f]:-}"; [ -n "$u" ] || { echo "unknown family $f (known: ${!URL[*]})" >&2; exit 1; }
  mkdir -p "$dest/$f"
  echo "fetching $f ..."
  curl -fL -A 'Mozilla/5.0' -o "$dest/$f.zip" "$u"
  python3 - "$dest/$f.zip" "$dest/$f" <<'PY'
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
print('extracted', sys.argv[2])
PY
done
ls "$dest"/*/*.vssx
