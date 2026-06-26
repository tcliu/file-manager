# Project Rules

- This is a SvelteKit port of the file-manager.mjs standalone server.
- The original `file-manager.mjs` is preserved as the source of reference and must not be modified.
- Use snake_case for API endpoint paths and query parameters.
- Use Tailwind CSS v4 for styling (browser CDN).
- Session tokens are stored in sessionStorage on the client and a global Map on the server.
- For generated SQL DDL, use multi-line `create table` statements.
- For generated SQL DDL, keep related `create index` statements adjacent to the table they belong to.

## Lightbox / Media Viewer Design

- Zoom is image-only (not video/zip). Controlled via +/- buttons, zoom dropdown menu, or ArrowUp/ArrowDown keyboard shortcuts.
- Zoom levels: `[25, 50, 75, 100, 125, 150, 200, 300]` plus a dynamic "fit" option.
- Pan uses pointer events (`pointerdown`/`pointermove`/`pointerup`) with `setPointerCapture` on the backdrop div. Pan is enabled only when the image is zoomed larger than the viewport.
- Body scroll is locked (`overflow-hidden` on `document.body`) while the lightbox is open.
- The backdrop (`lightboxBackdrop`) acts as the scroll container (`overflow-auto`) for panning. When zoomed beyond fit, the image overflows and the user pans by manipulating `scrollLeft`/`scrollTop`.
- Center anchor capture/restore ensures zooming pivots around the current viewport center rather than the top-left corner.
- **Fit mode uses pure CSS**: `max-width: 100%; max-height: 100%; object-fit: contain` — no JavaScript dimension calculations needed.
- Explicit zoom sets absolute pixel `width`/`height` via inline style with `max-width: none; maxHeight: none`.
- Natural image dimensions are captured on `onload` of the `<img>` element and stored for zoom percentage calculations.
- The backdrop class changes based on mode: `overflow-auto` for image/zip, `overflow-hidden` for video.
