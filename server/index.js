import compression from 'compression'
import express from 'express'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { clearReportCache, generateCachedReport, getReportStatus } from './report.js'
import { createDashboardStorage } from './storage.js'
import {
  generateTemplatePptReport,
  getTemplatePptDownloadPath,
  getTemplatePptStatus,
  hasWebsiteCreatedProjects,
} from './ppt-template-report.js'
import {
  databaseMediaDirectory,
  firstUsableMediaPath,
  restoreMissingDatabaseMedia,
  restoreSingleDatabaseMedia,
} from './media-library.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const bundledDbPath = path.join(rootDir, 'public', 'database', 'bsdi-db.json')
const dataDir = path.resolve(process.env.BSDI_DATA_DIR || path.join(rootDir, 'server-data'))
const mediaDir = path.join(dataDir, 'media')
const databaseMediaDir = databaseMediaDirectory(dataDir)
const tempDir = path.join(dataDir, 'tmp')
const reportsDir = path.join(dataDir, 'generated-reports')
const liveDbPath = path.join(dataDir, 'bsdi-db.json')
const canonicalPptFileName = 'Completed_BSDI-14-03-2026.pptx'
const port = Number(process.env.PORT || 4174)
const uploadLimit = Number(process.env.BSDI_MAX_UPLOAD_BYTES || 1024 * 1024 * 1024)
const dashboardStorage = createDashboardStorage({ bundledDbPath, liveDbPath })
const requireMysqlStorage =
  /^(1|true|required)$/i.test(process.env.BSDI_REQUIRE_MYSQL || '') ||
  (process.env.NODE_ENV === 'production' && process.env.BSDI_ALLOW_JSON_WRITES !== 'true')
let defaultReportJob = Promise.resolve()
let queuedDefaultReportData = null
let defaultReportBuilding = false
let templatePptJob = Promise.resolve()
let queuedTemplatePptData = null
let templatePptBuilding = false
let mediaRestoreJob = Promise.resolve()
let queuedMediaRestoreData = null
let mediaRestoreRunning = false

// The active DB and uploaded media must live outside dist/public so redeploys
// can replace code without wiping user-added data.
fsSync.mkdirSync(dataDir, { recursive: true })
fsSync.mkdirSync(mediaDir, { recursive: true })
fsSync.mkdirSync(databaseMediaDir, { recursive: true })
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

app.use(compression({
  filter: (req, res) => {
    // Reports and media are already compressed binary files. Re-compressing
    // PPTX/PDF/MP4/JPG delays downloads without reducing size meaningfully.
    if (
      req.path.startsWith('/api/report/') ||
      req.path.startsWith('/api/database-media/') ||
      req.path.startsWith('/synced-media/') ||
      req.path.startsWith('/database/media/')
    ) return false
    return compression.filter(req, res)
  },
}))
app.use(express.json({ limit: '100mb' }))
app.use('/synced-media', express.static(mediaDir, {
  acceptRanges: true,
  immutable: true,
  maxAge: '90d',
}))

function mediaContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.m4v' || extension === '.mp4') return 'video/mp4'
  if (extension === '.webm') return 'video/webm'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

function safeDatabaseMediaPath(relativePath, baseDir) {
  const resolvedBase = path.resolve(baseDir)
  const resolved = path.resolve(resolvedBase, relativePath)
  return resolved.startsWith(resolvedBase) ? resolved : ''
}

async function serveDatabaseMedia(req, res, next) {
  const relativePath = decodeURIComponent(req.path.replace(/^\/+/, ''))
  const requestedSrc = `/database/media/${relativePath.replace(/\\/g, '/')}`
  const persistentPath = safeDatabaseMediaPath(relativePath, databaseMediaDir)
  const bundledPath = safeDatabaseMediaPath(relativePath, path.join(distDir, 'database', 'media'))

  try {
    const state = await readDashboardState()
    const restoredPath = persistentPath && await restoreSingleDatabaseMedia({
      src: requestedSrc,
      data: state,
      templatePath: (await findCanonicalPptPath())?.filePath || '',
      dataDir,
    })
    const mediaPath = await firstUsableMediaPath([
      restoredPath,
      persistentPath,
      bundledPath,
    ])

    if (!mediaPath) {
      next()
      return
    }

    res.set({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=7776000, immutable',
      'Content-Type': mediaContentType(mediaPath),
    })
    res.sendFile(mediaPath)
  } catch (error) {
    next(error)
  }
}

app.use('/database/media', serveDatabaseMedia)
app.use('/api/database-media', serveDatabaseMedia)

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

