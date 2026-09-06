/* eslint no-control-regex: "off" */
// Reject control characters in persisted metadata.
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'

const enabled = (value) => /^(1|true|required)$/i.test(value || '')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const PRESENTATION_COLUMNS = 'id, district_id AS districtId, title, original_name AS originalName, stored_name AS storedName, size, slide_count AS slideCount, uploaded_at AS uploadedAt'

function mysqlConfigFromEnv(env) {
  const urlValue = env.DATABASE_URL || env.MYSQL_URL || ''
  let fromUrl = {}
  if (urlValue) {
    try {
      const parsed = new URL(urlValue)
      if (!['mysql:', 'mysql2:'].includes(parsed.protocol)) throw new Error()
      fromUrl = {
        host: parsed.hostname,
        database: decodeURIComponent(parsed.pathname.replace(/^\/+/, '')),
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password || ''),
        port: Number(parsed.port || 3306),
      }
    } catch {
      throw new Error('Portal database configuration is invalid.')
    }
  }
  const host = env.DB_HOST || env.MYSQL_HOST || fromUrl.host
  const database = env.DB_NAME || env.MYSQL_DATABASE || fromUrl.database
  const user = env.DB_USER || env.MYSQL_USER || fromUrl.user
  const password = env.DB_PASSWORD || env.MYSQL_PASSWORD || fromUrl.password || ''
  const port = Number(env.DB_PORT || env.MYSQL_PORT || fromUrl.port || 3306)
  const connectionLimit = Number(env.DB_CONNECTION_LIMIT || 10)
  const configured = Boolean(urlValue || host || database || user || password)
  if (!host || !database || !user) {
    if (configured || env.NODE_ENV === 'production' || enabled(env.BSDI_REQUIRE_MYSQL)) {
      throw new Error('Portal storage requires complete MySQL configuration.')
    }
    return null
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isInteger(connectionLimit) || connectionLimit < 1 || connectionLimit > 100) {
    throw new Error('Portal database configuration is invalid.')
  }
  const config = {
    host, database, user, password, port, connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
  }
  if (enabled(env.DB_SSL || env.MYSQL_SSL)) {
    config.ssl = { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
  }
  return config
}

function presentationRecord(value) {
  if (!value || !UUID.test(value.id || '') ||
      typeof value.districtId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.districtId) || value.districtId.length > 64 ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 || /[\u0000-\u001f\u007f]/.test(value.title) ||
      typeof value.originalName !== 'string' || !value.originalName.trim() || value.originalName.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(value.originalName) ||
      typeof value.storedName !== 'string' || !value.storedName.endsWith('.pptx') || !UUID.test(value.storedName.slice(0, -5)) ||
      !Number.isSafeInteger(Number(value.size)) || Number(value.size) < 1 ||
      !Number.isSafeInteger(Number(value.slideCount)) || Number(value.slideCount) < 1 ||
      typeof value.uploadedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.uploadedAt) || !Number.isFinite(Date.parse(value.uploadedAt))) {
    throw new Error('Presentation metadata is invalid.')
  }
  return {
    id: value.id,
    districtId: value.districtId,
    title: value.title,
    originalName: value.originalName,
    storedName: value.storedName,
    size: Number(value.size),
    slideCount: Number(value.slideCount),
    uploadedAt: new Date(value.uploadedAt).toISOString(),
  }
}

function sessionRecord(value) {
  if (!value || typeof value.tokenHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.tokenHash) ||
      typeof value.csrfToken !== 'string' || !/^[a-z0-9_-]{32,128}$/i.test(value.csrfToken) ||
      !Number.isSafeInteger(Number(value.expiresAt)) || Number(value.expiresAt) < 1) {
    throw new Error('Admin session metadata is invalid.')
  }
  return { tokenHash: value.tokenHash, csrfToken: value.csrfToken, expiresAt: Number(value.expiresAt) }
}

function loginLimitRecord(value) {
  if (!value || typeof value.keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.keyHash) ||
      !Number.isSafeInteger(Number(value.windowStart)) || Number(value.windowStart) < 0 ||
      !Number.isSafeInteger(Number(value.attempts)) || Number(value.attempts) < 1) {
    throw new Error('Login limit metadata is invalid.')
  }
  return { keyHash: value.keyHash, windowStart: Number(value.windowStart), attempts: Number(value.attempts) }
}

