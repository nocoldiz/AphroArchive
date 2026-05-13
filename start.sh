#!/bin/sh
# Detect OS and open browser
case "$(uname -s)" in
  Darwin) open "http://localhost:5173" ;;
  Linux)  xdg-open "http://localhost:5173" 2>/dev/null || \
          sensible-browser "http://localhost:5173" 2>/dev/null & ;;
esac

# Start Vite in background
npm run dev &

# Start Node server with watch mode
node --watch server.js
