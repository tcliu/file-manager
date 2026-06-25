# UI Design

## Design Intent

The UI is optimized for fast browsing of media-heavy directories while staying simple enough to run as a self-contained server-rendered page with embedded client logic.

## Visual Language

- Dark theme by default.
- Cyan used as the main accent for active and primary actions.
- Rounded cards and controls.
- Dense but readable information hierarchy.

## Major Screens

## Login Screen

- Centered card layout.
- Username and password fields.
- Password visibility toggle.
- Remember-me checkbox.
- Minimal feedback area for login state/errors.

## Main Browser Screen

Top-level layout sections:

- Header with title, session state, summary, logout action.
- Navigation and controls row.
- Extension filter chip row.
- Upload dropzone and bulk actions.
- Main directory content area.
- Pagination/footer controls.

## Navigation Model

- Breadcrumbs show current location.
- Root breadcrumb is always present.
- In multi-root mode, the root view contains one entry per configured root basename.
- Clicking a breadcrumb navigates immediately.

## View Modes

### List View

- Better for compact scanning.
- Directories displayed as folder rows.
- Files displayed as metadata rows with extension, size, and timestamp.

### Grid View

- Better for visual browsing.
- Directories displayed as folder cards.
- Files displayed as preview cards.
- Images show thumbnails.
- Videos show thumbnail or prepared playable state.
- Other files show extension-based placeholder text.

## Bulk Interaction Model

- Every row/card has a selection checkbox.
- Selected count is always visible.
- Bulk zip and bulk delete actions are disabled unless selection exists.

## Upload UX

- Large drag-and-drop target encourages direct interaction.
- Upload button mirrors dropzone behavior.
- Upload progress is shown with label, percentage, and progress bar.
- Filename conflicts are resolved through a dedicated dialog.

## Media Preview UX

### Image Lightbox

- Full-screen overlay.
- Metadata header.
- Zoom in/out and zoom preset menu.
- Keyboard navigation for previous/next and close.
- Pointer-based pan support when zoomed.

### Video Lightbox

- Full-screen overlay.
- Preparation progress state before playback is available.
- Shared playback synchronization between grid and lightbox surfaces.

### Archive Lightbox

- Full-screen overlay with archive-local breadcrumbs.
- Folder-like navigation inside zip contents.
- File download links for archive entries.

## Pagination UX

- Previous/next buttons.
- Direct page number input.
- Page size dropdown.
- Supports `All` for unpaged file lists.

## State Communication

The UI continuously surfaces:

- session state
- current selection count
- current folder/file summary
- upload progress
- video preparation progress
- empty state or status text

## Accessibility Notes

- Buttons have visible labels or `aria-label`s.
- Menus expose expanded state.
- Keyboard shortcuts exist for major lightbox interactions.
- Inputs are standard HTML controls.
