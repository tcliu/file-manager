# Product Specification

## Summary

`file-manager` is a SvelteKit file browser and manager that ports the behavior of the original `file-manager.mjs` standalone server into a componentized app. It supports authenticated access, directory navigation, uploads, downloads, archive inspection, selection-based zip export, deletion, folder creation inside the upload subtree, image thumbnails, raw-image browser preview conversion, and browser-playable video preparation.

## Goals

- Provide a lightweight self-hosted file browser.
- Keep deployment simple: filesystem-backed storage, no database, minimal external services.
- Support image and video-heavy folders with grid previews.
- Support multiple configured root directories without creating synthetic directories on disk.
- Preserve the behavior of the original standalone implementation while using a modern SvelteKit structure.

## Non-Goals

- Multi-user accounts or permissions.
- Persistent metadata storage.
- File editing, renaming, or moving.
- Cloud storage integration.

## Runtime Model

- Server: SvelteKit route handlers and hooks.
- Client: Svelte 5 component UI.
- Storage: direct filesystem access.
- Server state: in-memory sessions plus in-memory image/video conversion status.
- Client state: in-memory UI state plus browser `sessionStorage` for auth sessions.
- Config: `.env` and `.env.local` loaded from `FILE_MANAGER_ROOT_DIR` (or `file-manager-root-dir` env var) or `process.cwd()`.

## Configuration

Supported config keys:

- `username`
- `password`
- `session-expiry-ms`
- `upload-dir`
- `root-dir`
- `max-zip-size`

### `root-dir`

- Empty or unset: serve the configured base directory.
- Single value: serve that directory.
- CSV: create a virtual top-level directory composed of each configured root.
- Multiple roots do not create temp dirs, symlinks, or other filesystem artifacts.
- Each configured root must exist.
- Each configured root basename must be unique.

Example values:

```ini
# single root
root-dir=/Users/me/Photos

# multiple roots
root-dir=/Users/me/Photos,/Users/me/Videos

# relative to the configured base directory
root-dir=../shared
```

### `max-zip-size`

- Defaults to `1073741824` (1 GB).
- Supports `B`, `KB`, `MB`, `GB`, `TB` suffixes.
- When the total selected size exceeds this value, the Zip button is disabled.

### `upload-dir`

- Defaults to `upload`.
- Must resolve inside the configured root directory or one of the configured roots.
- Folder creation and directory deletion are restricted to this upload subtree.

## Authentication

- If `password` is empty, auth is disabled.
- If `password` is set, `username` must also be set.
- `session-expiry-ms` controls the in-memory session lifetime.
- Login creates an in-memory session token on the server.
- The browser stores the active session token in `sessionStorage`.
- The login screen Remember me option stores username and base64-encoded password in `localStorage`.
- Authenticated API requests use `x-session-token`.
- Client-generated media and download URLs also include `token` query params.
- `src/hooks.server.ts` treats `/api/zip-download` separately from session-gated routes because zip retrieval uses a short-lived download token instead of a login session token.

## Core User Flows

### Browse files

- User opens `/`.
- App shows either login UI or browser UI.
- Browser fetches `/api/files` for the current directory.
- `/api/files` returns the current page of files plus the available extension filter values for that directory.
- Root-level multi-root browsing shows configured root basenames as folder entries and no files.

### Filter by extension

- User toggles one or more extension chips.
- App reloads files for the current directory.
- If all filtered files disappear but unfiltered files exist, the app clears the filter state and reloads the unfiltered listing.

### Upload files

- User drags files onto the dropzone or opens the file picker.
- App uploads files directly to `/api/upload`, one file request at a time.
- The upload endpoint can reject a conflicting filename with `409` and a suggested name.
- The current client flow surfaces upload errors directly; the dedicated rename/overwrite conflict dialog component exists in the codebase but is not wired into the live upload loop.
- Files are uploaded into the current directory.
- Upload UI is only available when the current directory is inside the configured upload subtree.

### Create folder

- User opens the Create folder dialog from the upload action row.
- App creates the folder through `/api/create_folder`.
- Folder creation is only allowed inside the configured upload subtree.

### Download files

- User clicks a file link.
- App downloads via `/download`.

### Preview images

- Grid cards use `/thumbnail` when supported.
- User can open image lightbox with zoom controls.
- `.arw` files are treated as images.
- `.arw` thumbnails are generated on demand.
- Opening an enlarged `.arw` preview converts it to a cached `.jpg` under `.processed` for browser display.

### Preview videos

- Grid cards show thumbnail/progress while a browser-playable video is prepared.
- Prepared videos are served from a generated `.processed/*.mp4` output.
- Lightbox and grid video playback share playback state.

### Inspect zip archives

- User opens a `.zip` file in the archive lightbox.
- App reads archive contents and shows archive-local navigation.
- Files inside the archive can be downloaded individually.

### Zip selection

- User selects items in the current directory.
- App creates a temporary zip and streams it back.
- When the archive is ready, the browser downloads it through `/api/zip-download?token=...` using a short-lived download ticket.

### Delete selection

- User confirms deletion.
- Files can be deleted from the current directory selection.
- Directory deletion is only allowed under the upload subtree.

## API Endpoints

- `GET /`: page shell
- `POST /api/login`
- `POST /api/logout`
- `GET /api/files`
- `GET /api/extensions`
- `GET /api/upload-target`
- `POST /api/upload`
- `POST /api/create_folder`
- `POST /api/zip-selection`
- `GET /api/zip-download`
- `POST /api/delete-selection`
- `POST /api/selection-size`
- `GET /api/video-preparation`
- `GET /api/archive-contents`
- `GET /media`
- `HEAD /media`
- `GET /thumbnail`
- `GET /download`
- `HEAD /download`
- `GET /archive-entry-download`

## URL State

The browser syncs these values into the URL:

- `p`: current directory
- `page`: current page
- `page-size`: current page size
- `name_filter`: current name filter
- `ext`: selected extensions
- `f`: open lightbox file path
- `z`: image lightbox zoom state

List/grid mode is client state and request state, but is not currently written into the browser URL.

## Constraints

- Path access is restricted to configured roots.
- Selection-based actions are restricted to the current directory.
- Upload directory configuration must remain inside an allowed root.
- Hidden files and directories are excluded from listings.

## Operational Notes

- Thumbnail generation uses `sharp` for standard images.
- `.arw` browser-preview conversion uses `ffmpeg` first, then ImageMagick `convert` as a fallback.
- Video conversion and video thumbnail generation require `ffmpeg`.
- Archive listing/download relies on `yauzl`.
- Zip export creation uses the `archiver` package.
- Logging is structured line-based stdout logging.
