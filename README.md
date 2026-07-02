# File Manager

A SvelteKit file manager for browsing, previewing, uploading, downloading, zipping, and deleting files from a browser.

The original `file-manager.mjs` standalone server is preserved in this repo as the behavioral reference. The current app implementation lives in `src/`.

## Requirements

- Node.js
- `ffmpeg` for browser-playable video generation, video thumbnails, and `.arw` preview conversion
- Optional: ImageMagick `convert` as a fallback for `.arw` preview conversion when `ffmpeg` conversion fails

## Install

```bash
npm install
```

## Run

### Development

```bash
npm run dev
```

### Production-style local run

```bash
npm run start
```

Or directly:

```bash
node start.mjs --port 4000
```

`start.mjs` builds the app if needed, picks the requested port or the next free port, and runs `vite preview`.

## Quality Checks

```bash
npm run check
npm run build
```

## Configuration

The app loads `.env` and `.env.local` from the configured root directory base.

- Default base directory: current working directory
- Override base directory: set `ROOT_DIR`
- `.env.local` overrides `.env`

Example `.env.local`:

```ini
username=
password=
session-expiry-ms=600000
upload-dir=upload
root-dir=
```

Config keys:

- `username`: login username
- `password`: login password; leave empty to disable auth
- `session-expiry-ms`: session lifetime in milliseconds; invalid values fall back to `3600000`
- `upload-dir`: upload subtree name/path inside the active root; must stay within configured root(s)
- `root-dir`: single path or comma-separated list of root directories, resolved relative to the base directory
- `max-zip-size`: maximum total size for zip creation (supports `B`, `KB`, `MB`, `GB`, `TB` suffixes); defaults to `1GB`

## Multiple Root Dirs

`root-dir` accepts CSV:

```ini
# single root
root-dir=/Users/me/Photos

# multiple roots
root-dir=/Users/me/Photos,/Users/me/Videos
```

When multiple roots are configured:

- the app shows a virtual top-level directory
- each configured root basename appears as one top-level entry
- no physical virtual directory is created on disk
- root directory basenames must be unique
- extension chips are empty at the virtual root because only root folders are listed there

## Auth and Client Storage

- If `password` is empty, auth is disabled.
- Session tokens are stored in `sessionStorage` on the client.
- Server sessions are stored in a global in-memory `Map`.
- Media and download links include a `token` query parameter so direct browser requests can still authenticate.
- `/api/zip-download` uses a short-lived zip download token rather than the main login session token.
- The login screen has a Remember me option that stores the username and base64-encoded password in `localStorage` on that browser.

## Runtime Notes

- Hidden files and directories are excluded from listings.
- Generated thumbnails are stored under `.file-manager/thumbnails`.
- Generated browser-preview images/videos are stored under `.file-manager/processed`.
- Metadata (tags) are stored under `.file-manager/metadata.yml`.
- Video previews are converted to browser-playable `.mp4` files on demand.
- `.zip` archives can be browsed in the lightbox and downloaded entry-by-entry.
- Uploads stream directly to the server rather than buffering the full multipart request in memory.
- Selected files/directories can be zipped via the selection action bar above the file listing. The zip dialog supports:
  - Custom filename (defaults to `{name}.zip` for single items, `{timestamp}.zip` for multiple).
  - Image resize and format conversion (JPEG/PNG) when selected images share the same dimensions.
  - Quality control and aspect-ratio-locked dimension editing.
  - Rotation support for image processing.
  - Multi-item zip wraps files in a folder named after the archive.
- Upload filename conflicts are currently reported as upload errors; the dedicated rename/overwrite conflict dialog is present in the codebase but not wired into the active upload loop.
- A name filter input in the breadcrumb trail filters files and directories server-side by case-insensitive substring match (debounced, resets pagination).
- Extension filter chips can be toggled to narrow the listing to specific file types.
- Tag filters allow filtering by user-defined tags, plus special `tagged` and `untagged` filters.
- Section header checkboxes provide select-all / deselect-all for Folders and Files separately, with indeterminate state for partial selection.
- List/grid view mode is persisted to the URL (`v` param) and supports browser history navigation.
- Lightbox state (open file, zoom level) is persisted to the URL (`f`, `z` params) and supports browser back/forward navigation.
- Pagination changes create browser history entries for back/forward navigation.

## Docs

- `docs/spec.md`: product and behavior specification
- `docs/ui-design.md`: UI structure and interaction design
- `docs/app-design.md`: architecture and implementation design
- `docs/refactor-plan.md`: recommended refactor roadmap for client state and server policy boundaries
