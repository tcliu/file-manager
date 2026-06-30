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
- Override base directory: set `FILE_MANAGER_ROOT_DIR`
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
- The login screen has a Remember me option that stores the username and base64-encoded password in `localStorage` on that browser.

## Runtime Notes

- Hidden files and directories are excluded from listings.
- Generated thumbnails are stored under `.thumbnails`.
- Generated browser-preview images/videos are stored under `.processed`.
- Video previews are converted to browser-playable `.mp4` files on demand.
- `.zip` archives can be browsed in the lightbox and downloaded entry-by-entry.
- Selected files/directories can be zipped via the selection action bar above the file listing. The zip dialog supports:
  - Custom filename (defaults to `{name}.zip` for single items, `{timestamp}.zip` for multiple).
  - Image resize and format conversion (JPEG/PNG) when selected images share the same dimensions.
  - Quality control and aspect-ratio-locked dimension editing.
  - Multi-item zip wraps files in a folder named after the archive.
- A name filter input in the breadcrumb trail filters files and directories server-side by case-insensitive substring match (debounced, resets pagination).
- Extension filter chips can be toggled to narrow the listing to specific file types.
- Section header checkboxes provide select-all / deselect-all for Folders and Files separately, with indeterminate state for partial selection.

## Docs

- `docs/spec.md`: product and behavior specification
- `docs/ui-design.md`: UI structure and interaction design
- `docs/app-design.md`: architecture and implementation design
