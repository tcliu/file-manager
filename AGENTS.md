# Project Rules

- This is a SvelteKit port of the file-manager.mjs standalone server.
- The original `file-manager.mjs` is preserved as the source of reference and must not be modified.
- Use snake_case for API endpoint paths and query parameters.
- Use Tailwind CSS v4 for styling (Vite plugin `@tailwindcss/vite`).
- Session tokens are stored in sessionStorage on the client and a global Map on the server.
- For generated SQL DDL, use multi-line `create table` statements.
- For generated SQL DDL, keep related `create index` statements adjacent to the table they belong to.

## Refactoring Pattern

- Prefer incremental refactors over large rewrites. Extract one cohesive domain at a time and keep behavior stable after each step.
- For TypeScript helper modules, use hyphen-case filenames (for example `client-auth.ts`, `file-listing.ts`).
- When refactoring `FileManager.svelte`, keep the component as the orchestration layer and extract reusable domain logic into `src/lib/components/file-manager/*.ts` helper modules.
- Extract pure or mostly pure logic first: query building, response mapping, derived state calculations, selection helpers, upload helpers, and formatting helpers.
- Avoid mixing refactors with unrelated behavior changes unless the behavior change is required to keep the code correct.
- If a neighboring file already has unrelated worktree changes, avoid refactors that require editing that file unless the task explicitly requires it.
- After each refactor slice, run the project checks and keep the codebase in a passing state before continuing.

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
- Lightbox navigation (prev/next) debounces media loading: URLs are cleared immediately, and the actual image/video load is deferred until the index stays stable for `lightboxLoadDebounceMs` (configurable via `lightbox-load-debounce-ms`, default 200ms).

## Dialog Design

- Every dialog has an X close button (SVG `x-mark` icon) positioned `absolute right-4 top-4` inside the `relative` section container.
- Every dialog closes via the Escape key (`svelte:window onkeydown` handler in the dialog component, checking `!pending` before calling `onCancel`).
- Dialog backdrop click calls `onCancel` (only the outer backdrop div, not the inner content div which calls `e.stopPropagation()`).
- If the dialog has a pending/loading state, the close button and Escape handler are disabled to prevent dismissal during an in-progress operation.

## Dropdown Design

- Custom dropdown menus are used instead of native `<select>`. Pattern: a `relative` container div, a toggle button with the current value and a chevron SVG, and an `absolute` dropdown panel (`z-20 mt-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur`).
- The active option uses `bg-cyan-500/15 text-cyan-200` for the highlight style.
- Outside-click dismissal is handled via a `$effect` with a `mousedown` event listener on `document`. Blur dismissal uses `onfocusout` on the container div, checking `e.relatedTarget`.
- (Example implementations: `pageSizeContainerRef` in FileManager.svelte, `imageFormatContainerRef` in CompressDialog.svelte)

## Summary Stats Design

- The header shows a combined summary of folder count, file count, and total size separated by `|`.
- Each stat segment is only displayed when its value is greater than 0 (e.g., "3 folders | 5 files | 1.2 GB" or just "5 files | 1.2 GB" when there are no folders).

## Selection Action Bar Design

- A horizontal button bar (`h-9`, `text-xs`, `gap-1.5`) is displayed above the folders/files listing whenever items are present on the page.
- Buttons are enabled only when there is an active file selection (`hasSelection`).
- Available actions: **Zip** (always visible), **Delete** (upload directory only), **Create folder** (upload directory only).
- When total selected size exceeds `maxZipSize`, the Zip button is disabled with a warning text.
- The upload dropzone panel only contains the Upload button and drop target — selection actions were moved to the action bar.

## Pagination Design

- Pagination controls (prev/next buttons, page input, page size selector) are hidden when the total item count is below the minimum page size (derived from the first numeric entry in page size options).
- Page size options: `10`, `20`, `50`, `100`, `200`, `500`, `All`.
- Default page size is `20`.
- A refresh button with a circular-arrow SVG icon and tooltip is placed in the action bar (above the folders/files listing), always visible when items are present.
- Page switching (prev/next buttons, page input, keyboard arrows) is debounced via `pageLoadDebounceMs` (configurable via `page-load-debounce-ms`, default 200ms) to prevent rapid successive server requests.

