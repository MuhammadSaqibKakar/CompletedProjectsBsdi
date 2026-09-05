import compression from 'compression'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCleanupStorage } from './storage.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')
const dataDir = path.resolve(process.env.BSDI_DATA_DIR || path.join(rootDir, 'server-data'))
const storage = createCleanupStorage({ rootDir, dataDir })
const release = 'content-reset-2026-09-06'

// Finish the authorized legacy cleanup before accepting any requests.
await storage.clearLegacyData()
const initialCheck = await storage.verifyClean()
if (!initialCheck.clean) throw new Error('Legacy content cleanup is incomplete.')

const app = express()
app.disable('x-powered-by')
app.use(compression())
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  res.set('X-Content-Type-Options', 'nosniff')
  next()
})

app.get('/api/health', async (_req, res) => {
  const cleanup = await storage.verifyClean()
  res.status(cleanup.clean ? 200 : 503).json({
    ok: cleanup.clean,
    release,
    mode: 'maintenance',
    ...cleanup,
    projects: 0,
    media: 0,
    googleSheet: { enabled: false },
  })
})

// Old clients can read an empty state, but cannot restore cached snapshots.
app.get('/api/state', (_req, res) => {
  res.json({
    schemaVersion: 2,
    reset: release,
    phases: [],
    divisions: [],
    districts: [],
    projects: [],
    media: [],
    proposalDocuments: [],
    settings: {},
  })
})
app.get('/api/google-sheet/status', (_req, res) => {
  res.json({ enabled: false, running: false })
})

// Block old write, import, report and media routes before serving static files.
app.use(['/api', '/database', '/synced-media', '/media', '/brand', '/data'], (_req, res) => {
  res.status(410).json({ error: 'This content has been removed.' })
})
app.use((req, res, next) => {
  if (/\.(?:pdf|pptx?|ppsx?|potx?|png|jpe?g|gif|webp|avif|svg|ico|mp4|m4v|webm|mov|avi|zip)$/i.test(req.path)) {
    res.status(410).end()
    return
  }
  next()
})
app.use(express.static(distDir, { etag: false, lastModified: false, cacheControl: false, index: false }))
app.get('/', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
app.use((_req, res) => res.status(404).json({ error: 'Not found' }))
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error)
  console.error('Request failed:', error.code || error.name)
  res.status(503).json({ error: 'The website is temporarily unavailable.' })
})

const server = app.listen(Number(process.env.PORT || 4174), () => {
  console.log(`Completed Projects maintenance ready: ${release}; storage=${storage.mode}`)
})
async function shutdown() {
  server.close(async () => {
    await storage.close()
    process.exit(0)
  })
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
