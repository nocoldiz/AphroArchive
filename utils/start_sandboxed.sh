#!/bin/sh

echo "Starting Node.js server..."
node server.js &
NODE_PID=$!

# Give the server a moment to start
sleep 2

echo "Launching Chromium..."
# Open Chromium natively, directly to the localhost
chromium "http://localhost:3000" &

# Keep the terminal alive as long as the server is running
wait $NODE_PID