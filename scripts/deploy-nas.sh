#!/usr/bin/env bash
# Build the web image locally and deploy it to the Unraid NAS.
#
# The image is built here and shipped over SSH rather than built on the NAS: a docker
# build is enough load to wedge that box, and it has no `docker compose` anyway — so
# the container is started with a plain `docker run`.
#
# Usage: scripts/deploy-nas.sh [ssh-host]

set -euo pipefail

HOST="${1:-nas}"
IMAGE="dcn-designer:latest"
CONTAINER="dcn-designer"
DATA_DIR="/mnt/user/appdata/dcn-designer"
HOST_PORT="${DCN_HOST_PORT:-8789}"   # 8788 is taken by bookshelf-audio

cd "$(dirname "$0")/.."

echo "==> Building ${IMAGE}"
docker build -t "${IMAGE}" .

echo "==> Shipping image to ${HOST}"
docker save "${IMAGE}" | gzip -1 | ssh "${HOST}" 'gunzip | docker load'

echo "==> Restarting container on ${HOST}"
ssh "${HOST}" "set -e
  mkdir -p '${DATA_DIR}'
  docker rm -f '${CONTAINER}' >/dev/null 2>&1 || true
  docker run -d \
    --name '${CONTAINER}' \
    --restart unless-stopped \
    -p ${HOST_PORT}:8788 \
    -v '${DATA_DIR}':/data \
    -e DCN_WORKSPACE=/data \
    -e PORT=8788 \
    ${DCN_AUTH_PASSWORD:+-e DCN_AUTH_PASSWORD='${DCN_AUTH_PASSWORD}'} \
    '${IMAGE}'"

echo "==> Waiting for health"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "http://${HOST}:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    echo "==> Healthy: http://${HOST}:${HOST_PORT}/"
    exit 0
  fi
  sleep 2
done

echo "!! Did not become healthy in time. Check: ssh ${HOST} 'docker logs ${CONTAINER}'" >&2
exit 1
