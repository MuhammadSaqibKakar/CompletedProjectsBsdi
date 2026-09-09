/* eslint no-control-regex: "off" */
// Control characters are explicitly rejected in untrusted names and titles.
import express from 'express'
import compression from 'compression'
import helmet from 'helmet'
import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { districts, districtById } from './districts.js'
import { hashToken, readCookie, randomToken, safeEqual, sessionLifetime, verifyPassword, validatePasswordHash } from './auth.js'
import { defaultPasswordHash } from './admin-credential.js'
import { validatePptx, MAX_UPLOAD_BYTES } from './validate-pptx.js'
import { validateAndExtractPreviewZip, MAX_PREVIEW_ARCHIVE_BYTES } from './validate-previews.js'
import { isolatedViewerShell, withDocumentPolicy } from './viewer-shell.js'

export const release = 'district-portal-2026-09-09.3'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const SHA256 = /^[a-f0-9]{64}$/
const REPLACEMENT_CHUNK_BYTES = 2 * 1024 * 1024
const REPLACEMENT_SESSION_LIFETIME = 24 * 60 * 60 * 1000
const notFound = (res) => res.status(404).json({ error: 'Presentation not found.' })
const publicPresentation = (item, status) => ({
  id: item.id, districtId: item.districtId, title: item.title, originalName: item.originalName,
  size: item.size, slideCount: item.slideCount, uploadedAt: item.uploadedAt, available: status.available,
  originalAvailable: status.originalAvailable, previewAvailable: status.previewAvailable,
  preview: status.previewAvailable ? {
    ...status.preview,
    baseUrl: `/api/presentations/${item.id}/previews`,
  } : null,
  viewUrl: `/presentations/${item.id}/view`,
})

function samePresentation(first, second) {
  return ['id', 'districtId', 'title', 'originalName', 'storedName', 'size', 'slideCount', 'uploadedAt']
    .every((field) => first?.[field] === second[field])
}