function assertDurableWriteStorage() {
  if (!requireMysqlStorage || dashboardStorage.mode === 'mysql') return
  const error = new Error('MySQL database is required for production writes. Configure DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD before saving.')
  error.status = 503
  error.code = 'MYSQL_REQUIRED'
  throw error
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

function isDefaultReportFilter(filters = {}) {
  return (filters.phase || 'Total') === 'Total' && (filters.district || 'All Districts') === 'All Districts'
}

function pakistanFileStamp(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date).map((part) => [part.type, part.value]),
  )
  const hour = parts.hour === '24' ? '00' : parts.hour
  return `${parts.day} ${parts.month} ${parts.year} - ${hour}${parts.minute} PKT`
}

function pakistanDisplayStamp(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date).map((part) => [part.type, part.value]),
  )
  const hour = parts.hour === '24' ? '00' : parts.hour
  return `${parts.day} ${parts.month} ${parts.year}, ${hour}:${parts.minute}`
}

async function reportDownloadName(reportPath) {
  const stat = await fs.stat(reportPath)
  return `BSDI Completed Projects - ${pakistanFileStamp(stat.mtime)}.pdf`
}

async function pptDownloadName(reportPath) {
  const stat = await fs.stat(reportPath)
  return `BSDI Completed Projects - ${pakistanFileStamp(stat.mtime)}.pptx`
}

async function findCanonicalPptPath() {
  const candidates = [
    process.env.BSDI_CANONICAL_PPTX_PATH,
    process.env.BSDI_TEMPLATE_PPTX_PATH,
    path.join(dataDir, 'templates', canonicalPptFileName),
    path.join(dataDir, canonicalPptFileName),
    path.resolve(rootDir, '..', canonicalPptFileName),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return { filePath: candidate, stat }
    } catch {
      // Try the next configured location.
    }
  }
  return null
}

async function canonicalPptStatus() {
  const template = await findCanonicalPptPath()
  if (!template) {
    return {
      ready: false,
      fileName: canonicalPptFileName,
      readyAt: '',
      size: 0,
      source: 'canonical-template',
    }
  }
  return {
    ready: true,
    fileName: path.basename(template.filePath),
    readyAt: template.stat.mtime.toISOString(),
    size: template.stat.size,
    source: 'canonical-template',
  }
}

async function currentPptStatus(data) {
  const template = await findCanonicalPptPath()
  if (!template) return canonicalPptStatus()
  const status = await getTemplatePptStatus({
    data,
    templatePath: template.filePath,
    reportsDir,
  })
  return {
    ...status,
    building: templatePptBuilding || Boolean(queuedTemplatePptData),
  }
}

async function rebuildDefaultReports(data) {
  const defaultFilters = { phase: 'Total', district: 'All Districts' }
  const errors = []

  defaultReportBuilding = true
  try {
    await clearReportCache(reportsDir)
    await generateCachedReport({
      data,
      reportsDir,
      rootDir,
      dataDir,
      filters: defaultFilters,
      force: true,
    })
  } catch (error) {
    errors.push(error)
  } finally {
    defaultReportBuilding = false
  }

  if (errors.length) throw errors[0]
}

function queueDefaultReportRebuild(data) {
  queuedDefaultReportData = data
  defaultReportJob = defaultReportJob
    .catch(() => undefined)
    .then(async () => {
      while (queuedDefaultReportData) {
        const nextData = queuedDefaultReportData
        queuedDefaultReportData = null
        await rebuildDefaultReports(nextData)
      }
    })
    .catch((error) => {
      console.warn(`Default report rebuild failed: ${error.message}`)
    })
  return defaultReportJob
}

async function rebuildTemplatePptReport(data) {
  const template = await findCanonicalPptPath()
  if (!template) {
    console.warn(`Template PPT rebuild skipped: ${canonicalPptFileName} is missing`)
    return null
  }

  templatePptBuilding = true
  try {
    return await generateTemplatePptReport({
      data,
      templatePath: template.filePath,
      reportsDir,
      mediaDir,
    })
  } finally {
    templatePptBuilding = false
  }
}

function queueTemplatePptRebuild(data) {
  queuedTemplatePptData = data
  templatePptJob = templatePptJob
    .catch(() => undefined)
    .then(async () => {
      while (queuedTemplatePptData) {
        const nextData = queuedTemplatePptData
        queuedTemplatePptData = null
        await rebuildTemplatePptReport(nextData)
      }
    })
    .catch((error) => {
      console.warn(`Template PPT rebuild failed: ${error.message}`)
    })
  return templatePptJob
}

async function rebuildDatabaseMedia(data) {
  const template = await findCanonicalPptPath()
  if (!template) {
    console.warn(`Database media restore skipped: ${canonicalPptFileName} is missing`)
    return null
  }

  mediaRestoreRunning = true
  try {
    const result = await restoreMissingDatabaseMedia({
      data,
      templatePath: template.filePath,
      dataDir,
      logger: console,
    })
    console.log(`Database media restore complete: ${result.restored} restored, ${result.skipped} ready, ${result.missing} missing`)
    return result
  } finally {
    mediaRestoreRunning = false
  }
}

