#!/usr/bin/env bash
# Run extract-masters.py inside a throw-away LibreOffice container so the EMF
# masters get rasterised to PNG without installing LibreOffice on the host
# (measured 2026-09-26: alpine image ~900 MB, 1 s per EMF — fine for a one-off,
# far too heavy for the app image; see docs/VISIO_EXPORT_PLAN.md).
#
# Usage:
#   extract-in-docker.sh <stencil dir> <seed dir> <images dir|-> <out workspace dir> [extra extract-masters args]
#
# All four paths must be visible to the DOCKER DAEMON. On the herdr container the
# daemon is the Unraid host, so paths under /hermes/... must be given as
# /mnt/user/hermes/... (set HOST_PREFIX_FROM/HOST_PREFIX_TO to translate
# automatically; defaults do exactly that). Scratchpad / container-local paths
# are NOT mountable — copy inputs to the share first.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stencils="${1:?stencil dir}"; seed="${2:?seed dir}"; images="${3:?images dir or -}"; out="${4:?out dir}"
shift 4
IMAGE="${IMAGE:-dcn-lo-check}"
FROM_PFX="${HOST_PREFIX_FROM:-/hermes/}"; TO_PFX="${HOST_PREFIX_TO:-/mnt/user/hermes/}"

hostpath() {  # container path -> daemon-visible path
  local p; p="$(cd "$1" 2>/dev/null && pwd || echo "$1")"
  [[ "$p" == "$FROM_PFX"* ]] && p="$TO_PFX${p#"$FROM_PFX"}"
  echo "$p"
}

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE (LibreOffice + ImageMagick + python3, ~900 MB) ..." >&2
  docker build -t "$IMAGE" - <<'EOF'
FROM alpine:3.21
RUN apk add --no-cache libreoffice fontconfig ttf-dejavu imagemagick python3
ENV HOME=/tmp
EOF
fi

mkdir -p "$out"
# The script itself must be daemon-visible too: stage a copy in the out dir.
mkdir -p "$out/.tools" && cp "$here/extract-masters.py" "$out/.tools/"

# Mount the stencil dir under its own name so index.json records the family
# (extract-masters.py takes it from the pack's parent directory).
fam="$(basename "$(cd "$stencils" && pwd)")"
vols=(-v "$(hostpath "$stencils"):/in/stencils/$fam:ro" -v "$(hostpath "$seed"):/in/seed:ro" -v "$(hostpath "$out"):/out")
img_arg=()
if [ "$images" != "-" ]; then
  vols+=(-v "$(hostpath "$images"):/in/images:ro"); img_arg=(--images /in/images)
fi

packs=()
while IFS= read -r -d '' f; do packs+=(--pack "/in/stencils/$fam/${f#"$stencils"/}"); done \
  < <(find "$stencils" -name '*.vssx' -print0 | sort -z)
[ ${#packs[@]} -gt 0 ] || { echo "no .vssx under $stencils" >&2; exit 1; }

docker run --rm "${vols[@]}" "$IMAGE" python3 /out/.tools/extract-masters.py \
  "${packs[@]}" --switches /in/seed/switches.yaml --ipn /in/seed/ipn_routers.yaml --servers /in/seed/servers.yaml \
  "${img_arg[@]}" --out /out "$@"
rm -rf "$out/.tools"
echo "bundle: $out/library/visio"
