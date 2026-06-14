#!/usr/bin/env bash
#
# launch-linux.sh — start the DCN Designer app on Linux (XFCE/VNC VM) and bring
# its window to the front. Backs the "DCN Designer (Linux).desktop" double-click
# launcher, and is also fine to run directly from a terminal.
#
# Handles the two things that don't work out of the box on this VM:
#   1. Userspace Node 22 lives in ~/.local/node/bin, which a .desktop launcher
#      does NOT pick up (it never sources your shell profile) — so we add it.
#   2. On a real VNC display, Chromium tries hardware GL, the GPU process fails,
#      and the window paints black. ELECTRON_DISABLE_SANDBOX=1 trips the
#      no-sandbox + software-rendering path in src/main/index.ts.
#
set -euo pipefail

# Resolve repo root from this script's location (works no matter where invoked).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

# 1. Userspace Node on PATH (no-op if already there).
export PATH="$HOME/.local/node/bin:$PATH"

# 2. Display + VM rendering flags.
export DISPLAY="${DISPLAY:-:0}"
export ELECTRON_DISABLE_SANDBOX=1

LOG="${TMPDIR:-/tmp}/dcn-designer-launch.log"

# If an instance is already up, just raise its window instead of stacking a
# duplicate dev server.
raise_window() {
  command -v wmctrl >/dev/null 2>&1 || return 0
  for _ in $(seq 1 30); do
    local wid
    wid="$(xwininfo -root -tree 2>/dev/null | grep '"DCN Designer"' \
           | grep -oE '0x[0-9a-f]+' | head -1)"
    if [ -n "${wid:-}" ]; then
      wmctrl -ia "$wid" 2>/dev/null || true
      return 0
    fi
    sleep 1
  done
}

if xwininfo -root -tree 2>/dev/null | grep -q '"DCN Designer"'; then
  echo "DCN Designer already running — raising its window." | tee -a "$LOG"
  raise_window
  exit 0
fi

# First run on a fresh checkout: make sure deps exist.
if [ ! -d node_modules ]; then
  echo "node_modules missing — running npm install (first launch)…" | tee -a "$LOG"
  npm install >>"$LOG" 2>&1
fi

echo "Starting DCN Designer ($(date))…" | tee -a "$LOG"
# Raise the window once it appears, in the background.
raise_window &

# Run the dev app in the foreground so closing the window stops the dev server.
exec npm run dev >>"$LOG" 2>&1
