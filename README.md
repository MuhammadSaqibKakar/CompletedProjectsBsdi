# BSDI Completed Projects

A district presentation portal for the exact 39 district names supplied by BSDI.
Visitors browse districts and view fast pre-rendered slide images. The original
PowerPoint file is private and can be downloaded only by a signed-in administrator.

## Administration

Open `/admin` and sign in with the configured administrator password.
Choose a district, select a `.pptx` file, optionally enter a title, and publish.
The browser creates one JPEG preview for every slide before it uploads the
PowerPoint and previews together. Only administrators can add, download, or
delete presentations. Deletion removes the stored original, all previews, and
the public listing.

Uploads must be self-contained PowerPoint `.pptx` files, at most 200 MB and
500 slides. Save legacy `.ppt` files as `.pptx` in PowerPoint first.
Password-protected decks, macros, embedded documents/programs, and externally
linked content are rejected. Embed media inside the presentation.

The public viewer loads only the current JPEG slide and preloads nearby slides,
so it opens without downloading or parsing the complete PowerPoint. It supports
slide navigation and full screen. No presentation is sent to an external
document-viewing service.

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

On Hostinger, set `BSDI_DATA_DIR` to the account's absolute private domain path,
`/home/{username}/domains/{domain}/bsdi-data`, beside the managed `nodejs` and
`public_html` directories. The server also derives that same location when the
standard Hostinger runtime path is visible. This location survives GitHub
deployments. On other production hosts, use an absolute, private persistent
folder outside deployment, build, temporary, and public web directories.
Startup refuses unsafe or unwritable locations. Original presentations live in
`BSDI_DATA_DIR/portal/files`; validated public previews live in
`BSDI_DATA_DIR/portal/previews`.
MySQL tables `completed_presentations`, `completed_admin_sessions`, and
`completed_login_limits` store metadata, sessions, and login throttling.
Startup preserves uploaded content. The former destructive maintenance startup
has been removed.

Each district has one presentation. A database unique index enforces this across
workers. The administrator deletes an available presentation before uploading its
replacement; if metadata survives but its original or previews are missing,
uploading again repairs that district directly. The district page opens the
pre-rendered slides in a viewport-sized viewer.

Development without MySQL stores metadata in
`server-data/portal/metadata.json`. This JSON adapter is for a single local
process; production uses MySQL across workers.

Back up MySQL, `portal/files`, and `portal/previews` together. The deployed site uses
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

Uploads are authenticated before multipart parsing. The server checks actual
PPTX structure and strictly validates the generated preview ZIP, JPEG signatures,
dimensions, slide count, filenames, expansion size, and paths before publishing.
Original files use generated private filenames.
The viewer runs in an opaque-origin sandboxed frame, even when its URL is
opened directly. The server emits an isolated `srcdoc` wrapper rather than
exposing the renderer as a standalone document. A document-level content policy
also protects HTML when Hostinger replaces the CSP response header.
Security headers limit script sources, framing, external connections and
browser permissions. Public users receive only JPEG previews; the original PPTX
has no public route. The authenticated admin download checks the server-side
session on every request. Public preview images allow anonymous CORS only so the
sandbox can read them; admin endpoints do not permit cross-origin access.

`GET /api/health` confirms the running release, storage mode, district count
and published presentation count. Old dashboard import/write endpoints remain
unavailable. The retirement worker clears the earlier dashboard's offline
caches when old installations reconnect.
