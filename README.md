# Completed Projects

Clean React/Vite and Express foundation for the next website redesign.
The current release displays a temporary holding page. It includes no project
records, media, document downloads, data imports, upload interface, or offline dashboard.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

For the full production application:

```sh
npm run build
npm start
```

`npm run lint` and `npm test` verify the source and cleanup safeguards.

## Hostinger

The existing GitHub `main` connection remains the deployment source. Keep the
build command `npm ci && npm run build`, start command `npm start`, and server
entry file `server/index.js`. `PORT` is supplied by the host.

This is an explicitly destructive maintenance release. Before serving requests,
it removes the legacy `bsdi_dashboard_state` table using the existing MySQL
environment settings, empties the validated app content directory from
`BSDI_DATA_DIR`, and removes the legacy canonical PowerPoint where it is within
the permitted application locations. It does not drop the MySQL database or
unrelated tables. Production requires the existing MySQL configuration so a
missing connection cannot be mistaken for successful cleanup.

`GET /api/health` checks the actual database and remaining content files.
`GET /api/state` returns empty collections. Legacy writes, imports, uploads,
media and report endpoints return HTTP 410. No automatic imports run.

The replacement `/sw.js` retires the old offline worker and removes this app's
cached data. The page removes the legacy local database and local storage on
visits. Devices that remain offline cannot receive this cleanup until they connect again.

Before implementing new persistent features, replace the temporary cleanup
startup in `server/index.js` and `server/storage.js`. Do not reuse the legacy
table for new records while this maintenance release is active.

Deleting content from the current branch does not rewrite GitHub history or
remove host-managed historical backups.
