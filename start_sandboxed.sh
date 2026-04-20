#!/bin/sh

# Ensure bubblewrap is installed
if ! command -v bwrap >/dev/null 2>&1; then
  echo "Error: bubblewrap is not installed. (sudo apt install bubblewrap)"
  exit 1
fi

echo "Launching isolated network namespace..."

# Create a sandbox with its own user and network namespace
bwrap \
  --unshare-user --uid 0 --gid 0 \
  --unshare-net \
  --dev-bind / / \
  --proc /proc \
  sh -c '
    # 1. Bring up the loopback interface inside the sandbox
    # (By default, new network namespaces have "lo" set to DOWN)
    ip link set dev lo up

    # 2. Start the Node server in the background
    echo "Starting Node.js server..."
    node server.js &
    NODE_PID=$!

    # Give the server a moment to bind to the port
    sleep 2

    # 3. Launch the browser
    echo "Attempting to open browser..."
    xdg-open "http://localhost:3000" 2>/dev/null || \
    sensible-browser "http://localhost:3000" 2>/dev/null &

    # 4. Keep the sandbox alive as long as the server is running
    wait $NODE_PID
  '