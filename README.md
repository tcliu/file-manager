 # File Manager

 A small Node.js file manager for browsing, previewing, uploading, downloading, zipping, and deleting files from a browser.

 ## Requirements

 - Node.js

 ## Install

 ```bash
 npm install
 ```

 ## Run

 ```bash
 node file-manager.mjs
 ```

 Optional flags:

 - `-p`, `--port`: start port, default `3000`
 - `-d`, `--dir`: base directory used to load `.env` and `.env.local`, default `.`

 Example:

 ```bash
 node file-manager.mjs --port 4000 --dir .
 ```

 ## Configuration

 Create `.env.local` for local settings:

 ```ini
 username=
 password=
 upload-dir=upload
 root-dir=
 ```

 Config keys:

 - `username`: login username
 - `password`: login password; leave empty to disable auth
 - `upload-dir`: upload folder name inside the active directory
 - `root-dir`: single path or comma-separated list of root directories

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
 - each configured root appears as one top-level entry
 - no physical virtual directory is created on disk
 - root directory basenames must be unique

 ## Git

 `.env.*` is git-ignored for local secrets.

## Docs

- `docs/spec.md`: product and behavior specification
- `docs/ui-design.md`: UI structure and interaction design
- `docs/app-design.md`: architecture and implementation design
