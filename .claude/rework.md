--
  You are working on AphroArchive — a zero-dependency local video organizer.
  Node.js HTTP server (no Express), vanilla JS frontend (no bundler/framework).

  ## Codebase overview

  - server.js — plain http.createServer router, all routes matched with if/regex
  - server/config-server.js — all paths and env vars (import constants from here)
  - server/db-server.js — all load/save for JSON files in cache/ and db/
  - server/helpers-server.js — json(res,data), serveStatic, readBody, toId/fromId
  - server/videos-server.js — video scanning, video API handlers
  - public/index.html — loads style.css, themes.css, then all module scripts
  - public/modules/state.js — all global state variables
  - public/modules/settings.js — settings UI module
  - public/app.js — init(), fetch functions, core render loop
  - All persistent data lives in flat JSON files under cache/ (not git-tracked)
  - Routes are added as: if (p === '/api/...') return handler(req, res)

  ## Task

  Implement an AI comment generation feature using node-llama-cpp with these exact
  requirements:

  ---

  ### 1. install.bat and install.sh

  In install.bat (Windows), after existing install steps, add:
  - Run: npm install node-llama-cpp
  - Create a models/ directory if it doesn't exist
  - Download the model using npx node-llama-cpp pull with model
    "hf:bartowski/Llama-3.2-1B-Instruct-GGUF/Llama-3.2-1B-Instruct-Q4_K_M.gguf"
    saved to ./models/llama-3.2-1b-instruct.gguf
  - Print progress messages for each step

  In install.sh (Linux/macOS), add equivalent steps using bash syntax.

  ---

  ### 2. server/comments-server.js — new module

  Create this file. It must:

  a) Model initialization:
     - Import getLlama and LlamaChatSession from 'node-llama-cpp'
     - Export an async function initCommentsModel() that:
       - Checks if the feature is enabled via a config flag (read from
         cache/settings.json, key "aiCommentsEnabled", default false)
       - If enabled, checks if ./models/llama-3.2-1b-instruct.gguf exists
       - If the file exists, loads it with getLlama() and model.createContext()
       - Stores the llama, model, and context in module-level variables so
         the model is loaded once at server start, not per request
       - Logs success or a clear warning if the model file is not found
       - Wraps everything in try/catch — if loading fails, sets a module-level
         flag `modelReady = false` and logs the error without crashing the server

  b) Export function isModelReady() that returns the modelReady boolean.

  c) Export async function generateComments(videoId, videoName):
     - Check cache first: read ./cache/comments_<videoId>.json if it exists,
       parse and return it immediately
     - If no cache: use LlamaChatSession to prompt the model with:
       "Generate between 3 and 5 realistic, casual internet comments that someone
        might write after watching a video called '[videoName]'. Return ONLY a
        valid JSON array of strings, no explanation, no markdown, just the array."
     - Parse the JSON array from the response (strip any markdown code fences
       if present before parsing)
     - If parsing fails, fall back to 3 generic comments referencing the name
     - Save the array to ./cache/comments_<videoId>.json
     - Return the array

  d) Export async function apiGenerateComments(req, res):
     - POST endpoint handler
     - Read body for { videoId, videoName }
     - Validate both fields are present
     - If !isModelReady(), return json 400 { error: 'AI comments not enabled or model
   not loaded' }
     - Call generateComments(videoId, videoName) and return json 200 { comments }
     - Catch errors and return json 500 { error }

  ---

  ### 3. server.js changes

  a) At the top, require the new module:
     const comments = require('./server/comments-server');

  b) After existing module requires (near line 40), call initCommentsModel()
     during startup — wrap in an async IIFE so it doesn't block:
     (async () => { await comments.initCommentsModel(); })();

  c) Add the route before the static file handler:
     if (p === '/api/comments/generate' && req.method === 'POST')
       return comments.apiGenerateComments(req, res);

  ---

  ### 4. server/settings-server.js — add aiCommentsEnabled to settings

  In the settings GET handler, include aiCommentsEnabled in the returned
  settings object (read from cache/settings.json, default false).

  In the settings POST/PATCH handler, allow saving aiCommentsEnabled as a
  boolean. When it changes from false to true, call
  comments.initCommentsModel() again to load the model on-demand without
  restarting the server.

  To do this, export a reinitIfNeeded() from comments-server.js that calls
  initCommentsModel() only if modelReady is still false.

  ---

  ### 5. Frontend — public/modules/settings.js

  In the settings panel HTML (or wherever settings toggles are rendered),
  add a new toggle row:

    Label: "AI Comments (node-llama-cpp)"
    Sublabel: "Generates realistic comments for videos using a local LLM.
               Requires ./models/llama-3.2-1b-instruct.gguf"
    Toggle: checkbox/switch bound to aiCommentsEnabled setting
    On change: POST to /api/settings with { aiCommentsEnabled: bool }

  ---

  ### 6. Frontend — public/modules/player.js (or app.js)

  After a video is opened (after the player view becomes visible and curV
  is set), if the AI comments feature appears enabled in the fetched
  settings:

  a) Add a comments section below the video player. Insert a div with
     id="ai-comments-section" containing:
     - A heading "Comments" with a small AI badge
     - A loading state initially
     - After fetch resolves: render each comment as a styled comment bubble
       with a randomly generated username (adjective + noun pattern like
       "CuriousOtter42"), a colored avatar circle with the first letter,
       and the comment text

  b) Fetch: POST /api/comments/generate with
     { videoId: curV.id, videoName: curV.name }
     Show a spinner while loading.
     On error or if feature disabled, hide the section entirely.

  ---

  ### 7. CSS (add to public/style.css or inline in the player template)

  Style the comments section to match the existing dark theme:
  - Container: margin-top 20px, border-top 1px solid var(--border)
  - Heading: font-size 13px, color var(--muted), text-transform uppercase,
    letter-spacing 1px, margin-bottom 12px
  - AI badge: small pill, background var(--ac) at 15% opacity,
    color var(--ac), font-size 10px, padding 2px 7px, border-radius 10px
  - Comment bubble: display flex, gap 10px, margin-bottom 14px
  - Avatar: 32px circle, background derived from username hash,
    font-weight 700, font-size 13px, flex-shrink 0
  - Username: font-size 13px, font-weight 600, margin-bottom 3px
  - Comment text: font-size 14px, color var(--fg), line-height 1.5

  ---

  ### Important constraints

  - Do NOT use npm for anything other than node-llama-cpp (no express, etc.)
  - All new server code uses require() (CommonJS), 'use strict'
  - All frontend code is plain vanilla JS, no import/export, global functions
  - The feature must be fully optional — if disabled or model missing,
    the rest of the app works exactly as before
  - node-llama-cpp is an optional peer dependency — wrap all requires in
    try/catch so the server starts even if the package is not installed:
    let getLlama, LlamaChatSession;
    try { ({ getLlama, LlamaChatSession } = require('node-llama-cpp')); }
    catch { /* package not installed */ }
  - Cache directory already exists (created on startup in server.js)
  - Models directory should be created with fs.mkdirSync on startup if absent
  - Follow the existing code style: no semicolon-less code, single quotes,
    arrow functions, no unnecessary abstractions