# BSDI Dashboard Operations Guide

This guide is for deploying, maintaining, and presenting the BSDI Completed Projects Dashboard.

## What The App Does

The dashboard presents completed BSDI project records with project details, phase filters, division and district navigation, media galleries, Drive folder links, and summary insights.

Admins can add or update:

- Phases
- Divisions
- Districts
- Projects
- Images
- Videos
- Drive folder links
- Cost, progress, contractor, agency, duration, and scope fields

## Deployment Modes

| Mode | Works offline | Shared edits | Use case |
| --- | --- | --- | --- |
| Static frontend | Yes, after loading once | No | Simple demo/view-only |
| Node Web Service | Yes, after sync/cache | Yes | Real multi-user deployment |
| Tauri desktop | Yes | Local unless connected to API | Offline desktop package |

Use the Node Web Service mode for production.

## Shared Database

The server keeps the active database at:

```text
BSDI_DATA_DIR/bsdi-db.json
```

Generated report PDFs are cached at:

```text
BSDI_DATA_DIR/generated-reports/
```

If `BSDI_DATA_DIR` is not set, local development uses:

```text
server-data/bsdi-db.json
```

On first start, the server seeds the active database from:

```text
public/database/bsdi-db.json
```

After that, the persistent server database becomes the source for online users.

For Hostinger production, set `BSDI_DATA_DIR` to a writable persistent folder outside the redeployed app files. If the frontend is hosted separately from the Node API, build the frontend with `VITE_BSDI_API_BASE_URL` set to the Node API domain.

When an online save succeeds, old PDF files are deleted and the default `Total / All Districts` report starts rebuilding. Filter-specific PDFs rebuild on demand when opened.

## Backup Routine

Before major edits or redeploys, back up:

```text
BSDI_DATA_DIR/bsdi-db.json
BSDI_DATA_DIR/media/
```

Recommended naming:

```text
bsdi-db-YYYY-MM-DD.json
media-YYYY-MM-DD.zip
```

## Offline Meeting Checklist

1. Open the deployed app while online.
2. Confirm the header says `Synced` when the Node API is enabled.
3. Press `Sync` before leaving for the meeting.
4. Open the important project media once so browser cache stores it.
5. Install the PWA in Chrome/Edge if needed.
6. Test offline mode by disconnecting internet and reloading.

## Admin Workflow

1. Press `Ctrl + Shift + E`.
2. Enter the admin password from the active database settings.
3. Add or edit records in Data Editor.
4. Press Save.
5. Watch the toast message:
   - `Synced online` means the shared DB was updated.
   - `Saved locally` means the update is waiting on that laptop.
6. Press Sync when internet/server access is available.

## Sync States

| Sync state | Meaning | Action |
| --- | --- | --- |
| `Synced` | Shared DB loaded | No action |
| `Pending sync` | Local edits need upload | Press Sync when online |

The Sync button stays visible. The Online/Offline pill shows internet status separately. The old local-cache label is intentionally hidden because the cache is an internal offline feature, not a user workflow.

## Common Issues

### `/api/state` returns 404

The app was deployed as a static site or frontend-only deployment.

Fix: deploy the repo as a Node/Express web service with:

```text
Build: npm ci && npm run build
Start: npm run start
```

### Data resets after redeploy

The server is writing to temporary storage.

Fix: set `BSDI_DATA_DIR` to a persistent disk/folder.

### Admin password differs after deploy

The live server DB may already exist and may not match `public/database/bsdi-db.json`.

Fix: check the server's active `BSDI_DATA_DIR/bsdi-db.json`.

### Uploaded media is missing

The server media directory is temporary or not backed up.

Fix: store uploads under persistent `BSDI_DATA_DIR/media`.

### Browser still shows old favicon/UI

The browser or PWA cache still has old assets.

Fix: hard refresh, clear site data, or reinstall the PWA.

## Recommended Hosting

For smooth use with many users:

- Node.js/Express support
- Persistent disk/storage
- At least 20 GB storage for current growth plans
- HTTPS enabled
- Build support for Git LFS, or deploy from a local folder after `git lfs pull`

If persistent file storage is uncertain, use an external database such as MySQL/Supabase and cloud storage for uploads.
