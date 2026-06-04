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
- **Data store:** MySQL for production shared data, JSON fallback for local/dev
- **Media:** bundled local project media plus server-uploaded media

## Main Features

- Phase selector for `Total`, `Phase 1`, `Phase 2`, and future phases, plus an A-Z district filter for all 36 districts.
- Insights dashboard with completed counts, media totals, budget, top division/district, division chart, and category donut chart.
- Project Details flow: division -> district -> project sequence.
- Project media viewer with image zoom, video playback, thumbnails, and previous/next controls.
- Drive folder cards for view-only project folder links.
- Hidden admin unlock via `Ctrl + Shift + E`.
- Admin editor for project records, phases, divisions, districts, images, videos, beneficiary details, and project details.
- Toast notifications for save, delete, upload, lock/unlock, sync, and error states.
- Offline local cache for meeting mode.
- Shared sync API for multi-laptop online edits.
- Print button downloads the latest server-cached PDF report instead of opening the browser print preview.
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
    storage.js                  # MySQL/JSON storage adapter with revision checks
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
- `PUT /api/state` - save full database snapshot with revision conflict protection
- `POST /api/media` - upload image/video files
- `GET /api/report/pdf` - generated report PDF for the selected phase/district
- `/synced-media/...` - uploaded media files

## Admin Access

Open admin unlock:

```text
Ctrl + Shift + E
```

The admin password is stored in the active database only:

```text
settings.adminPassword
```

Do not hard-code the password in React, Express, README, or environment variables. The server reads the password from the active MySQL row or JSON fallback state.

## Data And Sync Model

The app has four data layers:

| Layer | Purpose |
| --- | --- |
| Bundled DB | Ships with the app at `public/database/bsdi-db.json` |
| Browser cache | Keeps last loaded data for offline meeting mode |
| Production DB | Stores shared online edits in MySQL table `bsdi_dashboard_state` |
| JSON fallback | Local/dev fallback at `BSDI_DATA_DIR/bsdi-db.json` when MySQL env vars are not set |
| Server report cache | Stores generated PDFs in `BSDI_DATA_DIR/generated-reports/` |
| Canonical PPT | Stores the exact PPT download at `BSDI_DATA_DIR/templates/Completed_BSDI-14-03-2026.pptx` |

Admin edits save locally first. If the shared Node API is available, the app pushes the updated database to `/api/state`. If the user is offline or the deployment is frontend-only, edits stay on that laptop as pending local changes.

The server uses a revision number to stop silent overwrites. If two admins edit at the same time, the second stale save is rejected with a sync conflict so the user can sync latest data and save again.

For production, set `BSDI_REQUIRE_MYSQL=true`. With that guard enabled, online saves and media uploads are blocked unless MySQL is connected, so new website data cannot silently go into a temporary JSON file.

After a successful online save, the server clears old generated PDFs and starts rebuilding the default `Total / All Districts` report in the background. The PDF button downloads that cached PDF with a Pakistan-time filename. The PPT button downloads only the exact canonical PowerPoint from `BSDI_DATA_DIR/templates/Completed_BSDI-14-03-2026.pptx`; if that file is missing, the server returns an error instead of generating a different deck. Project records remain in MySQL; uploaded media and report files remain in persistent `BSDI_DATA_DIR`.

For split frontend/backend hosting, build the frontend with `VITE_BSDI_API_BASE_URL=https://your-node-api-domain` so `/api/state`, `/api/media`, and synced uploaded media resolve to the separate Node service. For a single Hostinger Node app, leave it unset.

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
Entry File: server/index.js
```

Create/connect a Hostinger MySQL database, then add environment variables:

```text
DB_HOST=your-mysql-host
DB_PORT=3306
DB_NAME=your-database-name
DB_USER=your-database-user
DB_PASSWORD=your-database-password
BSDI_DATA_DIR=../bsdi-data
BSDI_REQUIRE_MYSQL=true
```

`DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` keep the live project records in MySQL, so GitHub redeploys do not overwrite user-entered data. `BSDI_REQUIRE_MYSQL=true` makes production writes fail safely if the database is not connected. `BSDI_DATA_DIR` is still needed for uploaded media and generated PDF reports; keep it outside redeployed app files.

If your host gives one connection string instead of separate fields, use:

```text
DATABASE_URL=mysql://user:password@host:3306/database
BSDI_DATA_DIR=../bsdi-data
BSDI_REQUIRE_MYSQL=true
```

After deployment, open `/api/health`. A healthy production setup should show:

```json
{
  "ok": true,
  "storage": "mysql",
  "mysqlRequired": true,
  "durableWrites": true
}
```

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

The MySQL/JSON database itself is small. Media storage is the main growth factor.

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

Cause: the active database may have a different `settings.adminPassword`.

Fix: check the MySQL row in `bsdi_dashboard_state`, or the JSON fallback at `BSDI_DATA_DIR/bsdi-db.json` when MySQL is not configured.

### Data disappears after redeploy

Cause: the app is running without MySQL and the server data directory is not persistent.

Fix: configure the MySQL environment variables for production and set `BSDI_REQUIRE_MYSQL=true`. Also keep `BSDI_DATA_DIR` persistent for uploads/reports.

### Sync conflict appears

Cause: another admin saved changes after this laptop loaded the data.

Fix: press Sync to load the latest shared data, review the local change, then save again. The stale save is blocked so another user's work is not silently overwritten.

### Videos do not load after deploy

Cause: Git LFS files were not pulled or host storage limits blocked large files.

Fix: run `git lfs pull` before upload/deploy, or configure the host build to fetch LFS files.

## Notes

- The dashboard is for completed BSDI projects and treats records with progress >= 80% as completed based on the imported Google Sheet workflow.
- Drive links are view-only for normal users.
- Imported media uses stable project/media IDs so files stay attached to the correct project.
