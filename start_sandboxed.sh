#!/bin/sh

echo "Starting Node.js server..."
node server.js &
NODE_PID=$!

# Give the server a moment to bind to the port
sleep 2

echo "Attempting to open browser..."

# Check if Tails Unsafe Browser is available
if command -v unsafe-browser >/dev/null 2>&1; then
  echo "Tails OS detected. Launching Unsafe Browser..."
  # Note: You may be prompted to confirm you want to launch it
  unsafe-browser "http://localhost:3000" &
else
  # Fallback for standard Linux/macOS
  case "$(uname -s)" in
    Darwin) open "http://localhost:3000" ;;
    Linux)  xdg-open "http://localhost:3000" 2>/dev/null || \
            sensible-browser "http://localhost:3000" 2>/dev/null & ;;
  esac
fi

# Keep the script alive as long as the server is running
wait $NODE_PID