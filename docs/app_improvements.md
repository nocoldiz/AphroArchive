# App-wise Improvements for AphroArchive

This document outlines potential improvements for the AphroArchive application, covering architecture, frontend migration, code quality, and feature enhancements.

## 1. Frontend Migration & Cleanup (Priority)
- **Complete Preact Migration**: Many modals and views are still defined in `index.html` and manipulated via legacy JS. Complete the migration of the following modals to Preact components:
  - Actor Modal
  - Studio Modal
  - Tag Modal
  - Vault Zip Modal
  - Link Iframe Modal
- **Remove Standalone HTML Pages**: Once `InstagramView.tsx` and `RedditView.tsx` are fully featured and stable, remove `instagram.html` and `reddit.html` to clean up the project root.
- **Migrate Zapping and Mosaic Modes**: These modes still rely on DOM manipulation of elements in `index.html`. They should be fully integrated into Preact state and components.
- **Eliminate Global Window Bindings**: Many Preact components still call functions attached to `window` (e.g., `window.playVideo`). These should be replaced with direct imports or state signals.

## 2. Architecture & Backend
- **Modularize Server**: `server.js` is currently a monolithic file with many route handlers. Refactor it to use a proper router (or at least split routes into separate files under `server/routes/`).
- **MIME Type Handling**: Ensure robust MIME type detection for edge cases in video streaming.

## 3. Code Quality & Maintainability
- **Strict TypeScript**: Many files still use `any` types or lack proper interfaces. Improving type definitions across the project will reduce runtime bugs and improve DX.
- **CSS Consolidation**: Styles are scattered across `style.css`, `reddit.css`, `InstagramView.css`, and inline styles. Consolidating these into a cohesive design system (or using CSS modules) would make maintenance easier.
- **Remove Dead Code**: Continue removing legacy files (like we did with `public/templates`) as they become obsolete.

## 4. Feature Suggestions
- **Advanced Search**: Add support for boolean queries or advanced filters (e.g., size ranges, duration ranges).
- **Background Thumbnail Generation**: While batch generation exists, a background worker process could generate thumbnails for new videos automatically without blocking the UI.
- **Player Enhancements**: Add playback speed controls, subtitle support, and better keyboard shortcuts to the video player.
