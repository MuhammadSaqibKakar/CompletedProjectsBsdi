# BSDI Completed Projects

A district presentation portal for the exact 39 district names supplied by BSDI.
Visitors browse districts, view PowerPoint slides in the browser, and download
the original file. The site starts with no presentations.

## Administration

Open `/admin` and sign in with the configured administrator password.
Choose a district, select a `.pptx` file, optionally enter a title, and upload.
Only adding and deleting presentations are available to the administrator.
Deletion removes the stored file and its public listing.

Uploads must be self-contained PowerPoint `.pptx` files, at most 200 MB and
500 slides. Save legacy `.ppt` files as `.pptx` in PowerPoint first.
Password-protected decks, macros, embedded documents/programs, and externally
linked content are rejected. Embed media inside the presentation.

The browser viewer supports slide navigation, full screen and original-file
downloads. Browser rendering can differ from PowerPoint for specialized fonts,
SmartArt, transitions and advanced effects; the original download is unchanged.
No presentation is sent to an external document-viewing service.

## Development

Use Node.js 22.12 or newer.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4174`.
For frontend editing, `npm run dev` uses Vite; set the API server's
`PUBLIC_ORIGIN` to the exact Vite origin when testing admin actions through
its proxy. Public pages use the same API.

```sh
npm run lint
npm test
npm audit
```

Tests use temporary directories and synthetic slides. Test presentations are
never seeded into production.

## Hostinger deployment and storage

Continue deploying GitHub `main` with:

- Build: `npm ci && npm run build`
- Start: `npm start`
- Entry: `server/index.js`

Keep the existing `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD` (or MySQL `DATABASE_URL`) settings. Production requires MySQL.
TLS settings use `DB_SSL` / `MYSQL_SSL` and
`DB_SSL_REJECT_UNAUTHORIZED`.

Keep `BSDI_DATA_DIR` at the existing persistent location outside redeployed
application files. New presentations live in `BSDI_DATA_DIR/portal/files`.
MySQL tables `completed_presentations`, `completed_admin_sessions`, and
`completed_login_limits` store metadata, sessions, and login throttling.
Startup preserves uploaded content. The former destructive maintenance startup
has been removed.

Development without MySQL stores metadata in
`server-data/portal/metadata.json`. This JSON adapter is for a single local
process; production uses MySQL across workers.

Back up both MySQL and `portal/files` together. The deployed site uses
`https://completedprojects.online` as its allowed admin origin.
Set `PUBLIC_ORIGIN` explicitly if the production domain changes.

## Security

The administrator password is verified on the server using a salted scrypt
hash. Its plaintext is absent from the repository and browser bundle.
`ADMIN_PASSWORD_HASH` can override the initial verifier. Its format is
`scrypt$<64 hex salt>$<128 hex derived key>`, using N=32768, r=8,
p=1 and a 64-byte derived key. Rotate the verifier in Hostinger environment
settings; never put a plaintext password in frontend code.

Sessions are random, stored as hashes, expire after eight hours and use
HttpOnly, Secure, SameSite=Strict cookies in production. All write requests
require the correct origin, a valid session, and a session-specific CSRF token.
Database-backed login limits apply across workers, alongside request limits.

Uploads are authenticated before multipart parsing, checked for actual PPTX
structure, constrained for ZIP expansion and stored with generated filenames.
The viewer runs with an opaque origin under a server-enforced sandbox.
Security headers limit script sources, framing, external connections and
browser permissions. Presentation content cannot access the admin page.
Public file resources allow anonymous CORS only so the sandbox can read them;
admin endpoints do not permit cross-origin access.

`GET /api/health` confirms the running release, storage mode, district count
and published presentation count. Old dashboard import/write endpoints remain
unavailable. The retirement worker clears the earlier dashboard's offline
caches when old installations reconnect.
