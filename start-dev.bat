@echo off
start /b npm run dev
start "" http://localhost:5173
node --watch server.js