# Refactor Plan

## Goals

- Reduce client-side complexity in `src/lib/components/FileManager.svelte`.
- Centralize server-side access policy so auth and filesystem capability checks are easier to reason about.
- Preserve the current user-visible behavior while improving maintainability and testability.

## Current Design Pressure Points

### 1. Client orchestration is too centralized

`FileManager.svelte` currently owns:

- session handling
- URL synchronization
- file loading and pagination
- extension and name filters
- upload flow and progress state
- selection state
- create-folder, delete, and zip flows
- archive preview state
- lightbox image/video/archive state
- shared video playback coordination

This makes the component hard to change safely because unrelated concerns live in one reactive surface.

### 2. Server-side access policy is distributed

Access and capability rules are currently split across:

- `src/hooks.server.ts`
- `src/lib/server/file-utils.ts`
- route handlers such as `create_folder`, `delete-selection`, `upload`, `media`, and `download`

The rules are correct, but they are not expressed through one shared policy layer.

### 3. Runtime assumptions are implicit

The app intentionally relies on process-local in-memory state for:

- login sessions
- pending zip download tickets
- media conversion progress

That is fine for the current local-first deployment model, but the constraint should remain explicit in the code and docs.

## Refactor Principles

- Prefer small extractions over a full rewrite.
- Preserve existing endpoint contracts unless there is a deliberate migration.
- Move logic by domain, not by arbitrary line count.
- Keep filesystem policy decisions on the server.
- Keep the route layer thin and declarative.

## Phase 1: Extract Client State Domains

### Target outcome

Keep `FileManager.svelte` as the composition shell and move domain logic into focused modules or smaller stateful components.

### Suggested splits

#### File listing and navigation

Create a module responsible for:

- current directory
- breadcrumbs
- pagination
- extension filters
- name filter
- URL sync for browse state
- `/api/files` loading and request de-duplication

Suggested shape:

- `src/lib/components/file-manager/use_file_listing.ts`

#### Selection and bulk actions

Create a module responsible for:

- selected item set
- section-level select all / indeterminate state
- selected counts and total selected size
- zip/delete/create-folder action enablement

Suggested shape:

- `src/lib/components/file-manager/use_selection.ts`

#### Upload flow

Create a module responsible for:

- drag-and-drop file collection
- picker uploads
- upload progress state
- upload status text
- conflict response handling

Suggested shape:

- `src/lib/components/file-manager/use_upload_flow.ts`

#### Lightbox and archive preview

Create a module responsible for:

- open/close state
- image zoom/pan state
- media navigation
- archive preview navigation
- shared video playback coordination

Suggested shape:

- `src/lib/components/file-manager/use_lightbox.ts`

## Phase 2: Introduce Server Policy Helpers

### Target outcome

Routes should call a small set of reusable guards instead of open-coding policy checks.

### Suggested helpers

- `src/lib/server/auth.ts`
  - `require_session(event)`
  - `read_session_token(request)`

- `src/lib/server/access-policy.ts`
  - `require_current_directory(relative_dir)`
  - `require_entry_in_current_directory(current_dir, relative_path)`
  - `require_upload_subtree(relative_dir)`
  - `require_media_access(relative_path)`

### First migration targets

- `src/routes/api/create_folder/+server.ts`
- `src/routes/api/delete-selection/+server.ts`
- `src/routes/api/upload/+server.ts`
- `src/routes/media/+server.ts`
- `src/routes/download/+server.ts`
- `src/routes/archive-entry-download/+server.ts`

## Phase 3: Clarify API Surface

### Target outcome

Document which endpoints are active, which are legacy/optional, and which naming conventions are preferred.

### Recommended actions

- Standardize around snake_case for API route names where feasible.
- Decide whether `/api/extensions` and `/api/upload-target` remain supported compatibility endpoints or should be retired.
- Keep `/api/zip-download` explicitly documented as token-gated by zip ticket rather than session-gated in `hooks.server.ts`.

## Phase 4: Testing Priorities

### High-value server tests

- auth enforcement for page, API, media, and download routes
- root-constrained path resolution
- current-directory-constrained selection checks
- upload subtree restrictions for folder creation and directory deletion
- zip download ticket lifecycle

### High-value client tests

- browse state URL sync
- pagination and filter resets
- lightbox deep-link restore
- selection behavior in list and grid modes
- upload error and progress handling

## Phase 5: Optional Product Cleanup

These are behavior changes rather than pure refactors, so they should be handled separately:

- Wire the upload conflict dialog into the live upload flow or remove the dead path.
- Revisit Remember me storing base64-encoded credentials in `localStorage`.
- Decide whether view mode should also be URL-synced.

## Suggested Execution Order

1. Extract file listing/navigation state.
2. Extract selection state.
3. Extract upload flow.
4. Extract lightbox/archive state.
5. Introduce shared server policy helpers.
6. Add regression tests around auth and path-policy behavior.
7. Clean up legacy or unused API/UI paths.

## Expected Benefits

- Smaller blast radius for UI changes.
- Easier reasoning about security and capability checks.
- Better test isolation for both server and client behavior.
- Cleaner path to future enhancements without another large monolithic component.
