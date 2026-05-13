# Checklist of Missing Features in `index.html`

## Modals to be Ported
- [ ] **Add to Collection Modal** (`#collection-modal`) - Used to add videos to playlists. Still referenced by `PlayerView.tsx` via legacy global function `openAddToCollection()`.
- [ ] **Actor Modal** (`#actor-modal`) - Used for editing actor details (tags, descriptions, etc.).
- [ ] **Studio Modal** (`#studio-modal`) - Used for editing studio details.
- [ ] **Tag Modal** (`#tag-modal`) - Used for editing tag details.
- [ ] **Vault Zip Modal** (`#vaultZipModal`) - Used for downloading the vault as a ZIP file.
- [ ] **Bookmark Iframe Modal** (`#bfiframeMo`) - Used to view bookmarked sites in an iframe.

## Already Ported (Can be removed from `index.html`)
- [x] **Database Modal** (`#dbMo`) - Handled inline in `DatabaseView.tsx`.
- [x] **Prompt Modal** (`#prompt-modal`) - Handled inline in `PromptsView.tsx`.
- [x] **Mass Import Modal** (`#mass-import-modal`) - Handled inline in `PromptsView.tsx`.
- [x] **Valorize Modal** (`#valorize-modal`) - Handled inline in `PromptsView.tsx`.
- [x] **Vision Modal** (`#visionModal`) - Ported to `VisionModal.tsx`.

# Global Check Analysis (Elsewhere)

## Standalone Pages
- [ ] **Reddit Mode** (`reddit.html`) - Fully legacy page with its own CSS (`reddit.css`). Needs to be converted to a TSX view (e.g., `RedditView.tsx`) to fit the SPA architecture.
- [ ] **Instagram Mode** (`instagram.html`) - Standalone page, but has a TSX equivalent `InstagramView.tsx`. We should check if the TSX view covers all features and if `instagram.html` can be removed.
