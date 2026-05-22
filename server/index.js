import compression from 'compression'
import express from 'express'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { clearReportCache, generateCachedReport, getReportStatus, reportFileName } from './report.js'
import { createDashboardStorage } from './storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const bundledDbPath = path.join(rootDir, 'public', 'database', 'bsdi-db.json')
const dataDir = path.resolve(process.env.BSDI_DATA_DIR || path.join(rootDir, 'server-data'))
const mediaDir = path.join(dataDir, 'media')
const tempDir = path.join(dataDir, 'tmp')
const reportsDir = path.join(dataDir, 'generated-reports')
const liveDbPath = path.join(dataDir, 'bsdi-db.json')
const port = Number(process.env.PORT || 4174)
const uploadLimit = Number(process.env.BSDI_MAX_UPLOAD_BYTES || 1024 * 1024 * 1024)
const dashboardStorage = createDashboardStorage({ bundledDbPath, liveDbPath })
const warmingReports = new Set()
const pendingReportWarmups = new Map()

// The active DB and uploaded media must live outside dist/public so redeploys
// can replace code without wiping user-added data.
fsSync.mkdirSync(dataDir, { recursive: true })
fsSync.mkdirSync(mediaDir, { recursive: true })
fsSync.mkdirSync(tempDir, { recursive: true })
fsSync.mkdirSync(reportsDir, { recursive: true })

const upload = multer({
  dest: tempDir,
  limits: {
    fileSize: uploadLimit,
    files: 200,
  },
})

const app = express()

app.use(compression())
app.use(express.json({ limit: '100mb' }))
app.use('/synced-media', express.static(mediaDir, {
  acceptRanges: true,
  immutable: true,
  maxAge: '90d',
}))

function sanitizePathPart(value, fallback = 'item') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || fallback
}

function extensionFor(file) {
  const original = path.extname(file.originalname || '')
  if (original) return original.toLowerCase()
  if (file.mimetype === 'image/jpeg') return '.jpg'
  if (file.mimetype === 'image/png') return '.png'
  if (file.mimetype === 'image/webp') return '.webp'
  if (file.mimetype === 'video/mp4') return '.mp4'
  if (file.mimetype === 'video/x-m4v') return '.m4v'
  return ''
}

async function readDashboardState() {
  return dashboardStorage.readState()
}

function getPasswordFromState(state) {
  // Keep the admin password in the DB/state only; do not hard-code it in code.
  return (
    state?.settings?.adminPassword ||
    state?.settings?.admin?.password ||
    ''
  )
}

async function assertAdminPassword(req) {
  const state = await readDashboardState()
  const expectedPassword = getPasswordFromState(state)
  const suppliedPassword =
    req.get('x-bsdi-admin-password') ||
    req.body?.password ||
    req.query?.password ||
    ''

  if (!expectedPassword || suppliedPassword !== expectedPassword) {
    const error = new Error('Admin password is incorrect')
    error.status = 401
    throw error
  }

  return state
}

function summarizeData(data) {
  const projects = Array.isArray(data.projects) ? data.projects : []
  const districts = new Set(projects.map((project) => project.district).filter(Boolean))
  const divisions = new Set(projects.map((project) => project.division).filter(Boolean))
  const media = projects.flatMap((project) => (Array.isArray(project.media) ? project.media : []))
  return {
    ...(data.totals || {}),
    projects: projects.length,
    divisions: Math.max(Number(data.totals?.divisions) || 0, divisions.size),
    districts: Math.max(Number(data.totals?.districts) || 0, districts.size),
    media: media.length,
    images: media.filter((item) => item.type !== 'video').length,
    videos: media.filter((item) => item.type === 'video').length,
  }
}

function mergeDashboardState(current, next) {
  const adminPassword = next?.settings?.adminPassword || getPasswordFromState(current)
  return {
    ...current,
    ...next,
    schemaVersion: Math.max(Number(next?.schemaVersion) || 0, Number(current?.schemaVersion) || 0, 3),
    databaseName: next?.databaseName || current?.databaseName || 'bsdi-completed-projects',
    generatedAt: current?.generatedAt || next?.generatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      ...(current?.settings || {}),
      ...(next?.settings || {}),
      adminPassword,
      editable: {
        phases: true,
        divisions: true,
        districts: true,
        ...(current?.settings?.editable || {}),
        ...(next?.settings?.editable || {}),
      },
    },
    totals: summarizeData(next || current),
  }
}

function expectedRevisionFromRequest(req, incoming) {
  return (
    req.get('x-bsdi-revision') ||
    req.body?.baseRevision ||
    incoming?._serverRevision ||
    incoming?.database?._serverRevision ||
    ''
  )
}

function reportFiltersFromRequest(req) {
  return {
    phase: req.body?.phase || req.query?.phase || 'Total',
    district: req.body?.district || req.query?.district || 'All Districts',
  }
}

function reportWarmKey(filters = {}) {
  return reportFileName(filters)
}

async function runReportWarmup(key) {
  warmingReports.add(key)
  try {
    while (pendingReportWarmups.has(key)) {
      const request = pendingReportWarmups.get(key)
      pendingReportWarmups.delete(key)
      if (request.force) {
        await fs.rm(path.join(reportsDir, reportFileName(request.filters)), { force: true })
      }
      await generateCachedReport({
        data: request.data,
        reportsDir,
        rootDir,
        dataDir,
        filters: request.filters,
      })
    }
  } catch (error) {
    console.warn(`Report warmup failed for ${key}: ${error.message}`)
  } finally {
    warmingReports.delete(key)
  }
}

