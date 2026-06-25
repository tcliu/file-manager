# Product Specification

## Summary

`file-manager` is a single-file Node.js web app for browsing and managing files from a browser. It supports authenticated access, directory navigation, uploads, downloads, archive inspection, selection-based zip export, deletion, image thumbnails, and browser-playable video preparation.

## Goals

- Provide a lightweight self-hosted file browser.
- Keep deployment simple: one app file, minimal dependencies, no database.
- Support image and video-heavy folders with grid previews.
- Support multiple configured root directories without creating synthetic directories on disk.

## Non-Goals

- Multi-user accounts or permissions.
- Persistent metadata storage.
- File editing, renaming, or moving.
- Cloud storage integration.

## Runtime Model

- Server: Node.js HTTP server.
- Storage: direct filesystem access.
- State: in-memory sessions and video conversion status.
- Config: `.env` and `.env.local` loaded from the startup base directory.

## Configuration

Supported config keys:

- `username`
- `password`
- `upload-dir`
- `root-dir`

### `root-dir`

- Empty or unset: serve the startup directory or `--dir` directory.
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

# relative to the startup directory
root-dir=../shared
```

## Authentication

- If `password` is empty, auth is disabled.
- If `password` is set, `username` must also be set.
- Login returns an in-memory session token.
- Session duration is 10 minutes.
- Authorized requests use `x-session-token` or `token` query param.

## Core User Flows

### Browse files

- User opens `/`.
- App shows either login UI or browser UI.
- Browser fetches `/api/files` and `/api/extensions` for the current directory.

### Filter by extension

- User toggles one or more extension chips.
- App reloads extensions and files for the current directory.

### Upload files

- User drags files onto the dropzone or opens file picker.
- App checks `/api/upload-target` for naming conflicts.
- User can overwrite, rename, or cancel.
- Files are uploaded into `<current-dir>/<upload-dir>`.

### Download files

- User clicks a file link.
- App downloads via `/download`.

### Preview images

- Grid cards use `/thumbnail`.
- User can open image lightbox with zoom controls.
- `.arw` files are treated as images.
- `.arw` thumbnails are generated on demand.
- Opening an enlarged `.arw` preview converts it to a cached `.jpg` for browser display.

### Preview videos

- Grid cards show thumbnail/progress while browser-playable video is prepared.
- Prepared videos are served from a generated processed output.
- Lightbox and grid video playback share playback state.

### Inspect zip archives

- User opens a `.zip` file in archive lightbox.
- App reads archive contents and shows archive-local navigation.
- Files inside archive can be downloaded individually.

### Zip selection

- User selects items in current directory.
- App creates a temporary zip and streams it back.

### Delete selection

- User confirms deletion.
- Files can be deleted from the current directory selection.
- Directory deletion is only allowed under the upload subtree.

## API Endpoints

- `GET /`: HTML app shell
- `POST /api/login`
- `POST /api/logout`
- `GET /api/files`
- `GET /api/extensions`
- `GET /api/upload-target`
- `POST /api/upload`
- `POST /api/zip-selection`
- `POST /api/delete-selection`
- `GET /api/video-preparation`
- `GET /api/archive-contents`
- `GET /media`
- `GET /thumbnail`
- `GET /download`
- `GET /archive-entry-download`

## Constraints

- Path access is restricted to configured roots.
- Selection-based actions are restricted to the current directory.
- Upload directory configuration must remain inside an allowed root.

## Operational Notes

- Thumbnail generation uses `sharp` for standard images and `ffmpeg` for `.arw` files.
- Video conversion and video thumbnail generation require `ffmpeg`.
- Archive listing/download relies on system unzip tooling.
- Logging is structured line-based stdout logging.
