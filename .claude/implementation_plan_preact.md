# Implementation Plan: Preact + TypeScript Migration

This document outlines the step-by-step migration of **AphroArchive** from a vanilla JS global-scope architecture to a modern, type-safe **Preact** application.

## Goals
- **Lightweight**: Maintain the tiny runtime footprint.
- **Stable**: Use TypeScript to eliminate runtime "undefined" errors.
- **Maintainable**: Split the 2500-line `index.html` into small, reusable components.
- **Fast**: Use Vite for instantaneous development reloads.

---

## Phase 1: Environment & Tooling
We will introduce a build step that only exists during development. The final output will remain pure, optimized JS.

1.  **Initialize Vite**:
    - Run `npm install -D vite typescript @preact/preset-vite`.
    - Create `vite.config.ts` to proxy API requests to your Node.js server (port 3000).
2.  **Folder Restructuring**:
    - Create a `src/` directory for the new Preact code.
    - Move current `public/` files to `old_public/` for reference.
3.  **TS Config**:
    - Set up `tsconfig.json` with strict mode enabled for maximum stability.

## Phase 2: State Management (The "Brain")
Currently, `state.js` uses global variables. We will replace this with **Preact Signals**, which are extremely light and perfect for this project.

1.  **Define Types**: Create interfaces for `Video`, `Category`, `Actor`, etc.
2.  **Create Store**: A `src/store.ts` file using Signals:
    ```typescript
    export const videos = signal<Video[]>([]);
    export const currentView = signal<'home' | 'browse' | 'vault'>('home');
    export const isVaultUnlocked = signal(false);
    ```

## Phase 3: Incremental Component Migration
We will migrate the UI in chunks.

### 1. The Layout (The Shell)
- **`Sidebar.tsx`**: Migrate the sidebar navigation logic.
- **`Topbar.tsx`**: Migrate the search bar and global controls.
- **`App.tsx`**: The main controller that switches between views.

### 2. The Core Components
- **`VideoCard.tsx`**: Replaces the HTML template in `public/templates/video-card.html`.
- **`VideoGrid.tsx`**: Handles the rendering and filtering logic currently in `render.js`.

### 3. Feature Views
- **`PlayerView.tsx`**: Migrate the complex video player logic from `player.js`.
- **`VaultView.tsx`**: Migrate the encrypted storage UI from `vault.js`.

## Phase 4: Packaging & Cleanup
1.  **Build Integration**:
    - Update `package.json` build scripts to run `vite build`.
    - Configure Vite to output to `dist/public`.
2.  **Server Update**:
    - Update `server.js` to serve static files from the new `dist/public` folder.
3.  **Final Cleanup**:
    - Delete the `old_public/` folder once all features are verified.

---

## Why this improves stability?
- **No Global Collisions**: Every component has its own scope. No more "which file defined this function?".
- **Type Safety**: If the server changes the API response format, TypeScript will highlight every line in the frontend that needs fixing.
- **Refactoring**: You can rename a function or variable and be 100% sure you didn't break a hidden `onclick` attribute in the HTML.