function warmReportInBackground(data, filters = {}, options = {}) {
  const key = reportWarmKey(filters)
  const existing = pendingReportWarmups.get(key)
  pendingReportWarmups.set(key, {
    data,
    filters,
    force: Boolean(options.force || existing?.force),
  })
  if (warmingReports.has(key)) return
  void runReportWarmup(key)
}

function isReportPreparing(filters = {}) {
  const key = reportWarmKey(filters)
  return warmingReports.has(key) || pendingReportWarmups.has(key)
}

app.get('/api/health', async (_req, res, next) => {
  try {
    const state = await readDashboardState()
    res.json({
      ok: true,
      database: state.databaseName || 'bsdi-completed-projects',
      updatedAt: state.updatedAt || state.generatedAt || null,
      dataDir,
      storage: dashboardStorage.mode,
      revision: state._serverRevision || null,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/state', async (_req, res, next) => {
  try {
    const state = await readDashboardState()
    res.set('Cache-Control', 'no-store')
    res.json(state)
  } catch (error) {
    next(error)
  }
})

app.get('/api/report/pdf', async (req, res, next) => {
  try {
    const state = await readDashboardState()
    const reportPath = await generateCachedReport({
      data: state,
      reportsDir,
      rootDir,
      dataDir,
      filters: {
        phase: req.query.phase || 'Total',
        district: req.query.district || 'All Districts',
      },
    })
    res.set('Cache-Control', 'no-store')
    res.type('application/pdf')
    res.sendFile(reportPath)
  } catch (error) {
    next(error)
  }
})

app.get('/api/report/status', async (req, res, next) => {
  try {
    const filters = reportFiltersFromRequest(req)
    const status = await getReportStatus({ reportsDir, filters })
    res.set('Cache-Control', 'no-store')
    res.json({
      ok: true,
      ...filters,
      ...status,
      warming: isReportPreparing(filters),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/report/warm', async (req, res, next) => {
  try {
    const state = await readDashboardState()
    const filters = reportFiltersFromRequest(req)
    warmReportInBackground(state, filters)
    const status = await getReportStatus({ reportsDir, filters })
    res.set('Cache-Control', 'no-store')
    res.status(status.ready ? 200 : 202).json({
      ok: true,
      ...filters,
      ...status,
      warming: isReportPreparing(filters) || !status.ready,
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/state', async (req, res, next) => {
  try {
    const current = await assertAdminPassword(req)
    const incoming = req.body?.data || req.body
    if (!incoming || !Array.isArray(incoming.projects)) {
      res.status(400).json({ error: 'Invalid dashboard data' })
      return
    }
    const merged = mergeDashboardState(current, incoming)
    const saved = await dashboardStorage.writeState(merged, expectedRevisionFromRequest(req, incoming))
    await clearReportCache(reportsDir)
    warmReportInBackground(saved, { phase: 'Total', district: 'All Districts' }, { force: true })
    res.json({
      ok: true,
      updatedAt: saved.updatedAt,
      revision: saved._serverRevision || null,
      data: saved,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/media', upload.array('files', 200), async (req, res, next) => {
  try {
    await assertAdminPassword(req)

    // Store uploaded media by stable project ID so records can move in the DB
    // without breaking their image/video links.
    const projectId = sanitizePathPart(req.body.projectId, `project-${Date.now()}`)
    const mediaType = req.body.mediaType === 'video' ? 'video' : 'image'
    const startingOrder = Number(req.body.startingOrder || 0)
    const startingTypeCount = Number(req.body.startingTypeCount || 0)
    const projectMediaDir = path.join(mediaDir, projectId)
    await fs.mkdir(projectMediaDir, { recursive: true })

    const media = []
    for (const [index, file] of (req.files || []).entries()) {
      const ext = extensionFor(file)
      const originalBase = sanitizePathPart(path.basename(file.originalname || `file-${index + 1}`, ext), `file-${index + 1}`)
      const order = startingOrder + index + 1
      const typeOrder = startingTypeCount + index + 1
      const kind = mediaType === 'video' ? 'vid' : 'img'
      const mediaId = `${projectId}-online-${kind}-${String(typeOrder).padStart(2, '0')}-${Date.now()}-${index + 1}`
      const fileName = `${mediaId}-${originalBase}${ext}`
      const destination = path.join(projectMediaDir, fileName)

      await fs.rename(file.path, destination)
      media.push({
        id: mediaId,
        projectId,
        type: mediaType,
        src: `/synced-media/${projectId}/${fileName}`,
        name: file.originalname || fileName,
        originalName: file.originalname || fileName,
        mimeType: file.mimetype,
        size: file.size,
        order,
        uploaded: true,
        synced: true,
        updatedAt: new Date().toISOString(),
      })
    }

    res.json({ ok: true, media })
  } catch (error) {
    for (const file of req.files || []) {
      if (file.path && fsSync.existsSync(file.path)) {
        await fs.rm(file.path, { force: true })
      }
    }
    next(error)
  }
})

app.use(express.static(distDir))

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    next()
    return
  }

  const indexPath = path.join(distDir, 'index.html')
  if (fsSync.existsSync(indexPath)) {
    res.sendFile(indexPath)
    return
  }

  next()
})

app.use((error, _req, res, next) => {
  void next
  const status = error.status || 500
  res.status(status).json({
    error: error.message || 'Server error',
    code: error.code || undefined,
  })
})

app.listen(port, () => {
  console.log(`BSDI dashboard server running on port ${port}`)
  console.log(`Data directory: ${dataDir}`)
  readDashboardState()
    .then((state) => warmReportInBackground(state, { phase: 'Total', district: 'All Districts' }))
    .catch((error) => console.warn(`Initial report warmup skipped: ${error.message}`))
})
