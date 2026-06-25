# App Design

## Architecture Overview

The application is implemented as a single ES module, `file-manager.mjs`, with three major layers in one file:

- server/bootstrap
- request handlers and filesystem services
- embedded HTML, CSS, and client-side app logic

This is intentionally monolithic for deployment simplicity.

## Startup Sequence

1. Parse CLI args.
2. Load `.env` and `.env.local` from the startup base directory.
3. Resolve configured roots.
4. Validate root existence and uniqueness constraints.
5. Create root upload directory only for single-root mode.
6. Start HTTP server.

## Configuration Model

- CLI config handles port and startup base directory.
- Env config handles auth, upload dir, and root dirs.
- `.env.local` overrides `.env`.

## Root Directory Model

### Single Root

- `rootDir` is a single physical directory.
- All path resolution is relative to that directory.

### Multiple Roots

- `rootDirs` stores the set of physical root directories.
- Root view is virtual only.
- Virtual path resolution maps the first path segment to a configured root basename.
- No symlinks or temp directories are created.

Example: `root-dir=/Users/me/Photos,/Users/me/Videos` produces a virtual root with two entries: `Photos/` and `Videos/`.

## Request Routing

Routing is implemented manually by calling a sequence of handler functions in `handleRequest()`.

Request categories:

- public page/auth routes
- authenticated API routes
- media and download routes
- mutation routes for upload/zip/delete

## Security Model

- Root-constrained path resolution.
- Current-directory-constrained selection actions.
- Upload subtree restriction for directory deletion.
- In-memory auth token validation.
- Hidden files are excluded from directory listings.

## Filesystem Design

### Read paths

- directory listing
- file metadata
- media streaming
- archive inspection

### Write paths

- uploads into upload subtree
- generated thumbnails in `.thumbnails`
- generated processed videos in `.processed`
- temporary zip exports in OS temp dir

## Media Processing Design

### Images

- Thumbnail generation uses `sharp`.
- Thumbnail cache is invalidated by source mtime comparison.

### Videos

- A browser-playable `.mp4` is generated when needed.
- Progress state is kept in memory.
- Video thumbnails are generated with `ffmpeg`.

## Archive Design

- Only `.zip` preview is supported.
- Archive directory listing is read from unzip tooling.
- Archive entries are not extracted globally; requested entries are streamed on demand.

## Client App Design

The browser app is embedded in `renderPage()` and exposed through `fileManagerApp()`.

Primary client responsibilities:

- session handling
- navigation and URL sync
- filters and pagination
- uploads and conflict handling
- selection state
- lightbox state
- archive preview state
- shared video playback state

## URL State Design

The client syncs major navigation state into the URL, including:

- current directory
- extension filters
- open file/lightbox path
- image zoom state

This enables refresh-safe navigation and deep linking.

## Logging Design

- Access and lifecycle events are logged to stdout.
- Logs are structured as timestamped key-value lines.
- Startup, shutdown, login, logout, navigation, upload, archive, thumbnail, and conversion events are logged.

## Key Tradeoffs

### Advantages

- Very easy to deploy.
- Minimal moving parts.
- Clear end-to-end control flow.

### Costs

- Large single file is harder to evolve.
- Client and server concerns are tightly coupled.
- No test harness or module boundaries yet.

## Recommended Future Refactors

- Split server, services, and client template generation.
- Add tests around path resolution and multi-root behavior.
- Add docs for external tool dependencies like `ffmpeg` and `unzip`.
- Consider persistent configuration and session storage if multi-user support becomes necessary.
