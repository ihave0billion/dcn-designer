#!/usr/bin/env bash
# DCN Designer launcher (macOS).
#
# Usage:
#   - Double-click in Finder → opens Terminal and starts the app.
#   - Or run from terminal:   ./launch.command
#   - To put on the Dock: drag this file onto the right side of the Dock.
#
# Quit the app from the menu bar or close the Electron window. Press
# Ctrl-C in the terminal to stop the dev server.

set -e

# Always run from the repo root regardless of where the script is invoked from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Pretty header
echo ""
echo "  ╔════════════════════════════════════════╗"
echo "  ║         DCN Designer — launcher        ║"
echo "  ╚════════════════════════════════════════╝"
echo ""
echo "  Working dir: $SCRIPT_DIR"
echo ""

# Verify Node is available — surface a friendly error if not
if ! command -v node >/dev/null 2>&1; then
  echo "  ERROR: Node.js is not installed or not on PATH."
  echo ""
  echo "  Install Node 20+ from https://nodejs.org/ or via Homebrew:"
  echo "      brew install node"
  echo ""
  read -n 1 -s -r -p "  Press any key to close…"
  exit 1
fi

NODE_VERSION="$(node --version)"
echo "  Node:        $NODE_VERSION"
echo ""

# First-run setup: install deps if node_modules is missing or empty
if [ ! -d "node_modules" ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  echo "  First run — installing dependencies (this takes a minute)…"
  echo ""
  npm install
  echo ""
fi

echo "  Launching DCN Designer (Electron + Vite dev mode)…"
echo "  • Hot reload is on — saved file changes update the app live."
echo "  • Press Ctrl-C in this terminal to stop the dev server."
echo ""

# exec so Ctrl-C goes directly to electron-vite, no extra shell wrapper
exec npm run dev
