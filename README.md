# BSDI Completed Projects Dashboard

A professional BSDI completed-projects dashboard built with React, Vite, Tailwind CSS, Framer Motion, PWA offline caching, Tauri desktop support, and an optional Node/Express sync server for shared online editing.

The app is designed for two real workflows:

- **Public review:** users browse completed BSDI projects by phase, division, district, category, cost, progress, images, videos, and Drive folder links.
- **Admin operations:** authorized users add/edit/delete project records, add phases/divisions/districts, upload media, and sync updates to a shared server when online.

## Current Data Snapshot

The bundled database is stored at `public/database/bsdi-db.json`.

| Item | Count |
| --- | ---: |
| Completed projects | 869 |
| Phase 1 projects | 711 |
| Phase 2 projects | 158 |
| Division catalog | 8 |
| District catalog | 36 |
| Districts with project records | 35 |
| Linked media records | 897 |
| Images | 785 |
| Videos | 112 |
| Budget total | Rs 10.069 Bn |

`Quetta` is included in the district catalog but currently has no project record in the bundled dataset.

## Tech Stack

- **Frontend:** React + Vite
- **Styling:** Tailwind CSS
- **Animations:** Framer Motion
- **Icons:** Lucide React
- **Offline:** PWA + Workbox
- **Desktop shell:** Tauri
- **Shared server:** Node.js + Express
- **Upload handling:** Multer
- **Data store:** JSON database with persistent server storage
- **Media:** bundled local project media plus server-uploaded media

## Main Features

- Phase selector for `Total`, `Phase 1`, `Phase 2`, and future phases.
- Insights dashboard with completed counts, media totals, budget, top division/district, division chart, and category donut chart.
- Project Details flow: division -> district -> project sequence.
- Project media viewer with image zoom, video playback, thumbnails, and previous/next controls.
- Drive folder cards for view-only project folder links.
- Hidden admin unlock via `Ctrl + Shift + E`.
- Admin editor for project records, phases, divisions, districts, images, videos, and project details.
- Toast notifications for save, delete, upload, lock/unlock, sync, and error states.
- Offline local cache for meeting mode.
- Shared sync API for multi-laptop online edits.
- Render/Hostinger-compatible Node deployment path.

## Project Structure

```text
bsdi-dashboard/
  public/
    database/
      bsdi-db.json              # Bundled source database and admin settings
      media/                    # Bundled images/videos from source records
    brand/                      # Logo and navbar landmark assets
    favicon.svg                 # BSDI favicon
  server/
    index.js                    # Express API, shared DB, uploads, static app server
  src/
    App.jsx                     # Dashboard UI, admin editor, offline/sync logic
    index.css                   # Tailwind component styles
    main.jsx                    # React entry point
  src-tauri/                    # Desktop app shell files
  scripts/
    extract-ppt-data.ps1        # PPT extraction helper
  render.yaml                   # Render Web Service config
  vite.config.js                # Vite + PWA/Workbox config
```

## Local Development

Install dependencies:

```bash
npm ci
```

Run frontend-only development:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

Frontend-only dev mode can view the dashboard, but `/api/state` will not exist. The Sync button remains visible and will tell you if the shared Node server is not available.

## Local Shared Server

Build and serve the complete app with API:

```bash
npm run build
npm run start
```

Open:

```text
http://127.0.0.1:4174/
```

The server exposes:

- `GET /api/health` - server status
- `GET /api/state` - current shared database
- `PUT /api/state` - save full database snapshot
- `POST /api/media` - upload image/video files
- `/synced-media/...` - uploaded media files

## Admin Access

Open admin unlock:

```text
Ctrl + Shift + E
```

The admin password is stored in the database only:

```text
public/database/bsdi-db.json -> settings.adminPassword
```

Do not hard-code the password in React, Express, README, or environment variables. The server reads the password from the active database state.

## Data And Sync Model

The app has three data layers:

| Layer | Purpose |
| --- | --- |
| Bundled DB | Ships with the app at `public/database/bsdi-db.json` |
| Browser cache | Keeps last loaded data for offline meeting mode |
| Server DB | Stores shared online edits in `BSDI_DATA_DIR/bsdi-db.json` |

