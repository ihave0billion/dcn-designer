#!/usr/bin/env bash
# Build the web image locally and deploy it to the Unraid NAS.
#
# The image is built here and shipped over SSH rather than built on the NAS: a docker
# build is enough load to wedge that box, and it has no `docker compose` anyway — so
# the container is started with a plain `docker run`.
#
# Networking: the container gets its OWN LAN IP on the br0 macvlan network and binds
# port 80 there. It has to be a low port — the work MacBook's security software blocks
# outbound to high ports — and the NAS host's own 80/443 are already taken by the
# Unraid webGUI and another service. A dedicated IP sidesteps both.
#
# Usage: scripts/deploy-nas.sh [ssh-host]

set -euo pipefail

HOST="${1:-nas}"
IMAGE="dcn-designer:latest"
CONTAINER="dcn-designer"
DATA_DIR="/mnt/user/appdata/dcn-designer"
LAN_IP="${DCN_LAN_IP:-192.0.2.121}"
LAN_PORT="${DCN_LAN_PORT:-80}"
# Pinned so the router's DHCP reservation stays valid across redeploys. Docker's macvlan
# driver happens to derive this same value from the IP (02:42 + the IP in hex), but that's
# undocumented behaviour — don't leave the reservation depending on it. If you change
# LAN_IP, update the router reservation to match this MAC.
LAN_MAC="${DCN_LAN_MAC:-02:42:xx:xx:xx:xx}"

cd "$(dirname "$0")/.."

echo "==> Building ${IMAGE}"
docker build -t "${IMAGE}" .

echo "==> Shipping image to ${HOST}"
docker save "${IMAGE}" | gzip -1 | ssh "${HOST}" 'gunzip | docker load'

echo "==> Restarting container on ${HOST} at ${LAN_IP}:${LAN_PORT}"
ssh "${HOST}" "set -e
  mkdir -p '${DATA_DIR}'
  docker rm -f '${CONTAINER}' >/dev/null 2>&1 || true
  docker run -d \
    --name '${CONTAINER}' \
    --restart unless-stopped \
    --network br0 \
    --ip '${LAN_IP}' \
    --mac-address '${LAN_MAC}' \
    -v '${DATA_DIR}':/data \
    -e DCN_WORKSPACE=/data \
    -e PORT=${LAN_PORT} \
    ${DCN_AUTH_PASSWORD:+-e DCN_AUTH_PASSWORD='${DCN_AUTH_PASSWORD}'} \
    '${IMAGE}'"

# Health is checked from here, not from the NAS: a macvlan container is deliberately
# unreachable from its own host, so curling it over there would always fail.
echo "==> Waiting for health"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "http://${LAN_IP}:${LAN_PORT}/api/health" >/dev/null 2>&1; then
    echo "==> Healthy: http://${LAN_IP}${LAN_PORT:+$([ "${LAN_PORT}" = 80 ] || echo ":${LAN_PORT}")}/"
    exit 0
  fi
  sleep 2
done

echo "!! Did not become healthy in time. Check: ssh ${HOST} 'docker logs ${CONTAINER}'" >&2
exit 1
