import fs from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'

const STATE_TABLE = 'bsdi_dashboard_state'
const CANONICAL_PPT = 'Completed_BSDI-14-03-2026.pptx'
const DATA_DIRECTORY_NAMES = new Set(['bsdi-data', 'server-data', 'bsdi'])
const enabled = (value) => /^(1|true|required)$/i.test(value || '')

function mysqlConfigFromEnv(env) {
  const urlValue = env.DATABASE_URL || env.MYSQL_URL || ''
  let urlConfig = {}
  if (urlValue) {
    try {
      const parsed = new URL(urlValue)
      if (!['mysql:', 'mysql2:'].includes(parsed.protocol)) throw new Error()
      urlConfig = {
        host: parsed.hostname,
        database: decodeURIComponent(parsed.pathname.replace(/^\/+/, '')),
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password || ''),
        port: Number(parsed.port || 3306),
      }
    } catch {
      throw new Error('BSDI database configuration is invalid.')
    }
  }
  const host = env.DB_HOST || env.MYSQL_HOST || urlConfig.host
  const database = env.DB_NAME || env.MYSQL_DATABASE || urlConfig.database
  const user = env.DB_USER || env.MYSQL_USER || urlConfig.user
  const password = env.DB_PASSWORD || env.MYSQL_PASSWORD || urlConfig.password || ''
  const port = Number(env.DB_PORT || env.MYSQL_PORT || urlConfig.port || 3306)
  const connectionLimit = Number(env.DB_CONNECTION_LIMIT || 10)
  const configured = Boolean(urlValue || host || database || user || password)
  if (!host || !database || !user) {
    if (configured || env.NODE_ENV === 'production' || enabled(env.BSDI_REQUIRE_MYSQL)) {
      throw new Error('BSDI cleanup requires complete MySQL configuration.')
    }
    return null
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isInteger(connectionLimit) || connectionLimit < 1) {
    throw new Error('BSDI database configuration is invalid.')
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

const samePath = (first, second) => path.relative(first, second) === ''
function isWithin(candidate, directory) {
  const relative = path.relative(directory, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative))
}

