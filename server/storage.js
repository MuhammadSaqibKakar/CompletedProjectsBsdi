import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'

const STATE_ID = 'main'

function mysqlUrlConfigFromEnv() {
  const value = process.env.DATABASE_URL || process.env.MYSQL_URL || ''
  if (!value) return null

  try {
    const parsed = new URL(value)
    if (!['mysql:', 'mysql2:'].includes(parsed.protocol)) return null
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    if (!parsed.hostname || !parsed.username || !database) return null

    return {
      host: parsed.hostname,
      database,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password || ''),
      port: Number(parsed.port || 3306),
    }
  } catch {
    return null
  }
}

function mysqlConfigFromEnv() {
  const urlConfig = mysqlUrlConfigFromEnv()
  const host = process.env.DB_HOST || process.env.MYSQL_HOST || urlConfig?.host
  const database = process.env.DB_NAME || process.env.MYSQL_DATABASE || urlConfig?.database
  const user = process.env.DB_USER || process.env.MYSQL_USER || urlConfig?.user
  const password = process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || urlConfig?.password || ''
  const port = Number(process.env.DB_PORT || process.env.MYSQL_PORT || urlConfig?.port || 3306)

  if (!host || !database || !user) return null
  const config = {
    host,
    database,
    user,
    password,
    port,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
  }

  if (/^(1|true|required)$/i.test(process.env.DB_SSL || process.env.MYSQL_SSL || '')) {
    config.ssl = {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    }
  }

  return config
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2))
  await fs.rename(tempPath, filePath)
}

function withRevision(data, revision, storage) {
  return {
    ...data,
    _serverRevision: Number(revision) || 1,
    _storage: storage,
  }
}

function stripServerMeta(data) {
  const clean = { ...(data || {}) }
  delete clean._serverRevision
  delete clean._storage
  return clean
}

function createConflictError(message = 'Database changed. Sync latest data before saving again.') {
  const error = new Error(message)
  error.status = 409
  error.code = 'REVISION_CONFLICT'
  return error
}

export function createDashboardStorage({ bundledDbPath, liveDbPath }) {
  const mysqlConfig = mysqlConfigFromEnv()
  let pool = null
  let schemaReady = false

  async function getPool() {
    if (!mysqlConfig) return null
    if (!pool) pool = mysql.createPool(mysqlConfig)
    if (!schemaReady) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bsdi_dashboard_state (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          revision BIGINT NOT NULL DEFAULT 1,
          data LONGTEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
      schemaReady = true
    }
    return pool
  }

  async function seedState() {
    if (fsSync.existsSync(liveDbPath)) return readJson(liveDbPath)
    const bundled = await readJson(bundledDbPath)
    await writeJsonAtomic(liveDbPath, bundled)
    return bundled
  }

  async function readFileState() {
    const data = await seedState()
    return withRevision(data, data._serverRevision || 1, 'json')
  }

  async function readMysqlState() {
    const db = await getPool()
    if (!db) return readFileState()

    const [rows] = await db.query('SELECT revision, data FROM bsdi_dashboard_state WHERE id = ? LIMIT 1', [STATE_ID])
    if (rows.length) {
      return withRevision(JSON.parse(rows[0].data), rows[0].revision, 'mysql')
    }

    const seed = stripServerMeta(await seedState())
    await db.query(
      'INSERT INTO bsdi_dashboard_state (id, revision, data) VALUES (?, ?, ?)',
      [STATE_ID, 1, JSON.stringify(seed)],
    )
    return withRevision(seed, 1, 'mysql')
  }

  async function readState() {
    return mysqlConfig ? readMysqlState() : readFileState()
  }

  async function writeFileState(next, expectedRevision) {
    const current = await readFileState()
    const currentRevision = Number(current._serverRevision) || 1
    if (expectedRevision && Number(expectedRevision) !== currentRevision) {
      throw createConflictError()
    }
    const revision = currentRevision + 1
    const clean = stripServerMeta(next)
    const stored = withRevision(clean, revision, 'json')
    await writeJsonAtomic(liveDbPath, stored)
    return stored
  }

  async function writeMysqlState(next, expectedRevision) {
    const db = await getPool()
    if (!db) return writeFileState(next, expectedRevision)

    const connection = await db.getConnection()
    try {
      await connection.beginTransaction()
      const [rows] = await connection.query(
        'SELECT revision, data FROM bsdi_dashboard_state WHERE id = ? FOR UPDATE',
        [STATE_ID],
      )

      if (!rows.length) {
        const seed = stripServerMeta(next)
        await connection.query(
          'INSERT INTO bsdi_dashboard_state (id, revision, data) VALUES (?, ?, ?)',
          [STATE_ID, 1, JSON.stringify(seed)],
        )
        await connection.commit()
        return withRevision(seed, 1, 'mysql')
      }

      const currentRevision = Number(rows[0].revision) || 1
      if (expectedRevision && Number(expectedRevision) !== currentRevision) {
        throw createConflictError()
      }

      const nextRevision = currentRevision + 1
      const clean = stripServerMeta(next)
      await connection.query(
        'UPDATE bsdi_dashboard_state SET revision = ?, data = ? WHERE id = ?',
        [nextRevision, JSON.stringify(clean), STATE_ID],
      )
      await connection.commit()
      return withRevision(clean, nextRevision, 'mysql')
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async function writeState(next, expectedRevision) {
    return mysqlConfig ? writeMysqlState(next, expectedRevision) : writeFileState(next, expectedRevision)
  }

  return {
    mode: mysqlConfig ? 'mysql' : 'json',
    readState,
    writeState,
    stripServerMeta,
  }
}
