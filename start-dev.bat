@echo off
start /b npm run dev
node --watch server.js
start "" http://localhost:5173
