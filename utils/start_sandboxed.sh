#!/bin/sh
cd "$(dirname "$0")/.."

echo "Starting Node.js server..."
node server.js &
NODE_PID=$!

# Give the server a moment to start
sleep 2

echo "Launching Unsafe Browser on Tails..."
# On Tails OS: open localhost in the Unsafe Browser (non-Tor browser)
# The Unsafe Browser is Tails' sandboxed browser that bypasses Tor
if command -v tails-unsafe-browser >/dev/null 2>&1; then
    tails-unsafe-browser "http://localhost:3000"
elif command -v unsafe-browser >/dev/null 2>&1; then
    unsafe-browser "http://localhost:3000"
else
    # Fallback: try xdg-open or firefox directly
    xdg-open "http://localhost:3000" 2>/dev/null || \
        firefox "http://localhost:3000" 2>/dev/null || \
        echo "WARNING: Could not open browser. Open http://localhost:3000 manually."
fi

# Keep the terminal alive as long as the server is running
wait $NODE_PID
