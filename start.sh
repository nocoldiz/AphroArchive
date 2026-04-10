#!/bin/sh
# Detect OS and open browser
case "$(uname -s)" in
  Darwin) open "http://localhost:3000" ;;
  Linux)  xdg-open "http://localhost:3000" 2>/dev/null || \
          sensible-browser "http://localhost:3000" 2>/dev/null & ;;
esac
node server.js
