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
| Node Web Service + MySQL | Yes, after sync/cache | Yes | Real multi-user deployment |
| Tauri desktop | Yes | Local unless connected to API | Offline desktop package |

Use the Node Web Service mode for production.

## Shared Database

Production should keep shared project data in MySQL. Set either the separate variables:

```text
DB_HOST=your-mysql-host
DB_PORT=3306
DB_NAME=your-database-name
DB_USER=your-database-user
DB_PASSWORD=your-database-password
BSDI_REQUIRE_MYSQL=true
```

or one connection string:

```text
DATABASE_URL=mysql://user:password@host:3306/database
```

The app creates and uses this table automatically:

```text
bsdi_dashboard_state
```

The server uses a revision number in that table. If two admins edit at the same time, a stale save is rejected with a sync-conflict message instead of overwriting another admin's work.

If MySQL variables are not set, the server falls back to JSON storage:

```text
BSDI_DATA_DIR/bsdi-db.json
```

For production, keep `BSDI_REQUIRE_MYSQL=true`. With that guard enabled, online saves and media uploads are blocked if MySQL is not connected, so new website data cannot silently fall back to JSON storage.

After deployment, confirm `/api/health` shows:

```json
{
  "storage": "mysql",
  "mysqlRequired": true,
  "durableWrites": true
}
```

Generated report PDFs, uploaded media, and the canonical PPT download live in the data directory:

```text
BSDI_DATA_DIR/generated-reports/
BSDI_DATA_DIR/media/
BSDI_DATA_DIR/templates/Completed_BSDI-14-03-2026.pptx
```

If `BSDI_DATA_DIR` is not set, local development uses `server-data/`. For Hostinger production, set `BSDI_DATA_DIR` to a writable folder outside redeployed app files, for example `../bsdi-data`.

On first start, MySQL or JSON fallback is seeded from:

```text
public/database/bsdi-db.json
```

After that, MySQL becomes the source of truth for online users. GitHub redeploys update code only; they do not overwrite the MySQL row.

If the frontend is hosted separately from the Node API, build the frontend with `VITE_BSDI_API_BASE_URL` set to the Node API domain.

When an online save succeeds, old generated PDF files are deleted and the default `Total / All Districts` report starts rebuilding in the background. The PDF button downloads that cached PDF directly with a Pakistan-time filename. The PPT button downloads only the exact canonical PowerPoint at `BSDI_DATA_DIR/templates/Completed_BSDI-14-03-2026.pptx`; if that file is missing, the server returns an error instead of generating a different deck. Project records remain in MySQL.

## Backup Routine

Before major edits or redeploys, back up:

```text
MySQL database/table bsdi_dashboard_state
BSDI_DATA_DIR/media/
```

Recommended naming:

```text
bsdi-mysql-YYYY-MM-DD.sql
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
   - `Sync conflict` means another admin saved first; sync latest and re-save after review.
6. Press Sync when internet/server access is available.

## Sync States

| Sync state | Meaning | Action |
| --- | --- | --- |
| `Synced` | Shared DB loaded | No action |
| `Pending sync` | Local edits need upload | Press Sync when online |
| `Sync conflict` | Another admin saved first | Sync latest, review, then save again |

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

The server is not connected to MySQL and is writing JSON data to temporary storage.

Fix: configure `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Keep `BSDI_DATA_DIR` persistent for uploads and generated PDFs.

### Admin password differs after deploy

The live MySQL row may already exist and may not match `public/database/bsdi-db.json`.

Fix: check `settings.adminPassword` in `bsdi_dashboard_state`. If MySQL is not configured, check `BSDI_DATA_DIR/bsdi-db.json`.

### Sync conflict appears

Another admin saved changes after this laptop loaded data.

Fix: press Sync to load the latest shared data, review the local change, then save again. This protection keeps users from silently overwriting each other.

### Uploaded media is missing

The server media directory is temporary or not backed up.

Fix: store uploads under persistent `BSDI_DATA_DIR/media`.

### Browser still shows old favicon/UI

The browser or PWA cache still has old assets.

Fix: hard refresh, clear site data, or reinstall the PWA.

## Recommended Hosting

For smooth use with many users:

- Node.js/Express support
- MySQL database for shared records
- Persistent disk/storage for uploads and generated PDFs
- At least 20 GB storage for current growth plans
- HTTPS enabled
- Build support for Git LFS, or deploy from a local folder after `git lfs pull`

If persistent file storage is uncertain, keep project records in MySQL and move uploaded media to a persistent disk or cloud storage before heavy production use.
