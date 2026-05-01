#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  AphroArchive — macOS LauncherGrant Permission: Open the Terminal on your Mac (Cmd + Space, type "Terminal").
# Type chmod +x  (with a space at the end).
# Drag and Drop: Drag the AphroArchive.command file from your folder into the Terminal window (it will paste the path for you).
# Press Enter.
#  This script starts the server and opens your browser.
# ═══════════════════════════════════════════════════════════════════

# Move to the directory where this script is located
cd "$(dirname "$0")"

echo "----------------------------------------"
echo "  AphroArchive is starting..."
echo "----------------------------------------"

# 1. Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed."
    echo "Please download it from: https://nodejs.org"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

# 2. Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "First-time setup: Installing dependencies (npm install)..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install dependencies."
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

# 3. Open browser (waits 2 seconds for server to boot)
(sleep 2 && open "http://localhost:3000") &

# 4. Start the server
node server.js
