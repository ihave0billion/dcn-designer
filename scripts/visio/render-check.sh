#!/usr/bin/env bash
# Phase 13 — render a generated .vsdx with LibreOffice (in Docker) to PDF + PNG
# and run the skill's stdlib overlap check. Eyeball the PNG afterwards.
#
# Usage: scripts/visio/render-check.sh <file.vsdx> [outdir]
#
# LibreOffice is NOT in the app image (see docs/VISIO_EXPORT_PLAN.md); this
# uses a throw-away `dcn-lo-check` image (alpine + libreoffice). The Docker
# daemon may live on another host (Unraid), so the file is copied into a
# directory that host can bind-mount: DCN_LO_SHARE (container path) and
# DCN_LO_SHARE_HOST (the same directory as the daemon sees it).
set -euo pipefail

f="$(realpath "$1")"
out="${2:-$(dirname "$f")}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="${DCN_VISIO_SKILL:-/hermes/Development/claude-visio-diagrams}"
SHARE="${DCN_LO_SHARE:-$SKILL/out/lo}"
SHARE_HOST="${DCN_LO_SHARE_HOST:-/mnt/user/hermes/Development/claude-visio-diagrams/out/lo}"
IMAGE="${DCN_LO_IMAGE:-dcn-lo-check}"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE (alpine + libreoffice, ~900 MB, one-off) ..." >&2
  docker build -t "$IMAGE" - <<'EOF'
FROM alpine:3.21
RUN apk add --no-cache libreoffice fontconfig ttf-dejavu imagemagick python3
EOF
fi

mkdir -p "$SHARE/render"
base="$(basename "${f%.vsdx}")"
cp "$f" "$SHARE/render/$base.vsdx"
rm -f "$SHARE/render/$base.pdf" "$SHARE/render/$base.png"

docker run --rm -v "$SHARE_HOST/render:/w" "$IMAGE" sh -c \
  "cd /w && soffice --headless --convert-to pdf --outdir /w '$base.vsdx' >/dev/null 2>&1 \
        && soffice --headless --convert-to png --outdir /w '$base.vsdx' >/dev/null 2>&1; ls -la /w"

mkdir -p "$out"
for ext in pdf png; do
  if [ -f "$SHARE/render/$base.$ext" ]; then
    cp "$SHARE/render/$base.$ext" "$out/$base.$ext"
    echo "$out/$base.$ext"
  else
    echo "LibreOffice produced no $ext for $base.vsdx" >&2
  fi
done

if [ -f "$SKILL/scripts/preview_svg.py" ]; then
  echo "--- preview_svg.py (stdlib parse + overlap report) ---"
  python3 "$SKILL/scripts/preview_svg.py" "$f" "$out/$base.preview.svg"
fi