## Name / Extension Filter Design

- Extension filter buttons (`.ext`) are displayed in a flex row below the toolbar, toggled on/off via server-side query parameter `ext`.
- A text-based name filter input is appended to the breadcrumb trail with a `/` separator, styled identically to breadcrumb pills (`rounded-full`, `text-xs`, same border/bg).
- The name filter applies server-side via `name_filter` query parameter — both directories and files are filtered before pagination, so totals and page counts reflect the filtered set.
- The filter is debounced (300ms) before issuing a new `/api/files` request, resetting to page 1.

## Section-Header Checkbox Design

- In both list and grid views, the **Folders** and **Files** section headers have a prepended checkbox for "select all" / "deselect all" within that category.
- The checkbox shows an `indeterminate` state when some (but not all) items in the section are selected.
- `directoriesAllSelected` / `filesAllSelected` derived values check `ui.selectedFiles.has()` for every visible item.
- `directoriesSomeSelected` / `filesSomeSelected` drive the indeterminate state via `$effect` on the checkbox DOM element.
- The underlying per-item checkboxes use `ui.selectedFiles.has(path)` — the Set is replaced with a new instance (`new Set(ui.selectedFiles)`) after every mutation to guarantee Svelte 5 reactivity.

## Grid View File Card Design

- File cards display the filename and extension badge on the same row (flex row with the filename `truncate min-w-0` and the badge as `shrink-0`).
- Below that, a second row shows size, optional image dimensions, and modification date separated by `|` with reduced gap (`-mx-1` on each separator).
- The thumbnail/icon area has hover-revealed action buttons for image/video/zip files.

## Zip Compress Dialog Design

- The Zip dialog (`CompressDialog.svelte`) follows the standard dialog design (close icon, Escape, backdrop click).
- Displays file count, folder count, and total size (including directory contents, fetched from `/api/selection-size`) as tag badges.
- Filename defaults: single item = `{name}.zip` (strips original extension); multiple items = `{yyyyMMddHHmmss}.zip`.
- When all selected images share the same dimensions (`commonImageInfo`), an **Image options** section appears with:
  - **Image Type** (JPEG/PNG) — custom dropdown, only shown when all images share the same file extension; defaults to the shared extension; supports JPEG↔PNG conversion.
  - **Ratio** slider (1–100%) — adjusts width/height proportionally.
  - **Dimensions** (width × height) — editing one adjusts the other via aspect ratio lock, and updates the ratio slider.
  - **Quality** slider (1–100%) — JPEG output quality; defaults to 100 (no re-encoding when dimensions match).
- Fields use a CSS grid (`grid-cols-[auto_1fr]`) for consistent label alignment.
- The dialog stays open during the zip creation (showing "Zipping...") and displays errors inline.

## Zip Server-Side Processing

- The `/api/zip-selection` endpoint accepts `items`, `filename`, `folderName`, `resizeWidth`, `resizeHeight`, `resizeQuality`, and `imageFormat`.
- When resize params are provided, each sharp-supported image is processed individually:
  - EXIF orientation is preserved via `sharp(sourcePath).rotate()`.
  - Raw pixel dimensions (from `sharp.metadata()`) are swapped when EXIF orientation >= 5 to match viewed dimensions.
  - If dimensions match original AND quality is 100 AND format is unchanged, the original file is used as-is (no re-encoding).
  - Otherwise, the image is re-encoded to the target format (`.jpeg()` or `.png()`) with the requested quality.
  - The archive entry extension is updated to match the output format (`.jpg` or `.png`).
- Directory items are added recursively as-is.
- Non-image files are added as-is.
- Temp resize files are cleaned up in a `finally` block.

## Env Config

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `max-zip-size` | string (byte size) | — | Maximum total size of selected items for zip creation. Supports `B`, `KB`, `MB`, `GB`, `TB` suffixes. Exceeding this disables the Zip button. |
| `lightbox-load-debounce-ms` | integer | — | Debounce delay (ms) for loading media after lightbox navigation. Prevents rapid reloads when cycling through images/videos quickly. |
| `page-load-debounce-ms` | integer | — | Debounce delay (ms) for loading files after page switch. Prevents rapid successive server requests when clicking prev/next quickly. |