export async function createApp({
  rootDir,
  dataDir,
  storage,
  env = process.env,
  fileStorageSource = 'local',
  fileStorageIssue = '',
}) {
  const production = env.NODE_ENV === 'production' || storage.mode === 'mysql' || /^(1|true|required)$/i.test(env.BSDI_REQUIRE_MYSQL || '')
  const distDir = path.join(rootDir, 'dist')
  const filesDir = path.join(dataDir, 'portal', 'files')
  const previewsDir = path.join(dataDir, 'portal', 'previews')
  const tempDir = path.join(dataDir, 'portal', 'tmp')
  for (const directory of [filesDir, previewsDir, tempDir]) {
    await fs.mkdir(directory, { recursive: true })
    if ((await fs.lstat(directory)).isSymbolicLink() || path.relative(directory, await fs.realpath(directory)) !== '') {
      throw new Error('Presentation storage must use a dedicated real directory.')
    }
  }
  const passwordHash = validatePasswordHash(env.ADMIN_PASSWORD_HASH || defaultPasswordHash)
  const cookieName = production ? '__Host-cp_session' : 'cp_session'
  const cookieOptions = { httpOnly: true, secure: production, sameSite: 'strict', path: '/' }
  const app = express()

  function previewDirectory(id) {
    if (!UUID.test(id)) throw Object.assign(new Error('Invalid presentation identifier.'), { status: 400 })
    const directory = path.join(previewsDir, id)
    if (path.dirname(directory) !== previewsDir) throw new Error('Invalid preview storage path.')
    return directory
  }

  async function writePreviewCacheKey(directory) {
    const cacheKey = randomUUID()
    await fs.writeFile(path.join(directory, 'cache-key'), `${cacheKey}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    })
    return cacheKey
  }

  async function originalFileAvailable(presentation) {
    const filePath = path.join(filesDir, presentation.storedName)
    const stat = await fs.lstat(filePath).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return Boolean(
      stat &&
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size === Number(presentation.size)
    )
  }

  async function previewStatus(presentation) {
    const directory = previewDirectory(presentation.id)
    const directoryStat = await fs.lstat(directory).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) return { available: false, preview: null }
    const manifestPath = path.join(directory, 'manifest.json')
    const cacheKeyPath = path.join(directory, 'cache-key')
    const slidesDir = path.join(directory, 'slides')
    const [manifestStat, cacheKeyStat, slidesStat] = await Promise.all([
      fs.lstat(manifestPath).catch(() => null),
      fs.lstat(cacheKeyPath).catch(() => null),
      fs.lstat(slidesDir).catch(() => null),
    ])
    if (!manifestStat?.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 8192 ||
        !slidesStat?.isDirectory() || slidesStat.isSymbolicLink()) return { available: false, preview: null }
    let manifest
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    } catch {
      return { available: false, preview: null }
    }
    const keys = manifest && !Array.isArray(manifest) && typeof manifest === 'object'
      ? Object.keys(manifest).sort().join(',') : ''
    if (keys !== 'format,height,slideCount,version,width' || manifest.version !== 1 || manifest.format !== 'jpg' ||
        manifest.slideCount !== Number(presentation.slideCount) || !Number.isSafeInteger(manifest.width) ||
        !Number.isSafeInteger(manifest.height)) return { available: false, preview: null }
    let cacheKey = `legacy-${Math.trunc(manifestStat.mtimeMs).toString(36)}`
    if (cacheKeyStat) {
      if (!cacheKeyStat.isFile() || cacheKeyStat.isSymbolicLink() || cacheKeyStat.size > 64) {
        return { available: false, preview: null }
      }
      cacheKey = (await fs.readFile(cacheKeyPath, 'utf8')).trim()
      if (!UUID.test(cacheKey)) return { available: false, preview: null }
    }
    const entries = await fs.readdir(slidesDir, { withFileTypes: true }).catch(() => [])
    if (entries.length !== manifest.slideCount) return { available: false, preview: null }
    const actual = new Set()
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) return { available: false, preview: null }
      actual.add(entry.name)
    }
    for (let number = 1; number <= manifest.slideCount; number += 1) {
      if (!actual.has(`slide-${String(number).padStart(4, '0')}.jpg`)) return { available: false, preview: null }
    }
    return { available: true, preview: { ...manifest, cacheKey } }
  }

  async function presentationAssetStatus(presentation) {
    const [originalAvailable, previewResult] = await Promise.all([
      originalFileAvailable(presentation),
      previewStatus(presentation),
    ])
    const previewAvailable = previewResult.available
    return {
      originalAvailable,
      previewAvailable,
      preview: previewResult.preview,
      available: originalAvailable && previewAvailable,
    }
  }

  async function removePreviewDirectory(id) {
    const directory = previewDirectory(id)
    await fs.rm(directory, { recursive: true, force: true })
  }

  async function serializePresentations(presentations) {
    return Promise.all(presentations.map(async (presentation) =>
      publicPresentation(presentation, await presentationAssetStatus(presentation))))
  }

  function replacementSessionDirectory(sessionId) {
    if (!UUID.test(sessionId)) {
      throw Object.assign(new Error('Invalid replacement upload identifier.'), { status: 400 })
    }
    const directory = path.join(tempDir, `replacement-${sessionId}`)
    if (path.dirname(directory) !== tempDir) throw new Error('Invalid replacement upload path.')
    return directory
  }

  function cleanUploadName(value, extension, label) {
    if (typeof value !== 'string') {
      throw Object.assign(new Error(`Choose a valid ${label} file.`), { status: 400 })
    }
    const name = path.basename(value.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200)
    if (!name || !name.toLowerCase().endsWith(extension)) {
      throw Object.assign(new Error(`Choose a valid ${label} file.`), { status: 400 })
    }
    return name
  }

  function replacementAsset(value, { extension, label, maxBytes }) {
    if (!value || Array.isArray(value) || typeof value !== 'object' ||
        Object.keys(value).sort().join(',') !== 'name,sha256,size' ||
        !Number.isSafeInteger(value.size) || value.size < 1 || value.size > maxBytes ||
        typeof value.sha256 !== 'string' || !SHA256.test(value.sha256.toLowerCase())) {
      throw Object.assign(new Error(`The ${label} upload details are invalid.`), { status: 400 })
    }
    return {
      name: cleanUploadName(value.name, extension, label),
      size: value.size,
      sha256: value.sha256.toLowerCase(),
      chunkCount: Math.ceil(value.size / REPLACEMENT_CHUNK_BYTES),
    }
  }

  function expectedReplacementChunkBytes(asset, index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= asset.chunkCount) return null
    const offset = index * REPLACEMENT_CHUNK_BYTES
    return Math.min(REPLACEMENT_CHUNK_BYTES, asset.size - offset)
  }

  function replacementChunkPath(directory, assetName, index) {
    if (!['presentation', 'previews'].includes(assetName) || !Number.isSafeInteger(index) || index < 0) {
      throw Object.assign(new Error('Invalid replacement upload chunk.'), { status: 400 })
    }
    const filePath = path.join(directory, `${assetName}-${String(index).padStart(6, '0')}.part`)
    if (path.dirname(filePath) !== directory) throw new Error('Invalid replacement chunk path.')
    return filePath
  }

  async function cleanupStaleReplacementSessions() {
    const cutoff = Date.now() - REPLACEMENT_SESSION_LIFETIME
    const entries = await fs.readdir(tempDir, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('replacement-') &&
        UUID.test(entry.name.slice('replacement-'.length)))
      .map(async (entry) => {
        const directory = path.join(tempDir, entry.name)
        const stat = await fs.lstat(directory).catch(() => null)
        if (stat?.isDirectory() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) {
          await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
        }
      }))
  }

  async function readReplacementSession(req, sessionId) {
    const directory = replacementSessionDirectory(sessionId)
    const stat = await fs.lstat(directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw Object.assign(new Error('Replacement upload not found. Start it again.'), { status: 404 })
    }
    const manifestPath = path.join(directory, 'manifest.json')
    const manifestStat = await fs.lstat(manifestPath).catch(() => null)
    if (!manifestStat?.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 8192) {
      throw Object.assign(new Error('Replacement upload is invalid. Start it again.'), { status: 400 })
    }
    let manifest
    try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) } catch {
      throw Object.assign(new Error('Replacement upload is invalid. Start it again.'), { status: 400 })
    }
    if (manifest?.version !== 1 || manifest.sessionId !== sessionId || !UUID.test(manifest.presentationId) ||
        !UUID.test(manifest.candidateId) || !districtById.has(manifest.districtId) ||
        !safeEqual(manifest.ownerTokenHash, req.adminSession.tokenHash) ||
        !manifest.assets?.presentation || !manifest.assets?.previews) {
      throw Object.assign(new Error('Replacement upload not found. Start it again.'), { status: 404 })
    }
    if (!Number.isFinite(manifest.createdAt) || Date.now() - manifest.createdAt > REPLACEMENT_SESSION_LIFETIME) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
      throw Object.assign(new Error('Replacement upload expired. Start it again.'), { status: 410 })
    }
    return { directory, manifest }
  }

  async function assembleReplacementAsset(directory, assetName, asset) {
    const stagingPath = path.join(directory, `.${assetName}-${randomUUID()}.assembling`)
    const completePath = path.join(directory, `${assetName}.complete`)
    const digest = createHash('sha256')
    const output = await fs.open(stagingPath, 'wx', 0o600)
    let outputBytes = 0
    try {
      for (let index = 0; index < asset.chunkCount; index += 1) {
        const expectedBytes = expectedReplacementChunkBytes(asset, index)
        const chunkPath = replacementChunkPath(directory, assetName, index)
        const chunkStat = await fs.lstat(chunkPath).catch((error) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (!chunkStat?.isFile() || chunkStat.isSymbolicLink() || chunkStat.size !== expectedBytes) {
          throw Object.assign(new Error(`Upload ${labelForAsset(assetName)} chunk ${index + 1} again.`), { status: 409 })
        }
        const chunk = await fs.readFile(chunkPath).catch((error) => {
          if (error.code === 'ENOENT') {
            throw Object.assign(new Error(`Upload ${labelForAsset(assetName)} chunk ${index + 1} again.`), { status: 409 })
          }
          throw error
        })
        if (chunk.length !== expectedBytes) {
          throw Object.assign(new Error(`Upload ${labelForAsset(assetName)} chunk ${index + 1} again.`), { status: 409 })
        }
        digest.update(chunk)
        let offset = 0
        while (offset < chunk.length) {
          const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset, outputBytes)
          if (!bytesWritten) throw new Error('The replacement upload could not be assembled.')
          offset += bytesWritten
          outputBytes += bytesWritten
        }
      }
      await output.sync()
    } finally {
      await output.close()
    }
    try {
      if (outputBytes !== asset.size || digest.digest('hex') !== asset.sha256) {
        throw Object.assign(new Error(`The ${labelForAsset(assetName)} integrity check failed. Start the upload again.`), { status: 400 })
      }
      await fs.rm(completePath, { force: true })
      await fs.rename(stagingPath, completePath)
      await fs.chmod(completePath, 0o600)
      return completePath
    } catch (error) {
      await fs.rm(stagingPath, { force: true }).catch(() => {})
      throw error
    }
  }

  function labelForAsset(assetName) {
    return assetName === 'presentation' ? 'PowerPoint' : 'preview ZIP'
  }

  async function cleanupReplacementSessionPayload(directory) {
    const entries = await fs.readdir(directory).catch(() => [])
    await Promise.all(entries
      .filter((name) => /^(?:presentation|previews)-\d{6}\.part$/.test(name) ||
        /^(?:presentation|previews)\.complete$/.test(name) ||
        /^\.(?:presentation|previews)-[a-f0-9-]+\.assembling$/.test(name) || name.endsWith('.incoming'))
      .map((name) => fs.rm(path.join(directory, name), { recursive: true, force: true }).catch(() => {})))
  }

  async function writeReplacementResult(directory, presentation) {
    const result = { presentation }
    const resultPath = path.join(directory, 'result.json')
    const temporaryPath = path.join(directory, `.result-${randomUUID()}.tmp`)
    const handle = await fs.open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(result)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.rm(resultPath, { force: true })
      await fs.rename(temporaryPath, resultPath)
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
    }
    await cleanupReplacementSessionPayload(directory)
    return result
  }

  async function recoverPublishedReplacement(manifest) {
    const candidate = await storage.getPresentation(manifest.candidateId)
    if (!candidate || candidate.districtId !== manifest.districtId || candidate.title !== manifest.title ||
        candidate.originalName !== manifest.assets.presentation.name ||
        Number(candidate.size) !== manifest.assets.presentation.size) return null
    const status = await presentationAssetStatus(candidate)
    return status.available ? publicPresentation(candidate, status) : null
  }

  async function installReplacement(previous, { pptPath, previewZipPath, pptSize, originalName, title, candidateId }) {
    let finalPath
    let finalPreviewPath
    let stagingPreviewPath
    let saved = false
    let retainFinalArtifacts = false
    try {
      const { slideCount } = await validatePptx(pptPath)
      const id = candidateId || randomUUID()
      const storedName = `${id}.pptx`
      stagingPreviewPath = path.join(tempDir, `${id}-${randomUUID()}-previews`)
      const preview = await validateAndExtractPreviewZip(previewZipPath, {
        expectedSlideCount: slideCount,
        outputDir: stagingPreviewPath,
      })
      await writePreviewCacheKey(stagingPreviewPath)
      finalPath = path.join(filesDir, storedName)
      finalPreviewPath = previewDirectory(id)
      await fs.rename(pptPath, finalPath)
      await fs.chmod(finalPath, 0o600)
      const handle = await fs.open(finalPath, 'r+')
      try {
        const stat = await handle.stat()
        if (stat.size !== pptSize) throw new Error('The replacement presentation was not saved completely.')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(stagingPreviewPath, finalPreviewPath)
      stagingPreviewPath = null
      const metadata = { id, districtId: previous.districtId, title, originalName, storedName,
        size: pptSize, slideCount, uploadedAt: new Date().toISOString() }
      const stagedStatus = await presentationAssetStatus(metadata)
      if (!stagedStatus.available || stagedStatus.preview?.slideCount !== preview.slideCount) {
        throw new Error('The replacement presentation and slide previews were not saved completely.')
      }
      let presentation
      try {
        presentation = await storage.replacePresentation(previous.id, metadata)
        saved = true
      } catch (error) {
        if (storage.mode !== 'mysql') throw error
        let observed
        try {
          observed = await storage.getPresentation(id)
        } catch {
          retainFinalArtifacts = true
          throw error
        }
        if (!samePresentation(observed, metadata)) throw error
        presentation = observed
        saved = true
      }
      const publishedStatus = await presentationAssetStatus(presentation)
      if (!publishedStatus.available || publishedStatus.preview?.slideCount !== preview.slideCount) {
        throw new Error('The replacement presentation did not become available.')
      }
      const previousPath = path.join(filesDir, previous.storedName)
      if (previousPath !== finalPath) {
        await fs.unlink(previousPath).catch((error) => {
          if (error.code !== 'ENOENT') console.error('Previous presentation cleanup failed.')
        })
      }
      if (previous.id !== id) {
        await removePreviewDirectory(previous.id).catch(() => {
          console.error('Previous slide preview cleanup failed.')
        })
      }
      return publicPresentation(presentation, publishedStatus)
    } finally {
      if (stagingPreviewPath) await fs.rm(stagingPreviewPath, { recursive: true, force: true }).catch(() => {})
      if (finalPath && !saved && !retainFinalArtifacts) await fs.unlink(finalPath).catch(() => {})
      if (finalPreviewPath && !saved && !retainFinalArtifacts) {
        await removePreviewDirectory(path.basename(finalPreviewPath)).catch(() => {})
      }
    }
  }
  await cleanupStaleReplacementSessions()
  // Hostinger places the Node process behind its local reverse proxy.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal')
  app.disable('x-powered-by')
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'blob:', 'data:'], frameSrc: ["'self'"], frameAncestors: ["'self'"],
      objectSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"],
      upgradeInsecureRequests: production ? [] : null,
    } },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: production ? { maxAge: 31536000 } : false,
    crossOriginEmbedderPolicy: false,
  }))
  app.use(compression({ filter: (req, res) => !/\/(file|download)$/.test(req.path) && compression.filter(req, res) }))
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    next()
  })
  app.use('/api', rateLimit({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and try again.' } }))
  app.use(express.json({ limit: '8kb', strict: true }))

  function requireOrigin(req, res, next) {
    const allowed = env.PUBLIC_ORIGIN || (production ? 'https://completedprojects.online' : `${req.protocol}://${req.get('host')}`)
    const origin = req.get('origin')
    if (origin !== allowed || (req.get('sec-fetch-site') && !['same-origin', 'none'].includes(req.get('sec-fetch-site')))) {
      return res.status(403).json({ error: 'This request must be made from this website.' })
    }
    next()
  }
  async function requireAdmin(req, res, next) {
    const token = readCookie(req, cookieName)
    req.adminSession = token ? await storage.getSession(hashToken(token)) : null
    if (!req.adminSession) return res.status(401).json({ error: 'Please sign in to continue.' })
    next()
  }
  function requireCsrf(req, res, next) {
    if (!safeEqual(req.get('x-csrf-token'), req.adminSession.csrfToken)) {
      return res.status(403).json({ error: 'Your session could not be verified. Sign in again.' })
    }
    next()
  }

  app.get('/api/health', async (_req, res) => {
    const presentations = await storage.listPresentations()
    const statuses = await Promise.all(presentations.map(presentationAssetStatus))
    const availablePresentations = statuses.filter((status) => status.available).length
    const missingOriginalFiles = statuses.filter((status) => !status.originalAvailable).length
    const missingPreviews = statuses.filter((status) => !status.previewAvailable).length
    const unavailablePresentations = presentations.length - availablePresentations
    res.json({ ok: unavailablePresentations === 0, release, presentationStorage: fileStorageSource,
      ...(fileStorageIssue ? { presentationStorageIssue: fileStorageIssue } : {}),
      storage: storage.mode, districts: districts.length, presentations: presentations.length,
      availablePresentations, missingFiles: missingOriginalFiles, missingOriginalFiles,
      missingPreviews, unavailablePresentations })
  })
  app.get('/api/districts', async (_req, res) => {
    const presentations = await storage.listPresentations()
    const counts = new Map()
    for (const item of presentations) {
      if ((await presentationAssetStatus(item)).available) {
        counts.set(item.districtId, (counts.get(item.districtId) || 0) + 1)
      }
    }
    res.json({ districts: districts.map((district) => ({ ...district, presentationCount: counts.get(district.id) || 0 })),
      totalPresentations: presentations.length })
  })
  app.get('/api/districts/:id', async (req, res) => {
    const district = districtById.get(req.params.id)
    if (!district) return res.status(404).json({ error: 'District not found.' })
    const presentations = await storage.listPresentations(district.id)
    res.json({ district, presentations: await serializePresentations(presentations) })
  })

  app.get('/api/admin/session', async (req, res) => {
    const token = readCookie(req, cookieName)
    const session = token ? await storage.getSession(hashToken(token)) : null
    res.json(session ? { authenticated: true, csrfToken: session.csrfToken } : { authenticated: false })
  })
  let passwordChecks = 0
  app.post('/api/admin/login', requireOrigin, async (req, res) => {
    const limiter = await storage.consumeLoginAttempt(hashToken(`ip:${ipKeyGenerator(req.ip)}`))
    if (!limiter.allowed) {
      res.set('Retry-After', String(limiter.retryAfter))
      return res.status(429).json({ error: 'Too many sign-in attempts. Please wait and try again.' })
    }
    const globalLimiter = await storage.consumeLoginAttempt(hashToken('admin-login-global'), { limit: 100 })
    if (!globalLimiter.allowed || passwordChecks >= 2) {
      const seconds = Math.max(limiter.retryAfter, globalLimiter.retryAfter, 10)
      res.set('Retry-After', String(seconds))
      return res.status(429).json({ error: 'Too many sign-in attempts. Please wait and try again.' })
    }
    passwordChecks += 1
    let valid
    try { valid = await verifyPassword(req.body?.password, passwordHash) } finally { passwordChecks -= 1 }
    if (!valid) return res.status(401).json({ error: 'The password is incorrect.' })
    const oldToken = readCookie(req, cookieName)
    if (oldToken) await storage.deleteSession(hashToken(oldToken))
    const token = randomToken()
    const csrfToken = randomToken()
    await storage.createSession({ tokenHash: hashToken(token), csrfToken, expiresAt: Date.now() + sessionLifetime })
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionLifetime })
    res.json({ authenticated: true, csrfToken })
  })
  app.post('/api/admin/logout', requireOrigin, requireAdmin, requireCsrf, async (req, res) => {
    await storage.deleteSession(req.adminSession.tokenHash)
    res.clearCookie(cookieName, cookieOptions)
    res.json({ ok: true })
  })

  const upload = multer({
    dest: tempDir,
    limits: { fileSize: Math.max(MAX_UPLOAD_BYTES, MAX_PREVIEW_ARCHIVE_BYTES), files: 2, fields: 1, fieldSize: 640, parts: 4 },
    fileFilter: (_req, file, callback) => {
      if (file.fieldname === 'file' && /\.pptx$/i.test(file.originalname)) return callback(null, true)
      if (file.fieldname === 'previews' && /\.zip$/i.test(file.originalname)) return callback(null, true)
      callback(Object.assign(new Error('Choose one PowerPoint file and its generated preview ZIP.'), { status: 400 }))
    },
  })
  const previewOnlyUpload = multer({
    dest: tempDir,
    limits: { fileSize: MAX_PREVIEW_ARCHIVE_BYTES, files: 1, fields: 1, parts: 2 },
    fileFilter: (_req, file, callback) => {
      if (file.fieldname === 'previews' && /\.zip$/i.test(file.originalname)) return callback(null, true)
      callback(Object.assign(new Error('Choose the generated preview ZIP.'), { status: 400 }))
    },
  })
  // Authentication and CSRF checks run before multipart data reaches disk.
  app.post('/api/admin/districts/:id/presentations', requireOrigin, requireAdmin, requireCsrf,
    (req, res, next) => districtById.has(req.params.id) ? next() : res.status(404).json({ error: 'District not found.' }),
    async (req, res, next) => {
      const [existing] = await storage.listPresentations(req.params.id)
      if (existing && (await presentationAssetStatus(existing)).available) {
        return res.status(409).json({ error: 'This district already has a presentation. Delete it before uploading another.' })
      }
      req.orphanedPresentation = existing || null
      next()
    },
    upload.fields([{ name: 'file', maxCount: 1 }, { name: 'previews', maxCount: 1 }]), async (req, res) => {
      const pptUpload = req.files?.file?.[0]
      const previewUpload = req.files?.previews?.[0]
      if (!pptUpload || !previewUpload) {
        await Promise.all(Object.values(req.files || {}).flat().map((uploaded) =>
          fs.unlink(uploaded.path).catch((error) => { if (error.code !== 'ENOENT') console.error('Temporary upload cleanup failed.') })))
        return res.status(400).json({ error: 'Choose a PowerPoint file and wait for every slide preview to finish.' })
      }
      let finalPath
      let finalPreviewPath
      let stagingPreviewPath
      let saved = false
      let retainFinalArtifacts = false
      try {
        if (Object.keys(req.body).some((key) => key !== 'title') ||
            (req.body.title !== undefined && typeof req.body.title !== 'string')) {
          return res.status(400).json({ error: 'Upload one presentation, its previews, and an optional title.' })
        }
        const originalName = path.basename(pptUpload.originalname.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200)
        const title = String(req.body.title || originalName.replace(/\.pptx$/i, '')).trim()
        if (!title || title.length > 160 || /[\x00-\x1f\x7f]/.test(title)) {
          return res.status(400).json({ error: 'Use a title between 1 and 160 characters.' })
        }
        const { slideCount } = await validatePptx(pptUpload.path)
        const id = randomUUID()
        const storedName = `${id}.pptx`
        stagingPreviewPath = path.join(tempDir, `${id}-${randomUUID()}-previews`)
        const preview = await validateAndExtractPreviewZip(previewUpload.path, {
          expectedSlideCount: slideCount,
          outputDir: stagingPreviewPath,
        })
        await writePreviewCacheKey(stagingPreviewPath)
        finalPath = path.join(filesDir, storedName)
        finalPreviewPath = previewDirectory(id)
        await fs.rename(pptUpload.path, finalPath)
        await fs.chmod(finalPath, 0o600)
        const handle = await fs.open(finalPath, 'r+')
        try {
          const stat = await handle.stat()
          if (stat.size !== pptUpload.size) throw new Error('The uploaded presentation was not saved completely.')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await fs.rename(stagingPreviewPath, finalPreviewPath)
        stagingPreviewPath = null
        const metadata = { id, districtId: req.params.id, title, originalName, storedName,
          size: pptUpload.size, slideCount, uploadedAt: new Date().toISOString() }
        const publishedStatus = await presentationAssetStatus(metadata)
        if (!publishedStatus.available || publishedStatus.preview?.slideCount !== preview.slideCount) {
          throw new Error('The presentation and slide previews were not saved completely.')
        }
        let presentation
        try {
          presentation = req.orphanedPresentation
            ? await storage.replacePresentation(req.orphanedPresentation.id, metadata)
            : await storage.addPresentation(metadata)
          saved = true
        } catch (error) {
          if (storage.mode !== 'mysql') throw error
          let observed
          try {
            observed = await storage.getPresentation(id)
          } catch {
            // A failed verification leaves both durable assets in place. A later
            // database recovery can safely reconnect them.
            retainFinalArtifacts = true
            throw error
          }
          if (!samePresentation(observed, metadata)) throw error
          presentation = observed
          saved = true
        }
        if (req.orphanedPresentation) {
          const orphanPath = path.join(filesDir, req.orphanedPresentation.storedName)
          if (orphanPath !== finalPath) {
            await fs.unlink(orphanPath).catch((error) => {
              if (error.code !== 'ENOENT') console.error('Orphaned presentation cleanup failed.')
            })
          }
          if (req.orphanedPresentation.id !== id) {
            await removePreviewDirectory(req.orphanedPresentation.id).catch(() => {
              console.error('Orphaned slide preview cleanup failed.')
            })
          }
        }
        res.status(201).json({ presentation: publicPresentation(presentation, await presentationAssetStatus(presentation)) })
      } finally {
        await Promise.all([pptUpload.path, previewUpload.path].map((temporaryPath) =>
          fs.unlink(temporaryPath).catch((error) => { if (error.code !== 'ENOENT') console.error('Temporary upload cleanup failed.') })))
        if (stagingPreviewPath) await fs.rm(stagingPreviewPath, { recursive: true, force: true }).catch(() => {})
        if (finalPath && !saved && !retainFinalArtifacts) await fs.unlink(finalPath).catch(() => {})
        if (finalPreviewPath && !saved && !retainFinalArtifacts) {
          await removePreviewDirectory(path.basename(finalPreviewPath)).catch(() => {})
        }
      }
    })
  app.post('/api/admin/presentations/:id/replace', requireOrigin, requireAdmin, requireCsrf,
    (req, res, next) => UUID.test(req.params.id) ? next() : notFound(res),
    upload.fields([{ name: 'file', maxCount: 1 }, { name: 'previews', maxCount: 1 }]), async (req, res) => {
      const pptUpload = req.files?.file?.[0]
      const previewUpload = req.files?.previews?.[0]
      if (!pptUpload || !previewUpload) {
        await Promise.all(Object.values(req.files || {}).flat().map((uploaded) =>
          fs.unlink(uploaded.path).catch((error) => { if (error.code !== 'ENOENT') console.error('Temporary replacement upload cleanup failed.') })))
        return res.status(400).json({ error: 'Choose a PowerPoint file and wait for every slide preview to finish.' })
      }
      try {
        if (Object.keys(req.body).some((key) => key !== 'title') ||
            (req.body.title !== undefined && typeof req.body.title !== 'string')) {
          return res.status(400).json({ error: 'Upload one replacement presentation, its previews, and an optional title.' })
        }
        const previous = await storage.getPresentation(req.params.id)
        if (!previous) return notFound(res)
        const originalName = path.basename(pptUpload.originalname.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200)
        const title = String(req.body.title === undefined ? previous.title : req.body.title).trim()
        if (!title || title.length > 160 || /[\x00-\x1f\x7f]/.test(title)) {
          return res.status(400).json({ error: 'Use a title between 1 and 160 characters.' })
        }
        const presentation = await installReplacement(previous, {
          pptPath: pptUpload.path,
          previewZipPath: previewUpload.path,
          pptSize: pptUpload.size,
          originalName,
          title,
        })
        res.json({ presentation })
      } finally {
        await Promise.all([pptUpload.path, previewUpload.path].map((temporaryPath) =>
          fs.unlink(temporaryPath).catch((error) => { if (error.code !== 'ENOENT') console.error('Temporary replacement upload cleanup failed.') })))
      }
    })
  app.post('/api/admin/presentations/:id/replacement-sessions', requireOrigin, requireAdmin, requireCsrf,
    (req, res, next) => UUID.test(req.params.id) ? next() : notFound(res), async (req, res) => {
      const previous = await storage.getPresentation(req.params.id)
      if (!previous) return notFound(res)
      if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' ||
          Object.keys(req.body).some((key) => !['assets', 'title'].includes(key)) ||
          (req.body.title !== undefined && typeof req.body.title !== 'string') ||
          !req.body.assets || Array.isArray(req.body.assets) || typeof req.body.assets !== 'object' ||
          Object.keys(req.body.assets).sort().join(',') !== 'presentation,previews') {
        return res.status(400).json({ error: 'Provide one PowerPoint and one preview ZIP.' })
      }
      const title = String(req.body.title === undefined ? previous.title : req.body.title).trim()
      if (!title || title.length > 160 || /[\x00-\x1f\x7f]/.test(title)) {
        return res.status(400).json({ error: 'Use a title between 1 and 160 characters.' })
      }
      const assets = {
        presentation: replacementAsset(req.body.assets.presentation, {
          extension: '.pptx', label: 'PowerPoint', maxBytes: MAX_UPLOAD_BYTES,
        }),
        previews: replacementAsset(req.body.assets.previews, {
          extension: '.zip', label: 'preview ZIP', maxBytes: MAX_PREVIEW_ARCHIVE_BYTES,
        }),
      }
      await cleanupStaleReplacementSessions()
      const sessionId = randomUUID()
      const directory = replacementSessionDirectory(sessionId)
      await fs.mkdir(directory, { mode: 0o700 })
      const createdAt = Date.now()
      const manifest = {
        version: 1,
        sessionId,
        presentationId: previous.id,
        candidateId: randomUUID(),
        districtId: previous.districtId,
        ownerTokenHash: req.adminSession.tokenHash,
        createdAt,
        title,
        assets,
      }
      await fs.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`, {
        encoding: 'utf8', mode: 0o600, flag: 'wx',
      })
      res.status(201).json({
        sessionId,
        chunkSize: REPLACEMENT_CHUNK_BYTES,
        expiresAt: new Date(createdAt + REPLACEMENT_SESSION_LIFETIME).toISOString(),
        assets: {
          presentation: { chunkCount: assets.presentation.chunkCount },
          previews: { chunkCount: assets.previews.chunkCount },
        },
      })
    })
  app.get('/api/admin/presentation-replacement-sessions/:sessionId', requireAdmin, async (req, res) => {
    const { directory, manifest } = await readReplacementSession(req, req.params.sessionId)
    const resultPath = path.join(directory, 'result.json')
    const result = await fs.readFile(resultPath, 'utf8').then(JSON.parse).catch(() => null)
    const received = {}
    for (const assetName of ['presentation', 'previews']) {
      const asset = manifest.assets[assetName]
      received[assetName] = []
      for (let index = 0; index < asset.chunkCount; index += 1) {
        const stat = await fs.lstat(replacementChunkPath(directory, assetName, index)).catch(() => null)
        if (stat?.isFile() && !stat.isSymbolicLink() && stat.size === expectedReplacementChunkBytes(asset, index)) {
          received[assetName].push(index)
        }
      }
    }
    res.json({ sessionId: manifest.sessionId, received, finalized: Boolean(result), ...(result || {}) })
  })
  app.put('/api/admin/presentation-replacement-sessions/:sessionId/assets/:asset/chunks/:index',
    requireOrigin, requireAdmin, requireCsrf,
    express.raw({ type: 'application/octet-stream', limit: REPLACEMENT_CHUNK_BYTES + 1 }), async (req, res) => {
      const { directory, manifest } = await readReplacementSession(req, req.params.sessionId)
      const assetName = req.params.asset
      const asset = manifest.assets[assetName]
      const index = /^(0|[1-9]\d*)$/.test(req.params.index) ? Number(req.params.index) : NaN
      const expectedBytes = asset && Number.isSafeInteger(index) ? expectedReplacementChunkBytes(asset, index) : null
      const suppliedHash = String(req.get('x-chunk-sha256') || '').toLowerCase()
      if (!asset || expectedBytes === null || !Buffer.isBuffer(req.body) || req.body.length !== expectedBytes ||
          !SHA256.test(suppliedHash) || createHash('sha256').update(req.body).digest('hex') !== suppliedHash) {
        return res.status(400).json({ error: 'The replacement upload chunk is invalid.' })
      }
      const chunkPath = replacementChunkPath(directory, assetName, index)
      const existingStat = await fs.lstat(chunkPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (existingStat && (!existingStat.isFile() || existingStat.isSymbolicLink())) {
        return res.status(409).json({ error: 'A different upload chunk already exists.' })
      }
      const existing = existingStat ? await fs.readFile(chunkPath) : null
      if (existing) {
        const duplicate = existing.length === req.body.length &&
          createHash('sha256').update(existing).digest('hex') === suppliedHash
        if (!duplicate) return res.status(409).json({ error: 'A different upload chunk already exists.' })
        return res.json({ received: true, duplicate: true })
      }
      const incomingPath = path.join(directory, `.${assetName}-${index}-${randomUUID()}.incoming`)
      const handle = await fs.open(incomingPath, 'wx', 0o600)
      try {
        await handle.writeFile(req.body)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await fs.link(incomingPath, chunkPath)
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const concurrent = await fs.readFile(chunkPath)
        if (concurrent.length !== req.body.length ||
            createHash('sha256').update(concurrent).digest('hex') !== suppliedHash) {
          return res.status(409).json({ error: 'A different upload chunk already exists.' })
        }
        return res.json({ received: true, duplicate: true })
      } finally {
        await fs.rm(incomingPath, { force: true }).catch(() => {})
      }
      res.json({ received: true, duplicate: false })
    })
  app.post('/api/admin/presentation-replacement-sessions/:sessionId/finalize',
    requireOrigin, requireAdmin, requireCsrf, async (req, res) => {
      const { directory, manifest } = await readReplacementSession(req, req.params.sessionId)
      const resultPath = path.join(directory, 'result.json')
      const priorResult = await fs.readFile(resultPath, 'utf8').then(JSON.parse).catch(() => null)
      if (priorResult?.presentation) return res.json(priorResult)
      const lockPath = path.join(directory, 'finalize.lock')
      const lockId = randomUUID()
      let lock
      try {
        lock = await fs.open(lockPath, 'wx', 0o600)
      } catch (error) {
        if (error.code === 'EEXIST') {
          return res.status(409).json({ error: 'This replacement is already being finalized. Try again shortly.' })
        }
        if (!lock) throw error
      }
      await lock.writeFile(`${lockId}\n`, 'utf8')
      await lock.sync()
      let pptPath
      let previewZipPath
      try {
        const recovered = await recoverPublishedReplacement(manifest)
        if (recovered) {
          const result = await writeReplacementResult(directory, recovered)
          return res.json(result)
        }
        const previous = await storage.getPresentation(manifest.presentationId)
        if (!previous) return notFound(res)
        pptPath = await assembleReplacementAsset(directory, 'presentation', manifest.assets.presentation)
        previewZipPath = await assembleReplacementAsset(directory, 'previews', manifest.assets.previews)
        const presentation = await installReplacement(previous, {
          pptPath,
          previewZipPath,
          pptSize: manifest.assets.presentation.size,
          originalName: manifest.assets.presentation.name,
          title: manifest.title,
          candidateId: manifest.candidateId,
        })
        const result = await writeReplacementResult(directory, presentation)
        res.json(result)
      } finally {
        await lock.close().catch(() => {})
        const currentLockId = await fs.readFile(lockPath, 'utf8').then((value) => value.trim()).catch(() => '')
        if (safeEqual(currentLockId, lockId)) await fs.rm(lockPath, { force: true }).catch(() => {})
        if (pptPath) await fs.rm(pptPath, { force: true }).catch(() => {})
        if (previewZipPath) await fs.rm(previewZipPath, { force: true }).catch(() => {})
      }
    })
  app.post('/api/admin/presentations/:id/previews', requireOrigin, requireAdmin, requireCsrf,
    (req, res, next) => UUID.test(req.params.id) ? next() : notFound(res),
    previewOnlyUpload.single('previews'), async (req, res) => {
      const previewUpload = req.file
      if (!previewUpload) return res.status(400).json({ error: 'Wait for every slide preview to finish.' })
      let stagingPreviewPath
      let backupPreviewPath
      let finalPreviewPath
      let installed = false
      try {
        if (Object.keys(req.body).length > 0) {
          return res.status(400).json({ error: 'Upload only the generated preview ZIP.' })
        }
        const presentation = await storage.getPresentation(req.params.id)
        if (!presentation || !(await originalFileAvailable(presentation))) return notFound(res)
        stagingPreviewPath = path.join(tempDir, `${presentation.id}-${randomUUID()}-previews`)
        const preview = await validateAndExtractPreviewZip(previewUpload.path, {
          expectedSlideCount: Number(presentation.slideCount),
          outputDir: stagingPreviewPath,
        })
        await writePreviewCacheKey(stagingPreviewPath)
        finalPreviewPath = previewDirectory(presentation.id)
        const existingStat = await fs.lstat(finalPreviewPath).catch((error) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (existingStat) {
          if (!existingStat.isDirectory() || existingStat.isSymbolicLink()) {
            throw new Error('The existing slide preview storage is unsafe.')
          }
          backupPreviewPath = path.join(tempDir, `${presentation.id}-${randomUUID()}-preview-backup`)
          await fs.rename(finalPreviewPath, backupPreviewPath)
        }
        await fs.rename(stagingPreviewPath, finalPreviewPath)
        stagingPreviewPath = null
        installed = true
        const status = await presentationAssetStatus(presentation)
        if (!status.available || status.preview?.slideCount !== preview.slideCount) {
          throw new Error('The replacement slide previews were not saved completely.')
        }
        if (backupPreviewPath) {
          await fs.rm(backupPreviewPath, { recursive: true, force: true })
          backupPreviewPath = null
        }
        res.json({ presentation: publicPresentation(presentation, status) })
      } catch (error) {
        try {
          if (installed && finalPreviewPath) {
            await fs.rm(finalPreviewPath, { recursive: true, force: true })
            installed = false
          }
          if (backupPreviewPath && finalPreviewPath) {
            await fs.rename(backupPreviewPath, finalPreviewPath)
            backupPreviewPath = null
          }
        } catch (rollbackError) {
          console.error('Slide preview rollback failed.', rollbackError)
          throw new Error('The previous slide previews could not be restored safely.', { cause: rollbackError })
        }
        throw error
      } finally {
        await fs.unlink(previewUpload.path).catch((error) => {
          if (error.code !== 'ENOENT') console.error('Temporary preview upload cleanup failed.')
        })
        if (stagingPreviewPath) await fs.rm(stagingPreviewPath, { recursive: true, force: true }).catch(() => {})
      }
    })
  app.delete('/api/admin/presentations/:id', requireOrigin, requireAdmin, requireCsrf, async (req, res) => {
    if (!UUID.test(req.params.id)) return notFound(res)
    const presentation = await storage.getPresentation(req.params.id)
    if (!presentation) return notFound(res)
    const filePath = path.join(filesDir, presentation.storedName)
    // Delete durable assets first; a permission failure must not hide an orphan.
    await fs.unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error })
    await removePreviewDirectory(presentation.id)
    await storage.deletePresentation(presentation.id)
    res.json({ ok: true })
  })

  function publicViewerResource(_req, res, next) {
    // Public resources are readable by the isolated, opaque-origin slide frame.
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    next()
  }
  app.get('/api/admin/presentations/:id/download', requireAdmin, async (req, res, next) => {
    if (!UUID.test(req.params.id)) return notFound(res)
    const presentation = await storage.getPresentation(req.params.id)
    if (!presentation) return notFound(res)
    if (!(await originalFileAvailable(presentation))) return notFound(res)
    const filePath = path.join(filesDir, presentation.storedName)
    res.type('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.attachment(presentation.originalName)
    res.sendFile(filePath, { cacheControl: false, lastModified: false }, (error) => { if (error) next(error) })
  })
  app.get('/api/presentations/:id', publicViewerResource, async (req, res) => {
    if (!UUID.test(req.params.id)) return notFound(res)
    const presentation = await storage.getPresentation(req.params.id)
    if (!presentation) return notFound(res)
    res.json({ presentation: publicPresentation(presentation, await presentationAssetStatus(presentation)) })
  })
  app.get('/api/presentations/:id/previews/:name', publicViewerResource, async (req, res, next) => {
    if (!UUID.test(req.params.id) || !/^slide-\d{4}\.jpg$/.test(req.params.name)) return notFound(res)
    const presentation = await storage.getPresentation(req.params.id)
    if (!presentation) return notFound(res)
    const status = await presentationAssetStatus(presentation)
    if (!status.previewAvailable) return notFound(res)
    const number = Number(req.params.name.slice(6, 10))
    if (number < 1 || number > status.preview.slideCount ||
        req.params.name !== `slide-${String(number).padStart(4, '0')}.jpg`) return notFound(res)
    const imagePath = path.join(previewDirectory(presentation.id), 'slides', req.params.name)
    const stat = await fs.lstat(imagePath).catch(() => null)
    if (!stat?.isFile() || stat.isSymbolicLink()) return notFound(res)
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.type('image/jpeg')
    res.sendFile(imagePath, { cacheControl: false, lastModified: false }, (error) => { if (error) next(error) })
  })
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }))
  app.use(['/database', '/synced-media', '/media', '/brand', '/data'], (_req, res) => res.status(410).end())
  app.use('/assets', publicViewerResource)
  app.get('/viewer.html', (_req, res) => res.status(404).end())
  app.get('/index.html', (_req, res) => res.redirect('/'))
  app.use(express.static(distDir, { index: false, dotfiles: 'deny', cacheControl: false, etag: false, lastModified: false }))
  app.get('/presentations/:id/view', async (req, res) => {
    if (!UUID.test(req.params.id)) return notFound(res)
    const presentation = await storage.getPresentation(req.params.id)
    if (!presentation || !(await presentationAssetStatus(presentation)).available) return notFound(res)
    res.set('Content-Security-Policy', `${res.get('Content-Security-Policy')}; sandbox allow-scripts`)
    const viewerHtml = await fs.readFile(path.join(distDir, 'viewer.html'), 'utf8')
    res.type('html').send(isolatedViewerShell(req.params.id, viewerHtml))
  })
  app.get(['/', '/admin', '/dashboard', '/dashboard/', '/district/:id'], async (req, res) => {
    if (req.params.id && !districtById.has(req.params.id)) return res.status(404).send('District not found.')
    if (req.path.startsWith('/admin')) res.set('X-Robots-Tag', 'noindex, nofollow')
    const html = await fs.readFile(path.join(distDir, 'index.html'), 'utf8')
    res.type('html').send(withDocumentPolicy(html))
  })
  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }))
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error)
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The PowerPoint or preview ZIP must be 200 MB or smaller.' : 'Upload one PowerPoint file, its previews, and an optional title.' })
    }
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' })
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Invalid request.' })
    if ([400, 404, 409, 410].includes(error.status)) return res.status(error.status).json({ error: error.message })
    console.error('Portal request failed:', error.code || error.name)
    res.status(503).json({ error: 'The request could not be completed. Please try again.' })
  })
  return app
}
