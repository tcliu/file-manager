# App Design

## Architecture Overview

The current application is a SvelteKit port of the original `file-manager.mjs` standalone server.

Major layers:

- SvelteKit routes under `src/routes`
- server-side filesystem/media helpers under `src/lib/server`
- UI components under `src/lib/components`
- global Tailwind-backed styles in `src/styles.css`

The original `file-manager.mjs` remains in the repo as a behavioral reference and should not be modified.

## Runtime Entry Points

### Development

- `npm run dev`
- Vite dev server serves the SvelteKit app.

### Production-style local run

- `npm run start`
- `start.mjs` builds the app if needed, finds an available port, and runs `vite preview`.

## Configuration Model

- Base config directory comes from `ROOT_DIR` or `process.cwd()`.
- `.env.local` overrides `.env`.
- Env config handles auth, upload dir, and root dirs.
- `session-expiry-ms` falls back to `3600000` when invalid.

## Root Directory Model

### Single Root

- All path resolution is relative to one physical root directory.

### Multiple Roots

- `root-dir` may contain CSV values.
- Root view is virtual only.
- The first path segment maps to a configured root basename.
- No symlinks or temp directories are created.
- Duplicate basenames are rejected during config load.

Example: `root-dir=/Users/me/Photos,/Users/me/Videos` produces a virtual root with `Photos/` and `Videos/`.

## Request Routing

Routing uses SvelteKit filesystem routes instead of manual branching.

Key route groups:

- page load routes: `src/routes/+page.server.ts`, `src/routes/+page.svelte`
- auth routes: `src/routes/api/login`, `src/routes/api/logout`
- listing/filter routes: `src/routes/api/files`, `src/routes/api/extensions`
- mutation routes: `src/routes/api/upload`, `src/routes/api/create_folder`, `src/routes/api/zip-selection`, `src/routes/api/delete-selection`
- media/download routes: `src/routes/media`, `src/routes/thumbnail`, `src/routes/download`, `src/routes/archive-entry-download`
- archive/video status routes: `src/routes/api/archive-contents`, `src/routes/api/video-preparation`

## Auth Gate Design

- `src/hooks.server.ts` enforces auth for page, API, media, and download routes when auth is enabled.
- Public paths are `/`, `/api/login`, `/api/logout`, and `/api/zip-download`.
- Session-gated requests may authenticate with `x-session-token` or a `token` query param.
- `/api/zip-download` is public only in the sense that it bypasses session auth in `hooks.server.ts`; the route validates its own short-lived zip download token.
- Server session records are stored in `globalThis.__fileManagerSessions`.
- Valid sessions are exposed to the request through `event.locals.session`.

## Security Model

- Root-constrained path resolution.
- Current-directory-constrained selection actions.
- Upload subtree restriction for folder creation and directory deletion.
- Hidden files are excluded from directory listings.
- Session expiry is enforced on the server.

## Filesystem Design

### Read paths

- directory listing
- file metadata
- media streaming
- archive inspection

### Write paths

- uploads into upload subtree
- generated thumbnails in `.file-manager/thumbnails`
- generated processed images/videos in `.file-manager/processed`
- temporary zip exports in the OS temp dir

## Media Processing Design

### Images

- Thumbnail generation uses `sharp` for browser-supported image types.
- `.arw` files are treated as images.
- `.arw` browser preview conversion writes cached `.jpg` output into `.file-manager/processed`.
- `.arw` conversion tries `ffmpeg` first and falls back to ImageMagick `convert`.
- Thumbnail and processed-image caches are invalidated by source mtime comparison.

### Videos

- Browser-playable `.mp4` output is generated on demand in `.file-manager/processed`.
- Progress state is kept in memory.
- Video thumbnails are generated with `ffmpeg` into `.file-manager/thumbnails`.
- Grid and lightbox share video playback state through client-managed coordination.

## Archive Design

- Only `.zip` preview is supported.
- Archive listing is read through `yauzl` (async iterator over zip entries).
- Archive entries are not extracted globally; requested entries are streamed on demand.
- Selection zip export creation uses `archiver`.

## Client App Design

### Route Shell

- `+page.server.ts` loads auth and media-extension configuration.
- `+page.svelte` renders the root `FileManager` component.

### Main Components

- `FileManager.svelte`: top-level browser state and orchestration
- `Login.svelte`: auth form and remembered credential restore
- `Lightbox.svelte`: image/video/archive preview surface
- `ConfirmDialog.svelte`, `CreateFolderDialog.svelte`, `CompressDialog.svelte`: active modal flows
- `UploadConflictDialog.svelte`: present in the component set, but not currently wired into the live upload request loop

### Primary Client Responsibilities

- session handling
- navigation and URL sync
- filters and pagination
- uploads and progress handling
- selection state
- selection action bar (zip, delete, create folder)
- create-folder flow
- lightbox state
- archive preview state
- shared video playback state

## Client Storage Design

- Active auth session token is stored in `sessionStorage`.
- Remembered login credentials are stored in `localStorage` when the user enables Remember me.
- Remembered password is stored base64-encoded, not encrypted.

## URL State Design

The client syncs selected navigation state into the URL:

- current directory via `p`
- current page via `page`
- current page size via `page-size`
- current name filter via `name_filter`
- extension filters via repeated `ext`
- open lightbox path via `f`
- image zoom state via `z`

This enables refresh-safe navigation and deep linking for the current folder, pagination state, filters, and lightbox state.

## Styling Design

- Tailwind CSS v4 via `@tailwindcss/vite` Vite plugin, importing `@import "tailwindcss"` in `src/styles.css`.
- Repeated utility combinations are collapsed into small `fm-*` helper classes in `src/styles.css`.
- Component markup still uses utility classes directly where that remains the clearest representation.

## Logging Design

- Access and lifecycle events are logged to stdout.
- Logs are structured as timestamped key-value lines.
- Navigation, upload, download, archive, thumbnail, image conversion, and video conversion events are logged.

## Key Tradeoffs

### Advantages

- Clear separation between routes, server helpers, and UI components.
- Preserves the original app behavior while improving maintainability.
- Still lightweight to deploy locally.

### Costs

- Filesystem and media concerns are still tightly coupled to one app runtime.
- Some legacy endpoint naming remains mixed (`create_folder` alongside kebab-case routes).
- Client state is still centralized in a large `FileManager` component.
- Some helper routes and UI paths remain present but are not part of the main live flow (`/api/upload-target`, `UploadConflictDialog.svelte`).

## Recommended Future Refactors

- Split `FileManager.svelte` into smaller stateful view modules.
- Standardize API route naming if backward compatibility is not needed.
- Add tests around auth behavior, path resolution, and multi-root browsing.
- Either wire the upload conflict dialog into the active upload flow or remove the unused path.
