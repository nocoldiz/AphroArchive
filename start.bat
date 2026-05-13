@echo off
start "" http://localhost:5173
start cmd /k "npm run dev"
node --watch server.js