Admin edits save locally first. If the shared Node API is available, the app pushes the updated database to `/api/state`. If the user is offline or the deployment is frontend-only, edits stay on that laptop as pending local changes.

The header keeps a Sync button visible. Sync status pills appear only when there is something useful to show:

| State | Meaning |
| --- | --- |
| `Synced` | Shared Node API loaded successfully |
| `Pending sync` | Local edits exist and need upload |

The separate Online/Offline pill shows internet status. The browser cache is internal, so the UI does not show a separate local-cache option.

## Offline Meeting Mode

Before a meeting with no internet:

1. Open the deployed app while online.
2. Press `Sync` if the Node API is enabled.
3. Open important districts/projects once so their media can be cached by the browser.
4. Install the PWA from Chrome/Edge if you want an app-like launcher.
5. Test by turning off internet and reopening the app.

The app shell and database can work offline after loading once. Large videos/images are cached as the browser fetches them, so media that was never opened may not be available offline.

## Deployment

### Render

Use **Web Service**, not Static Site, for shared sync.

```text
Build Command: npm ci && npm run build
Start Command: npm run start
Environment: Node
Node Version: 22
Persistent Disk Mount: /var/data
Environment Variable: BSDI_DATA_DIR=/var/data/bsdi
```

`render.yaml` is included for this setup.

If pressing Sync says the sync server is not enabled, Render is serving only the frontend and `/api/state` is missing. Redeploy as a Node Web Service for shared editing.

### Hostinger

Use a **Node.js Web App** plan that supports server-side Node/Express apps.

Recommended settings:

```text
Framework: Express.js or Other
Node Version: 22.x
Build Command: npm ci && npm run build
Start Command: npm run start
Data Directory: writable persistent folder assigned to BSDI_DATA_DIR
```

If Hostinger cannot guarantee persistent file storage across redeploys, move shared data to MySQL/Supabase and keep server media in persistent storage or cloud storage.

## Git LFS

Large video files are tracked with Git LFS. After cloning:

```bash
git lfs install
git lfs pull
```

If hosted videos are missing after deployment, confirm the host downloaded LFS files during build/deploy.

## Storage Planning

Current app/media footprint:

- Bundled project media: about 2.0 GB
- Built `dist` output: about 2.0 GB because public media is copied into the build
- Local Git/LFS cache is not part of runtime hosting requirements

Recommended hosting storage:

| Use case | Suggested storage |
| --- | ---: |
| Current testing | 10 GB minimum |
| 2000 projects with similar media | 20 GB comfortable |
| Heavy video uploads | 50 GB or more |

The JSON database itself is small. Media storage is the main growth factor.

## Useful Commands

```bash
npm run dev          # Frontend dev server
npm run build        # Production build
npm run start        # Node API + built frontend
npm run lint         # ESLint checks
npm run tauri dev    # Desktop app dev shell
```

## Troubleshooting

### Sync button says the sync server is not enabled

Cause: `/api/state` is not available.

Fix: deploy as a Node Web Service/Node.js Web App, not a static frontend site.

### Admin password does not work

Cause: the active server database may have a different `settings.adminPassword`.

Fix: check the active DB in `BSDI_DATA_DIR/bsdi-db.json` on the server, not only the bundled DB in `public/database`.

### Data disappears after redeploy

Cause: server data directory is not persistent.

Fix: set `BSDI_DATA_DIR` to persistent disk/storage. On Render, mount a disk at `/var/data` and set `BSDI_DATA_DIR=/var/data/bsdi`.

### Videos do not load after deploy

Cause: Git LFS files were not pulled or host storage limits blocked large files.

Fix: run `git lfs pull` before upload/deploy, or configure the host build to fetch LFS files.

## Notes

- The dashboard is for completed BSDI projects and treats records with progress >= 80% as completed based on the imported Google Sheet workflow.
- Drive links are view-only for normal users.
- Imported media uses stable project/media IDs so files stay attached to the correct project.