function queueDatabaseMediaRestore(data) {
  queuedMediaRestoreData = data
  mediaRestoreJob = mediaRestoreJob
    .catch(() => undefined)
    .then(async () => {
      while (queuedMediaRestoreData) {
        const nextData = queuedMediaRestoreData
        queuedMediaRestoreData = null
        await rebuildDatabaseMedia(nextData)
      }
    })
    .catch((error) => {
      console.warn(`Database media restore failed: ${error.message}`)
    })
  return mediaRestoreJob
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
      mysqlRequired: requireMysqlStorage,
      durableWrites: dashboardStorage.mode === 'mysql' || !requireMysqlStorage,
      mediaRestore: {
        running: mediaRestoreRunning,
        queued: Boolean(queuedMediaRestoreData),
      },
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
    const filters = {
      phase: req.query.phase || 'Total',
      district: req.query.district || 'All Districts',
    }
    const force = req.query.force === '1'
    if (isDefaultReportFilter(filters) && !force) {
      await defaultReportJob.catch(() => undefined)
    }
    const reportPath = await generateCachedReport({
      data: state,
      reportsDir,
      rootDir,
      dataDir,
      filters,
      force,
    })
    res.set('Cache-Control', 'no-store')
    res.download(reportPath, await reportDownloadName(reportPath))
  } catch (error) {
    next(error)
  }
})

app.get('/api/report/pptx', async (req, res, next) => {
  try {
    const state = await readDashboardState()
    const canonicalPpt = await findCanonicalPptPath()
    if (!canonicalPpt) {
      res.status(404).json({
        error: 'Exact canonical PowerPoint is missing on the server',
        fileName: canonicalPptFileName,
        expectedLocations: [
          'BSDI_CANONICAL_PPTX_PATH',
          'BSDI_TEMPLATE_PPTX_PATH',
          'BSDI_DATA_DIR/templates/Completed_BSDI-14-03-2026.pptx',
        ],
      })
      return
    }

    if (hasWebsiteCreatedProjects(state)) {
      await templatePptJob.catch(() => undefined)
    }

    const pptPath = await getTemplatePptDownloadPath({
      data: state,
      templatePath: canonicalPpt.filePath,
      reportsDir,
    })

    res.set('Cache-Control', 'no-store')
    res.download(pptPath, await pptDownloadName(pptPath))
  } catch (error) {
    next(error)
  }
})

app.get('/api/report/status', async (req, res, next) => {
  try {
    const filters = {
      phase: req.query.phase || 'Total',
      district: req.query.district || 'All Districts',
    }
    const status = await getReportStatus({ reportsDir, filters })
    const state = await readDashboardState()
    const templatePptStatus = await currentPptStatus(state)
    const isDefault = isDefaultReportFilter(filters)
    const anyDefaultReportWork = isDefault
      ? defaultReportBuilding || Boolean(queuedDefaultReportData)
      : false
    res.set('Cache-Control', 'no-store')
    res.json({
      ...status,
      building: anyDefaultReportWork,
      readyStamp: status.readyAt ? pakistanDisplayStamp(new Date(status.readyAt)) : '',
      pdf: {
        ...status,
        building: isDefault ? defaultReportBuilding || Boolean(queuedDefaultReportData) : false,
        readyStamp: status.readyAt ? pakistanDisplayStamp(new Date(status.readyAt)) : '',
      },
      ppt: {
        ...templatePptStatus,
        building: templatePptStatus.building,
        readyStamp: templatePptStatus.readyAt ? pakistanDisplayStamp(new Date(templatePptStatus.readyAt)) : '',
      },
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/state', async (req, res, next) => {
  try {
    assertDurableWriteStorage()
    const current = await assertAdminPassword(req)
    const incoming = req.body?.data || req.body
    if (!incoming || !Array.isArray(incoming.projects)) {
      res.status(400).json({ error: 'Invalid dashboard data' })
      return
    }
    const merged = mergeDashboardState(current, incoming)
    const saved = await dashboardStorage.writeState(merged, expectedRevisionFromRequest(req, incoming))
    queueDefaultReportRebuild(saved)
    queueTemplatePptRebuild(saved)
    queueDatabaseMediaRestore(saved)
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
    assertDurableWriteStorage()
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
    .then((state) => {
      queueDefaultReportRebuild(state)
      queueTemplatePptRebuild(state)
      queueDatabaseMediaRestore(state)
    })
    .catch((error) => {
      console.warn(`Default report startup rebuild skipped: ${error.message}`)
    })
})
