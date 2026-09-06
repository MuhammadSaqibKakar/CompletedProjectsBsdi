/* eslint no-control-regex: "off" */
// Control characters are explicitly rejected in untrusted names and titles.
import express from 'express'
import compression from 'compression'
import helmet from 'helmet'
import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { districts, districtById } from './districts.js'
import { hashToken, readCookie, randomToken, safeEqual, sessionLifetime, verifyPassword, validatePasswordHash } from './auth.js'
import { defaultPasswordHash } from './admin-credential.js'
import { validatePptx, MAX_UPLOAD_BYTES } from './validate-pptx.js'
import { isolatedViewerShell, withDocumentPolicy } from './viewer-shell.js'

export const release = 'district-portal-2026-09-06.2'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const notFound = (res) => res.status(404).json({ error: 'Presentation not found.' })
const publicPresentation = (item) => ({
  id: item.id, districtId: item.districtId, title: item.title, originalName: item.originalName,
  size: item.size, slideCount: item.slideCount, uploadedAt: item.uploadedAt,
  fileUrl: `/api/presentations/${item.id}/file`,
  downloadUrl: `/api/presentations/${item.id}/download`,
  viewUrl: `/presentations/${item.id}/view`,
})

export async function createApp({ rootDir, dataDir, storage, env = process.env }) {
  const production = env.NODE_ENV === 'production' || storage.mode === 'mysql' || /^(1|true|required)$/i.test(env.BSDI_REQUIRE_MYSQL || '')
  const distDir = path.join(rootDir, 'dist')
  const filesDir = path.join(dataDir, 'portal', 'files')
  const tempDir = path.join(dataDir, 'portal', 'tmp')
  for (const directory of [filesDir, tempDir]) {
    await fs.mkdir(directory, { recursive: true })
    if ((await fs.lstat(directory)).isSymbolicLink() || path.relative(directory, await fs.realpath(directory)) !== '') {
      throw new Error('Presentation storage must use a dedicated real directory.')
    }
  }
  const passwordHash = validatePasswordHash(env.ADMIN_PASSWORD_HASH || defaultPasswordHash)
  const cookieName = production ? '__Host-cp_session' : 'cp_session'
  const cookieOptions = { httpOnly: true, secure: production, sameSite: 'strict', path: '/' }
  const app = express()
  // Hostinger places the Node process behind its local reverse proxy.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal')
  app.disable('x-powered-by')
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"], frameSrc: ["'self'"], frameAncestors: ["'self'"],
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
    res.json({ ok: true, release, storage: storage.mode, districts: districts.length, presentations: presentations.length })
  })
  app.get('/api/districts', async (_req, res) => {
    const presentations = await storage.listPresentations()
    const counts = new Map()
    for (const item of presentations) counts.set(item.districtId, (counts.get(item.districtId) || 0) + 1)
    res.json({ districts: districts.map((district) => ({ ...district, presentationCount: counts.get(district.id) || 0 })),
      totalPresentations: presentations.length })
  })
  app.get('/api/districts/:id', async (req, res) => {
    const district = districtById.get(req.params.id)
    if (!district) return res.status(404).json({ error: 'District not found.' })
    const presentations = await storage.listPresentations(district.id)
    res.json({ district, presentations: presentations.map(publicPresentation) })
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
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 1, fieldSize: 640, parts: 3 },
    fileFilter: (_req, file, callback) => {
      if (!/\.pptx$/i.test(file.originalname)) return callback(Object.assign(new Error('Choose a PowerPoint .pptx file.'), { status: 400 }))
      callback(null, true)
    },
  })
  // Authentication and CSRF checks run before multipart data reaches disk.
  app.post('/api/admin/districts/:id/presentations', requireOrigin, requireAdmin, requireCsrf,
    (req, res, next) => districtById.has(req.params.id) ? next() : res.status(404).json({ error: 'District not found.' }),
    upload.single('file'), async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'Choose a PowerPoint .pptx file.' })
      let finalPath
      let saved = false
      try {
        if (Object.keys(req.body).some((key) => key !== 'title') ||
            (req.body.title !== undefined && typeof req.body.title !== 'string')) {
          return res.status(400).json({ error: 'Upload one presentation and an optional title.' })
        }
        const originalName = path.basename(req.file.originalname.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200)
        const title = String(req.body.title || originalName.replace(/\.pptx$/i, '')).trim()
        if (!title || title.length > 160 || /[\x00-\x1f\x7f]/.test(title)) {
          return res.status(400).json({ error: 'Use a title between 1 and 160 characters.' })
        }
        const { slideCount } = await validatePptx(req.file.path)
        const id = randomUUID()
        const storedName = `${id}.pptx`
        finalPath = path.join(filesDir, storedName)
        await fs.rename(req.file.path, finalPath)
        await fs.chmod(finalPath, 0o600)
        const metadata = { id, districtId: req.params.id, title, originalName, storedName,
          size: req.file.size, slideCount, uploadedAt: new Date().toISOString() }
        const presentation = await storage.addPresentation(metadata)
        saved = true
        res.status(201).json({ presentation: publicPresentation(presentation) })
      } finally {
        await fs.unlink(req.file.path).catch((error) => { if (error.code !== 'ENOENT') console.error('Temporary upload cleanup failed.') })
        if (finalPath && !saved) await fs.unlink(finalPath).catch(() => {})
      }
    })
  app.delete('/api/admin/presentations/:id', requireOrigin, requireAdmin, requireCsrf, async (req, res) => {
    if (!UUID.test(req.params.id)) return notFound(res)
    const presentation = await storage.getPresentation(req.params.id)
    if (!presentation) return notFound(res)
    const filePath = path.join(filesDir, presentation.storedName)
    // Delete the file first; a disk permission failure must not hide an orphan.
    await fs.unlink(filePath).catch((error) => { if (error.code !== 'ENOENT') throw error })
    await storage.deletePresentation(presentation.id)
    res.json({ ok: true })
  })

  function publicViewerResource(_req, res, next) {
    // Public resources are readable by the isolated, opaque-origin slide frame.
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    next()
  }
  app.use('/api/presentations', publicViewerResource)
  app.get('/api/presentations/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return notFound(res)
    const presentation = await storage.getPresentation(req.params.id)
    if (!presentation) return notFound(res)
    res.json({ presentation: publicPresentation(presentation) })
  })
  async function sendPresentation(req, res, next) {
    if (!UUID.test(req.params.id)) return notFound(res)
    const presentation = await storage.getPresentation(req.params.id)
    if (!presentation) return notFound(res)
    const filePath = path.join(filesDir, presentation.storedName)
    const stat = await fs.lstat(filePath).catch((error) => { if (error.code === 'ENOENT') return null; throw error })
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) return notFound(res)
    res.type('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    if (req.path.endsWith('/download')) res.attachment(presentation.originalName)
    res.sendFile(filePath, { cacheControl: false, lastModified: false }, (error) => { if (error) next(error) })
  }
  app.get('/api/presentations/:id/file', sendPresentation)
  app.get('/api/presentations/:id/download', sendPresentation)
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }))
  app.use(['/database', '/synced-media', '/media', '/brand', '/data'], (_req, res) => res.status(410).end())
  app.use('/assets', publicViewerResource)
  app.get('/viewer.html', (_req, res) => res.status(404).end())
  app.get('/index.html', (_req, res) => res.redirect('/'))
  app.use(express.static(distDir, { index: false, dotfiles: 'deny', cacheControl: false, etag: false, lastModified: false }))
  app.get('/presentations/:id/view', async (req, res) => {
    if (!UUID.test(req.params.id) || !(await storage.getPresentation(req.params.id))) return notFound(res)
    res.set('Content-Security-Policy', `${res.get('Content-Security-Policy')}; sandbox allow-scripts allow-downloads`)
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
      return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The presentation must be 200 MB or smaller.' : 'Upload one .pptx file and an optional title.' })
    }
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' })
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Invalid request.' })
    if (error.status === 400) return res.status(400).json({ error: error.message })
    console.error('Portal request failed:', error.code || error.name)
    res.status(503).json({ error: 'The request could not be completed. Please try again.' })
  })
  return app
}
