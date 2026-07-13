#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
echo "Fetching latest code from GitHub..."
if ! git pull; then
    echo "Warning: Git pull failed, continuing anyway..."
fi
echo

npm run dev &

URL="http://localhost:5173"
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 &
fi

node --watch server.js