async function statOrNull(target) {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function projectedRealPath(target) {
  if (await statOrNull(target)) return fs.realpath(target)
  const parent = path.dirname(target)
  if (parent === target) throw new Error('Portal data directory cannot be resolved safely.')
  return path.join(await projectedRealPath(parent), path.basename(target))
}

export function createPortalStorage({ dataDir, env = process.env, createPool = (config) => mysql.createPool(config) }) {
  if (typeof dataDir !== 'string' || !dataDir.trim()) throw new Error('Portal storage requires an explicit data directory.')
  const dataRoot = path.resolve(dataDir)
  const portalRoot = path.join(dataRoot, 'portal')
  const metadataPath = path.join(portalRoot, 'metadata.json')
  const mysqlConfig = mysqlConfigFromEnv(env)
  const mode = mysqlConfig ? 'mysql' : 'json'
  let pool = null
  let initialized = false
  let initialization = null
  let mutationQueue = Promise.resolve()
  let state = { version: 1, presentations: [], sessions: [], loginLimits: [] }

  function requireInitialized() {
    if (!initialized) throw new Error('Portal storage must be initialized before use.')
  }

  async function databaseQuery(sql, values = [], executor = pool) {
    try {
      return await executor.execute(sql, values)
    } catch {
      // MySQL driver messages may include private connection details or data.
      throw new Error('Portal database operation failed.')
    }
  }

  async function validateLocalDirectory() {
    for (const directory of [dataRoot, portalRoot]) {
      const info = await statOrNull(directory)
      if ((info && (!info.isDirectory() || info.isSymbolicLink())) ||
          path.relative(directory, await projectedRealPath(directory)) !== '') {
        throw new Error('Portal storage refused a redirected data directory.')
      }
    }
  }

  async function validateMetadataFile() {
    await validateLocalDirectory()
    const info = await statOrNull(metadataPath)
    if (info && (!info.isFile() || info.isSymbolicLink())) {
      throw new Error('Portal storage refused an unsafe metadata file.')
    }
    return info
  }

  async function writeLocalState(next) {
    await validateMetadataFile()
    const temporaryPath = path.join(portalRoot, `.metadata-${randomUUID()}.tmp`)
    let handle
    try {
      handle = await fs.open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(next)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await validateMetadataFile()
      await fs.rename(temporaryPath, metadataPath)
    } catch (error) {
      if (handle) await handle.close().catch(() => {})
      // Only our unique temporary file is eligible for removal.
      await fs.unlink(temporaryPath).catch(() => {})
      throw error
    }
  }

  function mutateLocal(operation) {
    requireInitialized()
    const pending = mutationQueue.then(async () => {
      const next = structuredClone(state)
      const result = operation(next)
      await writeLocalState(next)
      state = next
      return structuredClone(result)
    })
    mutationQueue = pending.catch(() => {})
    return pending
  }

  async function initialize() {
    if (initialized) return
    if (initialization) return initialization
    initialization = (async () => {
      if (mysqlConfig) {
        try {
          pool = createPool(mysqlConfig)
        } catch {
          throw new Error('Portal database operation failed.')
        }
        await databaseQuery(`CREATE TABLE IF NOT EXISTS completed_presentations (
          id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          district_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          title VARCHAR(160) NOT NULL,
          original_name VARCHAR(255) NOT NULL,
          stored_name VARCHAR(41) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
          size BIGINT UNSIGNED NOT NULL,
          slide_count INT UNSIGNED NOT NULL,
          uploaded_at VARCHAR(24) CHARACTER SET ascii NOT NULL,
          INDEX district_uploaded (district_id, uploaded_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
        await databaseQuery(`CREATE TABLE IF NOT EXISTS completed_admin_sessions (
          token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          csrf_token VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          expires_at BIGINT UNSIGNED NOT NULL,
          INDEX session_expiry (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
        await databaseQuery(`CREATE TABLE IF NOT EXISTS completed_login_limits (
          key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
          window_start BIGINT UNSIGNED NOT NULL,
          attempts INT UNSIGNED NOT NULL,
          INDEX login_window (window_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
        await databaseQuery('DELETE FROM completed_admin_sessions WHERE expires_at <= ?', [Date.now()])
        await databaseQuery('DELETE FROM completed_login_limits WHERE window_start <= ?', [Date.now() - 86_400_000])
      } else {
        await validateLocalDirectory()
        await fs.mkdir(portalRoot, { recursive: true, mode: 0o700 })
        const info = await validateMetadataFile()
        if (info) {
          try {
            const parsed = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
            if (parsed.version !== 1 || !Array.isArray(parsed.presentations) || !Array.isArray(parsed.sessions) ||
                (parsed.loginLimits !== undefined && !Array.isArray(parsed.loginLimits))) throw new Error()
            const presentations = parsed.presentations.map(presentationRecord)
            const sessions = parsed.sessions.map(sessionRecord)
            const loginLimits = (parsed.loginLimits || []).map(loginLimitRecord)
            if (new Set(presentations.map((entry) => entry.id)).size !== presentations.length ||
                new Set(presentations.map((entry) => entry.storedName)).size !== presentations.length ||
                new Set(sessions.map((entry) => entry.tokenHash)).size !== sessions.length ||
                new Set(loginLimits.map((entry) => entry.keyHash)).size !== loginLimits.length) throw new Error()
            state = { version: 1, presentations, sessions, loginLimits }
          } catch {
            throw new Error('Portal metadata file is invalid; existing data was preserved.')
          }
        }
        const activeSessions = state.sessions.filter((entry) => entry.expiresAt > Date.now())
        const recentLoginLimits = state.loginLimits.filter((entry) => entry.windowStart > Date.now() - 86_400_000)
        if (!info || activeSessions.length !== state.sessions.length || recentLoginLimits.length !== state.loginLimits.length) {
          const next = { ...state, sessions: activeSessions, loginLimits: recentLoginLimits }
          await writeLocalState(next)
          state = next
        }
      }
      initialized = true
    })()
    try {
      await initialization
    } catch (error) {
      if (pool) {
        const failedPool = pool
        pool = null
        await failedPool.end().catch(() => {})
      }
      throw error
    } finally {
      initialization = null
    }
  }

  async function listPresentations(districtId) {
    requireInitialized()
    if (mode === 'mysql') {
      const [rows] = await databaseQuery(`SELECT ${PRESENTATION_COLUMNS} FROM completed_presentations${districtId === undefined ? '' : ' WHERE district_id = ?'} ORDER BY uploaded_at DESC, id ASC`, districtId === undefined ? [] : [districtId])
      return rows.map(presentationRecord)
    }
    await mutationQueue
    return structuredClone(state.presentations.filter((entry) => districtId === undefined || entry.districtId === districtId)
      .sort((first, second) => second.uploadedAt.localeCompare(first.uploadedAt) || first.id.localeCompare(second.id)))
  }

  async function getPresentation(id) {
    requireInitialized()
    if (mode === 'mysql') {
      const [rows] = await databaseQuery(`SELECT ${PRESENTATION_COLUMNS} FROM completed_presentations WHERE id = ? LIMIT 1`, [id])
      return rows.length ? presentationRecord(rows[0]) : null
    }
    await mutationQueue
    return structuredClone(state.presentations.find((entry) => entry.id === id) || null)
  }

  async function addPresentation(metadata) {
    requireInitialized()
    const record = presentationRecord(metadata)
    if (mode === 'mysql') {
      await databaseQuery('INSERT INTO completed_presentations (id, district_id, title, original_name, stored_name, size, slide_count, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [record.id, record.districtId, record.title, record.originalName, record.storedName, record.size, record.slideCount, record.uploadedAt])
      return record
    }
    return mutateLocal((next) => {
      if (next.presentations.some((entry) => entry.id === record.id || entry.storedName === record.storedName)) {
        throw new Error('Presentation already exists.')
      }
      next.presentations.push(record)
      return record
    })
  }

  async function deletePresentation(id) {
    requireInitialized()
    if (mode === 'mysql') {
      let connection
      try {
        connection = await pool.getConnection()
        await connection.beginTransaction()
        const [rows] = await databaseQuery(`SELECT ${PRESENTATION_COLUMNS} FROM completed_presentations WHERE id = ? FOR UPDATE`, [id], connection)
        const removed = rows.length ? presentationRecord(rows[0]) : null
        if (removed) await databaseQuery('DELETE FROM completed_presentations WHERE id = ?', [id], connection)
        await connection.commit()
        return removed
      } catch {
        if (connection) await connection.rollback().catch(() => {})
        throw new Error('Portal database operation failed.')
      } finally {
        if (connection) connection.release()
      }
    }
    return mutateLocal((next) => {
      const removed = next.presentations.find((entry) => entry.id === id) || null
      next.presentations = next.presentations.filter((entry) => entry.id !== id)
      return removed
    })
  }

  async function createSession(metadata) {
    requireInitialized()
    const record = sessionRecord(metadata)
    if (mode === 'mysql') {
      await databaseQuery('INSERT INTO completed_admin_sessions (token_hash, csrf_token, expires_at) VALUES (?, ?, ?)', [record.tokenHash, record.csrfToken, record.expiresAt])
      return record
    }
    return mutateLocal((next) => {
      if (next.sessions.some((entry) => entry.tokenHash === record.tokenHash)) throw new Error('Admin session already exists.')
      next.sessions = next.sessions.filter((entry) => entry.expiresAt > Date.now())
      next.sessions.push(record)
      return record
    })
  }

  async function getSession(tokenHash) {
    requireInitialized()
    const now = Date.now()
    if (mode === 'mysql') {
      const [rows] = await databaseQuery('SELECT token_hash AS tokenHash, csrf_token AS csrfToken, expires_at AS expiresAt FROM completed_admin_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1', [tokenHash, now])
      return rows.length ? sessionRecord(rows[0]) : null
    }
    await mutationQueue
    const record = state.sessions.find((entry) => entry.tokenHash === tokenHash && entry.expiresAt > Date.now())
    return structuredClone(record || null)
  }

  async function deleteSession(tokenHash) {
    requireInitialized()
    if (mode === 'mysql') {
      const [result] = await databaseQuery('DELETE FROM completed_admin_sessions WHERE token_hash = ?', [tokenHash])
      return result.affectedRows > 0
    }
    return mutateLocal((next) => {
      const before = next.sessions.length
      next.sessions = next.sessions.filter((entry) => entry.tokenHash !== tokenHash)
      return next.sessions.length !== before
    })
  }

  async function consumeLoginAttempt(keyHash, { now = Date.now(), limit = 10, windowMs = 900_000 } = {}) {
    requireInitialized()
    if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(keyHash) ||
        !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000 ||
        !Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 86_400_000) {
      throw new Error('Login limit configuration is invalid.')
    }
    const resultFor = (record) => ({
      allowed: record.attempts <= limit,
      retryAfter: record.attempts <= limit ? 0 : Math.max(1, Math.ceil((record.windowStart + windowMs - now) / 1000)),
    })
    if (mode === 'mysql') {
      // Evaluate the reset before updating window_start. The increment is atomic
      // across application workers; a concurrent read may conservatively deny.
      await databaseQuery(`INSERT INTO completed_login_limits (key_hash, window_start, attempts) VALUES (?, ?, 1)
        ON DUPLICATE KEY UPDATE attempts = IF(window_start <= ?, 1, LEAST(attempts + 1, 4294967295)),
          window_start = IF(window_start <= ?, ?, window_start)`, [keyHash, now, now - windowMs, now - windowMs, now])
      const [rows] = await databaseQuery('SELECT key_hash AS keyHash, window_start AS windowStart, attempts FROM completed_login_limits WHERE key_hash = ? LIMIT 1', [keyHash])
      if (!rows.length) throw new Error('Portal login limit could not be verified.')
      return resultFor(loginLimitRecord(rows[0]))
    }
    return mutateLocal((next) => {
      let record = next.loginLimits.find((entry) => entry.keyHash === keyHash)
      if (!record) {
        record = { keyHash, windowStart: now, attempts: 0 }
        next.loginLimits.push(record)
      }
      if (record.windowStart <= now - windowMs) {
        record.windowStart = now
        record.attempts = 0
      }
      record.attempts = Math.min(record.attempts + 1, 4_294_967_295)
      return resultFor(record)
    })
  }

  async function close() {
    if (initialization) await initialization.catch(() => {})
    await mutationQueue
    initialized = false
    if (pool) {
      const activePool = pool
      pool = null
      try {
        await activePool.end()
      } catch {
        throw new Error('Portal database connection could not be closed.')
      }
    }
  }

  return { mode, initialize, listPresentations, getPresentation, addPresentation, deletePresentation, createSession, getSession, deleteSession, consumeLoginAttempt, close }
}
