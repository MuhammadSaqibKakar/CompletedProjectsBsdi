# BSDI Completed Projects Dashboard

Light React/Vite dashboard for BSDI completed projects, with an offline PWA view and an optional shared Node API for online editing/sync.

## Run

```bash
npm run dev
```

Local URL:

```text
http://127.0.0.1:5173/
```

## Shared Online Sync

For shared editing across laptops, run the built app through the included server:

```bash
npm run build
npm run start
```

Server URL:

```text
http://127.0.0.1:4174/
```

The server exposes:

- `GET /api/state` for the shared database
- `PUT /api/state` for admin saves
- `POST /api/media` for admin image/video uploads
- `/synced-media/...` for uploaded media files

Persistent data is stored in `server-data/` locally, or in `BSDI_DATA_DIR` when deployed.

## Render

Use **Web Service** for the shared online version, not Static Site.

```text
Build Command: npm ci && npm run build
Start Command: npm run start
Environment: Node
Persistent Disk: /var/data
Environment Variable: BSDI_DATA_DIR=/var/data/bsdi
```

`render.yaml` is included for this setup.

If the header shows `View-only` or the Sync button only says `Check`, the site is being served without the Node API. In Render, create/deploy it as a **Web Service** so `/api/state` is available. Static Site deployments can still display the dashboard, but they cannot share admin edits between laptops.

## Admin

Open the hidden admin panel with `Ctrl + Shift + E`.

Password:

```text
bsdi@4332
```

Admin changes save locally first, then sync to the shared server when online. If the app is offline or the server is unavailable, changes stay on that laptop and the Sync button can upload them later. Images and videos can be uploaded directly in the editor. Online deployments store uploads in the server data directory; offline-only uploads stay in the browser/desktop app media database. Drive fields remain view-only links for normal users.

## Data

Regenerate project data and local media references from the PPT:

```bash
npm run extract:ppt
```

Generated database files:

- `public/database/bsdi-db.json`
- `public/database/media/{project-id}/{media-id}.*`
- `public/brand/bsdi-logo.png`
- `public/brand/balochistan-landmarks.png`

The app loads `public/database/bsdi-db.json` first. Each project has a stable project ID, and each copied image/video has a project-specific media ID so media stays attached to the correct project.

## Build

```bash
npm run build
```

## Desktop

Tauri files are included in `src-tauri/`.

```bash
npm run tauri dev
```

Rust/Cargo must be installed before running Tauri commands.
