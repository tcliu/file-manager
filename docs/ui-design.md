# UI Design

## Design Intent

The UI is optimized for fast browsing of media-heavy directories while staying simple enough to run as a single-page SvelteKit surface backed by filesystem APIs.

## Visual Language

- Dark theme by default.
- Cyan used as the main accent for active and primary actions.
- Rounded cards and controls.
- Dense but readable information hierarchy.
- Tailwind utility styling with a small set of shared `fm-*` helper classes for repeated patterns.

## Major Screens

## Login Screen

- Centered card layout.
- Username and password fields.
- Password visibility toggle.
- Remember me checkbox.
- Minimal feedback area for login state/errors.
- Remembered credentials are restored from browser `localStorage` when available.

## Main Browser Screen

Top-level layout sections:

- Header with title, session state, combined folder/file summary (each segment hidden when 0), optional total size, and logout action.
- Navigation and controls row.
- Extension filter chip row.
- Upload dropzone and bulk actions when the current directory is inside the configured upload subtree.
- Main directory content area.
- Pagination/footer controls.

## Navigation Model

- Breadcrumbs show current location.
- Root breadcrumb is always present.
- In multi-root mode, the virtual root view contains one entry per configured root basename.
- Clicking a breadcrumb navigates immediately.

## View Modes

### Default

- The UI defaults to grid view on load.

### List View

- Better for compact scanning.
- Directories are displayed as folder rows.
- Files are displayed as metadata rows with extension, size, and timestamp.
- `.zip` file names open the archive lightbox instead of downloading directly.

### Grid View

- Better for visual browsing.
- Directories are displayed as folder cards.
- Files are displayed as preview cards.
- The filename and extension badge appear on the same row (badge shrink-0 after truncated name).
- A second metadata row shows size, optional image dimensions, and modification date with tight `|` separators.
- Images show thumbnails.
- Videos show thumbnail/progress while browser-playable output is prepared.
- Other files show extension-based placeholder text.
- Hover actions expose the media/archive viewer button for image, video, and zip cards.

## Bulk Interaction Model

- Every row/card has a selection checkbox.
- Selected count is always visible.
- Bulk zip and bulk delete actions are disabled unless selection exists.
- Create folder is available only in the upload subtree.

## Upload UX

- Large drag-and-drop target encourages direct interaction.
- Upload button mirrors dropzone behavior.
- Selection actions (zip, delete, create folder) are in a separate action bar above the listing, enabled only when items are selected.
- The upload dropzone panel only contains the Upload button and drop target.
- Upload progress is shown with label, percentage, and progress bar.
- Filename conflicts are resolved through a dedicated dialog.

## Media Preview UX

### Image Lightbox

- Full-screen overlay.
- Metadata header.
- Zoom in/out buttons and zoom preset menu.
- Supports `fit` plus explicit zoom levels.
- Keyboard shortcuts for navigation (ArrowLeft/Right), zoom (ArrowUp/Down), and close (Escape).
- Mouse wheel zoom in/out.
- Pointer-based pan support when zoomed.

### Video Lightbox

- Full-screen overlay.
- Preparation progress state before playback is available.
- Shared playback synchronization between grid and lightbox surfaces (playhead, playing state synced via `SharedVideoPlaybackEntry`).

### Archive Lightbox

- Full-screen overlay with archive-local breadcrumbs.
- Folder-like navigation inside zip contents.
- File download links for archive entries.

## Pagination UX

- Previous/next buttons.
- Direct page number input.
- Page size dropdown.
- Supported page sizes: `10`, `20`, `50`, `100`, `200`, `500`, `All`.
- Default page size is `20`.

## Status and Empty States

- Loading state uses a centered animated file/folder glyph cluster.
- Empty directories show `No items in this directory.`
- Status text surfaces upload, zip, delete, and create-folder outcomes when the content area is not in the empty-directory state.

## State Communication

The UI continuously surfaces:

- session state
- current selection count
- current folder/file summary
- optional total size summary
- upload progress
- video preparation progress
- empty state or status text

## Keyboard Behavior

- `Escape` closes the topmost open dialog or the lightbox.
- `ArrowLeft` / `ArrowRight` paginate when the lightbox is closed.
- In the lightbox, `ArrowLeft` / `ArrowRight` move between preview items.
- In image lightbox mode, `ArrowUp` / `ArrowDown` adjust zoom.

## URL-Driven Behavior

- Current directory is synced to `p`.
- Extension filters are synced to repeated `ext` params.
- Open lightbox file is synced to `f`.
- Image zoom is synced to `z`.

This enables refresh-safe navigation and direct links into the current browser state.

## Accessibility Notes

- Buttons have visible labels or `aria-label`s.
- Inputs are standard HTML controls.
- Keyboard shortcuts exist for major dialog, pagination, and lightbox interactions.
- Lightbox controls remain reachable through standard button semantics.
