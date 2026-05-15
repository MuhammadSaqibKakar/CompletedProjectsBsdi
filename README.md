# BSDI Completed Projects Dashboard

Light React/Vite dashboard generated from `Completed_BSDI-14-03-2026.pptx`.

## Run

```bash
npm run dev
```

Local URL:

```text
http://127.0.0.1:5173/
```

## Admin

Open the hidden admin panel with `Ctrl + Shift + E`.

Password:

```text
bsdi4332
```

Admin changes are saved in browser/desktop local storage and can be exported/imported as JSON from the admin panel. Images and videos can be uploaded directly in the editor; uploaded media is stored locally in the browser/desktop app media database. Drive fields remain view-only links for normal users.

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
- `public/data/projects.json`
- `public/media/*`

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