async function statOrNull(target) {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

// Resolve absent paths through the nearest existing parent so that a parent
// link cannot redirect recursive cleanup into an unrelated directory.
async function projectedRealPath(target) {
  if (await statOrNull(target)) return fs.realpath(target)
  const parent = path.dirname(target)
  if (samePath(parent, target)) throw new Error('BSDI cleanup path cannot be resolved safely.')
  return path.join(await projectedRealPath(parent), path.basename(target))
}

async function inspectDirectory(directory) {
  const info = await statOrNull(directory)
  if (!info) return 0
  if (info.isSymbolicLink() || !info.isDirectory() ||
      !samePath(directory, await fs.realpath(directory))) {
    throw new Error('BSDI cleanup refused an unsafe persistent directory.')
  }
  let count = 0
  for (const name of await fs.readdir(directory)) {
    const child = path.join(directory, name)
    const childInfo = await statOrNull(child)
    if (!childInfo) continue
    // Count an empty subdirectory as a remaining entry as well.
    count += childInfo.isDirectory() && !childInfo.isSymbolicLink()
      ? Math.max(1, await inspectDirectory(child))
      : 1
  }
  return count
}

async function removeDirectoryContents(directory) {
  if (!(await statOrNull(directory))) return
  // Check each directory immediately before traversing it. Symlinks and
  // Windows directory junctions are unlinked rather than followed.
  if (!samePath(directory, await fs.realpath(directory)) ||
      (await fs.lstat(directory)).isSymbolicLink()) {
    throw new Error('BSDI cleanup refused a redirected persistent directory.')
  }
  for (const name of await fs.readdir(directory)) {
    const child = path.join(directory, name)
    const info = await statOrNull(child)
    if (!info) continue
    if (info.isDirectory() && !info.isSymbolicLink()) {
      await removeDirectoryContents(child)
      await fs.rmdir(child)
    } else {
      await fs.unlink(child)
    }
  }
}

export function createCleanupStorage({
  rootDir,
  dataDir,
  env = process.env,
  createPool = (config) => mysql.createPool(config),
}) {
  if (!rootDir || !dataDir) throw new Error('BSDI cleanup requires explicit application and data directories.')
  const appRoot = path.resolve(rootDir)
  const persistentRoot = path.resolve(dataDir)
  const appParent = path.dirname(appRoot)
  // The only authorized sibling presentation was observed in this Hostinger
  // domain directory. A local checkout must never delete neighboring files.
  const parentCanonical = path.basename(appParent) === 'completedprojects.online'
    ? path.join(appParent, CANONICAL_PPT)
    : null
  const mysqlConfig = mysqlConfigFromEnv(env)
  const mode = mysqlConfig ? 'mysql' : 'none'
  const legacyPaths = [...new Set([
    path.join(appRoot, CANONICAL_PPT),
    parentCanonical,
    env.BSDI_CANONICAL_PPTX_PATH && path.resolve(env.BSDI_CANONICAL_PPTX_PATH),
    env.BSDI_TEMPLATE_PPTX_PATH && path.resolve(env.BSDI_TEMPLATE_PPTX_PATH),
  ].filter(Boolean))]
  let pool = null

  async function validatePaths() {
    const realAppRoot = await fs.realpath(appRoot)
    const dataInfo = await statOrNull(persistentRoot)
    if (!DATA_DIRECTORY_NAMES.has(path.basename(persistentRoot).toLowerCase()) ||
        samePath(persistentRoot, path.parse(persistentRoot).root) ||
        isWithin(appRoot, persistentRoot) ||
        (dataInfo && (!dataInfo.isDirectory() || dataInfo.isSymbolicLink()))) {
      throw new Error('BSDI cleanup refused an unsafe data directory; use a dedicated bsdi-data, server-data, or bsdi directory.')
    }
    const realDataRoot = await projectedRealPath(persistentRoot)
    if (!samePath(realDataRoot, persistentRoot) || isWithin(realAppRoot, realDataRoot)) {
      throw new Error('BSDI cleanup refused a redirected or overlapping data directory.')
    }
    for (const target of legacyPaths) {
      const info = await statOrNull(target)
      if (!info) continue
      const permitted = isWithin(target, appRoot) || isWithin(target, persistentRoot) ||
        (parentCanonical && samePath(target, parentCanonical))
      const realParent = await fs.realpath(path.dirname(target))
      if (!permitted || !samePath(realParent, path.dirname(target)) ||
          (!info.isSymbolicLink() && !info.isFile())) {
        throw new Error('BSDI cleanup refused an unsafe configured presentation path.')
      }
    }
  }

  async function databaseQuery(sql, values) {
    try {
      if (!pool) pool = createPool(mysqlConfig)
      return await pool.query(sql, values)
    } catch {
      // Driver errors can contain private connection information.
      throw new Error('BSDI database cleanup or verification failed.')
    }
  }

  async function verifyClean() {
    await validatePaths()
    const persistentFileCount = await inspectDirectory(persistentRoot)
    let remainingLegacyFiles = 0
    for (const target of legacyPaths) {
      if (await statOrNull(target)) remainingLegacyFiles += 1
    }
    let mysqlTablePresent = null
    if (mysqlConfig) {
      const [rows] = await databaseQuery(
        'SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = DATABASE() AND BINARY table_name = ?',
        [STATE_TABLE],
      )
      const tableCount = Number(rows?.[0]?.table_count)
      if (!Number.isInteger(tableCount) || tableCount < 0) {
        throw new Error('BSDI database verification returned an invalid result.')
      }
      mysqlTablePresent = tableCount > 0
    }
    return {
      storage: mode,
      mysqlTablePresent,
      persistentFileCount,
      remainingLegacyFiles,
      clean: mysqlTablePresent !== true && persistentFileCount === 0 && remainingLegacyFiles === 0,
    }
  }

  async function clearLegacyData() {
    // Validate all filesystem targets before making any destructive change.
    await validatePaths()
    await inspectDirectory(persistentRoot)
    if (mysqlConfig) await databaseQuery('DROP TABLE IF EXISTS `bsdi_dashboard_state`')
    await removeDirectoryContents(persistentRoot)
    for (const target of legacyPaths) {
      if (await statOrNull(target)) {
        await validatePaths()
        await fs.unlink(target)
      }
    }
    const result = await verifyClean()
    if (!result.clean) throw new Error('BSDI cleanup did not finish; legacy data remains.')
    return result
  }

  async function close() {
    if (pool) {
      const activePool = pool
      pool = null
      try {
        await activePool.end()
      } catch {
        throw new Error('BSDI database connection could not be closed.')
      }
    }
  }

  return { mode, clearLegacyData, verifyClean, close }
}
