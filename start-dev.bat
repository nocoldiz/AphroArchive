@echo off
start "" http://localhost:5173
start /b npm run dev
node --watch server.js
