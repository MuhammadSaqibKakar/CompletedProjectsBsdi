import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPortalStorage } from './portal-storage.js'

async function fixture(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'completed-portal-test-')))
  const dataDir = path.join(temp, 'data')
  await fs.mkdir(dataDir)
  t.after(async () => {
    const resolved = await fs.realpath(temp)
    assert.equal(path.relative(temp, resolved), '')
    assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()))
    assert.match(path.basename(resolved), /^completed-portal-test-/)
    await fs.rm(resolved, { recursive: true, force: true })
  })
  return { temp, dataDir, env: {} }
}

function presentation(overrides = {}) {
  const id = randomUUID()
  return {
    id, districtId: 'barkhan', title: 'Completed projects', originalName: 'Completed projects.pptx',
    storedName: `${id}.pptx`, size: 2048, slideCount: 3,
    uploadedAt: new Date().toISOString(), ...overrides,
  }
}

const session = (overrides = {}) => ({ tokenHash: 'a'.repeat(64), csrfToken: 'b'.repeat(64), expiresAt: Date.now() + 60_000, ...overrides })

function fakeMysql() {
  const presentations = new Map()
  const sessions = new Map()
  const loginLimits = new Map()
  const calls = []
  const lifecycle = { began: 0, committed: 0, rolledBack: 0, released: 0, closed: 0 }
  let config
  async function execute(sql, values = []) {
    calls.push({ sql, values: [...values] })
    assert.equal((sql.match(/\?/g) || []).length, values.length)
    if (sql.startsWith('CREATE TABLE IF NOT EXISTS ')) return [{}]
    if (sql === 'DELETE FROM completed_admin_sessions WHERE expires_at <= ?') {
      for (const [key, record] of sessions) if (record.expiresAt <= values[0]) sessions.delete(key)
      return [{}]
    }
    if (sql === 'DELETE FROM completed_login_limits WHERE window_start <= ?') {
      for (const [key, record] of loginLimits) if (record.windowStart <= values[0]) loginLimits.delete(key)
      return [{}]
    }
    if (sql.startsWith('INSERT INTO completed_presentations ')) {
      const [id, districtId, title, originalName, storedName, size, slideCount, uploadedAt] = values
      if (presentations.has(id)) throw new Error('duplicate database private content')
      presentations.set(id, { id, districtId, title, originalName, storedName, size, slideCount, uploadedAt })
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('SELECT id, district_id AS districtId')) {
      let rows = [...presentations.values()]
      if (sql.includes(' WHERE id = ?')) rows = rows.filter((entry) => entry.id === values[0])
      if (sql.includes(' WHERE district_id = ?')) rows = rows.filter((entry) => entry.districtId === values[0])
      if (sql.includes('ORDER BY')) rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.id.localeCompare(b.id))
      return [structuredClone(rows)]
    }
    if (sql === 'DELETE FROM completed_presentations WHERE id = ?') return [{ affectedRows: presentations.delete(values[0]) ? 1 : 0 }]
    if (sql.startsWith('INSERT INTO completed_admin_sessions ')) {
      const [tokenHash, csrfToken, expiresAt] = values
      sessions.set(tokenHash, { tokenHash, csrfToken, expiresAt })
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('SELECT token_hash AS tokenHash')) {
      const record = sessions.get(values[0])
      return [record && record.expiresAt > values[1] ? [{ ...record, expiresAt: String(record.expiresAt) }] : []]
    }
    if (sql === 'DELETE FROM completed_admin_sessions WHERE token_hash = ?') return [{ affectedRows: sessions.delete(values[0]) ? 1 : 0 }]
    if (sql.startsWith('INSERT INTO completed_login_limits ')) {
      const [keyHash, now, cutoff] = values
      let record = loginLimits.get(keyHash)
      if (!record || record.windowStart <= cutoff) record = { keyHash, windowStart: now, attempts: 0 }
      record.attempts += 1
      loginLimits.set(keyHash, record)
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('SELECT key_hash AS keyHash')) {
      const record = loginLimits.get(values[0])
      return [record ? [{ ...record }] : []]
    }
    throw new Error(`Unexpected test query: ${sql}`)
  }
  const pool = {
    execute,
    async getConnection() {
      return {
        execute,
        async beginTransaction() { lifecycle.began += 1 },
        async commit() { lifecycle.committed += 1 },
        async rollback() { lifecycle.rolledBack += 1 },
        release() { lifecycle.released += 1 },
      }
    },
    async end() { lifecycle.closed += 1 },
  }
  return {
    env: { NODE_ENV: 'production', DB_HOST: 'test.invalid', DB_NAME: 'test_portal', DB_USER: 'test_user', DB_PASSWORD: 'test_password' },
    createPool(value) { config = value; return pool },
    get config() { return config }, calls, lifecycle, presentations, sessions, loginLimits, pool,
  }
}

test('JSON presentation CRUD persists and preserves unrelated files and actual presentation files', async (t) => {
  const context = await fixture(t)
  const sibling = path.join(context.temp, 'keep.txt')
  const unrelated = path.join(context.dataDir, 'other-data.json')
  await fs.writeFile(sibling, 'untouched sibling')
  await fs.writeFile(unrelated, '{"keep":true}')
  const storage = createPortalStorage(context)
  assert.equal(storage.mode, 'json')
  await assert.rejects(storage.listPresentations(), /initialized/)
  await Promise.all([storage.initialize(), storage.initialize()])
  assert.deepEqual(await storage.listPresentations(), [])
  const first = presentation({ uploadedAt: '2026-09-01T00:00:00.000Z' })
  const second = presentation({ districtId: 'ziarat', uploadedAt: '2026-09-02T00:00:00.000Z' })
  assert.deepEqual(await storage.addPresentation(first), first)
  await storage.addPresentation(second)
  const actualFile = path.join(context.dataDir, 'portal', first.storedName)
  await fs.writeFile(actualFile, 'presentation file is managed by caller')
  assert.deepEqual(await storage.listPresentations(), [second, first])
  assert.deepEqual(await storage.listPresentations('barkhan'), [first])
  assert.deepEqual(await storage.listPresentations('missing'), [])
  const returned = await storage.getPresentation(first.id)
  returned.title = 'caller mutation'
  assert.deepEqual(await storage.getPresentation(first.id), first)
  await storage.close()
  const reopened = createPortalStorage(context)
  await reopened.initialize()
  assert.deepEqual(await reopened.listPresentations(), [second, first])
  assert.deepEqual(await reopened.deletePresentation(first.id), first)
  assert.equal(await reopened.deletePresentation(first.id), null)
  assert.equal(await reopened.getPresentation(first.id), null)
  assert.deepEqual(await reopened.listPresentations(), [second])
  assert.equal(await fs.readFile(actualFile, 'utf8'), 'presentation file is managed by caller')
  assert.equal(await fs.readFile(unrelated, 'utf8'), '{"keep":true}')
  assert.equal(await fs.readFile(sibling, 'utf8'), 'untouched sibling')
  await reopened.close()
})

test('JSON serializes concurrent mutations and recovers after a rejected mutation', async (t) => {
  const context = await fixture(t)
  const storage = createPortalStorage(context)
  await storage.initialize()
  const records = Array.from({ length: 24 }, () => presentation())
  await Promise.all(records.map((record) => storage.addPresentation(record)))
  await assert.rejects(storage.addPresentation(records[0]), /already exists/)
  const extra = presentation()
  await storage.addPresentation(extra)
  const result = await storage.listPresentations()
  assert.equal(result.length, 25)
  assert.deepEqual(new Set(result.map((record) => record.id)), new Set([...records, extra].map((record) => record.id)))
  assert.deepEqual((await fs.readdir(path.join(context.dataDir, 'portal'))), ['metadata.json'])
  const reopened = createPortalStorage(context)
  await reopened.initialize()
  assert.deepEqual(await reopened.listPresentations(), result)
})

test('JSON sessions persist, expire and log out without storing a plaintext session token', async (t) => {
  const context = await fixture(t)
  const storage = createPortalStorage(context)
  await storage.initialize()
  const valid = session()
  const expired = session({ tokenHash: 'c'.repeat(64), expiresAt: Date.now() - 1 })
  await storage.createSession(valid)
  await storage.createSession(expired)
  assert.deepEqual(await storage.getSession(valid.tokenHash), valid)
  assert.equal(await storage.getSession(expired.tokenHash), null)
  assert.equal(await storage.getSession('d'.repeat(64)), null)
  const reopened = createPortalStorage(context)
  await reopened.initialize()
  assert.deepEqual(await reopened.getSession(valid.tokenHash), valid)
  const json = JSON.parse(await fs.readFile(path.join(context.dataDir, 'portal', 'metadata.json'), 'utf8'))
  assert.deepEqual(json.sessions, [valid])
  assert.deepEqual(Object.keys(json.sessions[0]).sort(), ['csrfToken', 'expiresAt', 'tokenHash'])
  assert.equal(await reopened.deleteSession(valid.tokenHash), true)
  assert.equal(await reopened.deleteSession(valid.tokenHash), false)
  assert.equal(await reopened.getSession(valid.tokenHash), null)
})

test('JSON login limit allows ten attempts, persists rejection and resets next window', async (t) => {
  const context = await fixture(t)
  const storage = createPortalStorage(context)
  await storage.initialize()
  const key = 'e'.repeat(64)
  const now = Date.now()
  const attempts = await Promise.all(Array.from({ length: 10 }, () => storage.consumeLoginAttempt(key, { now })))
  assert.ok(attempts.every((result) => result.allowed && result.retryAfter === 0))
  assert.deepEqual(await storage.consumeLoginAttempt(key, { now: now + 1000 }), { allowed: false, retryAfter: 899 })
  const reopened = createPortalStorage(context)
  await reopened.initialize()
  assert.deepEqual(await reopened.consumeLoginAttempt(key, { now: now + 2000 }), { allowed: false, retryAfter: 898 })
  assert.deepEqual(await reopened.consumeLoginAttempt(key, { now: now + 900_000 }), { allowed: true, retryAfter: 0 })
  assert.deepEqual(await reopened.consumeLoginAttempt('f'.repeat(64), { now, limit: 1, windowMs: 60_000 }), { allowed: true, retryAfter: 0 })
  assert.deepEqual(await reopened.consumeLoginAttempt('f'.repeat(64), { now, limit: 1, windowMs: 60_000 }), { allowed: false, retryAfter: 60 })
})

test('invalid metadata fails without damaging the existing JSON store', async (t) => {
  const context = await fixture(t)
  const storage = createPortalStorage(context)
  await storage.initialize()
  const original = presentation()
  await storage.addPresentation(original)
  for (const override of [
    { id: '../outside' }, { districtId: '../outside' }, { title: 'x'.repeat(161) },
    { originalName: '../outside.pptx' }, { originalName: 'bad\u0000.pptx' },
    { storedName: '../outside.pptx' }, { size: -1 }, { slideCount: 0 }, { uploadedAt: 'invalid' },
  ]) await assert.rejects(storage.addPresentation(presentation(override)), /metadata is invalid/)
  await assert.rejects(storage.createSession(session({ tokenHash: 'plaintext-cookie' })), /metadata is invalid/)
  await assert.rejects(storage.consumeLoginAttempt('unhashed-IP'), /configuration is invalid/)
  assert.deepEqual(await storage.listPresentations(), [original])
})

test('corrupt JSON fails initialization and is never replaced or emptied', async (t) => {
  const context = await fixture(t)
  const portal = path.join(context.dataDir, 'portal')
  await fs.mkdir(portal)
  const target = path.join(portal, 'metadata.json')
  for (const contents of ['{broken-json', '{"version":1,"presentations":[{}],"sessions":[]}', '{"version":2,"presentations":[],"sessions":[]}']) {
    await fs.writeFile(target, contents)
    await assert.rejects(createPortalStorage(context).initialize(), /invalid; existing data was preserved/)
    assert.equal(await fs.readFile(target, 'utf8'), contents)
  }
})

test('refuses linked data roots, portal directories and metadata files without following them', async (t) => {
  const context = await fixture(t)
  const outside = path.join(context.temp, 'outside')
  await fs.mkdir(outside)
  const protectedFile = path.join(outside, 'metadata.json')
  await fs.writeFile(protectedFile, 'protected')
  const junction = process.platform === 'win32' ? 'junction' : 'dir'
  const linkedRoot = path.join(context.temp, 'linked-root')
  await fs.symlink(outside, linkedRoot, junction)
  await assert.rejects(createPortalStorage({ ...context, dataDir: linkedRoot }).initialize(), /redirected/)
  await assert.rejects(createPortalStorage({ ...context, dataDir: path.join(linkedRoot, 'nested') }).initialize(), /redirected/)
  const portal = path.join(context.dataDir, 'portal')
  await fs.symlink(outside, portal, junction)
  await assert.rejects(createPortalStorage(context).initialize(), /redirected/)
  await fs.rmdir(portal)
  await fs.mkdir(portal)
  // A directory at the exact metadata-file path is rejected on every platform.
  await fs.mkdir(path.join(portal, 'metadata.json'))
  await assert.rejects(createPortalStorage(context).initialize(), /unsafe metadata file/)
  assert.equal(await fs.readFile(protectedFile, 'utf8'), 'protected')
})

test('production requires complete MySQL settings and rejects invalid configuration without secrets', async (t) => {
  const context = await fixture(t)
  for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', BSDI_ALLOW_JSON_WRITES: 'true' }, { BSDI_REQUIRE_MYSQL: 'true' }, { DB_HOST: 'test.invalid' }]) {
    assert.throws(() => createPortalStorage({ ...context, env }), /requires complete MySQL configuration/)
  }
  for (const env of [
    { DATABASE_URL: 'postgres://private-user:private-password@test.invalid/private-db' },
    { DATABASE_URL: 'mysql://u:p@test.invalid/db', DB_PORT: '999999' },
    { DATABASE_URL: 'mysql://u:p@test.invalid/db', DB_CONNECTION_LIMIT: 'invalid' },
  ]) assert.throws(() => createPortalStorage({ ...context, env }), (error) => {
    assert.equal(error.message, 'Portal database configuration is invalid.')
    assert.doesNotMatch(String(error), /private-/)
    return true
  })
})

test('MySQL binds all metadata, filters and IDs as parameters, preserves data on initialize and deletes transactionally', async (t) => {
  const context = await fixture(t)
  const fake = fakeMysql()
  const storage = createPortalStorage({ ...context, env: fake.env, createPool: fake.createPool })
  assert.equal(storage.mode, 'mysql')
  await storage.initialize()
  assert.equal(fake.calls.filter(({ sql }) => sql.startsWith('CREATE TABLE')).length, 3)
  const payload = "'); DROP TABLE completed_presentations; --"
  const record = presentation({ title: payload, originalName: `${payload}.pptx` })
  assert.deepEqual(await storage.addPresentation(record), record)
  assert.deepEqual(await storage.getPresentation(record.id), record)
  assert.deepEqual(await storage.listPresentations('barkhan'), [record])
  assert.deepEqual(await storage.listPresentations(payload), [])
  assert.equal(await storage.getPresentation(payload), null)
  assert.equal(await storage.deletePresentation(payload), null)
  assert.ok(fake.calls.every(({ sql }) => !sql.includes(payload)))
  assert.ok(fake.calls.some(({ sql, values }) => sql.startsWith('INSERT INTO completed_presentations') && values.includes(payload)))
  const reopened = createPortalStorage({ ...context, env: fake.env, createPool: fake.createPool })
  await reopened.initialize()
  assert.deepEqual(await reopened.listPresentations(), [record])
  assert.deepEqual(await reopened.deletePresentation(record.id), record)
  assert.equal(await reopened.getPresentation(record.id), null)
  assert.equal(fake.lifecycle.began, 2)
  assert.equal(fake.lifecycle.committed, 2)
  assert.equal(fake.lifecycle.released, 2)
  assert.equal(fake.lifecycle.rolledBack, 0)
  assert.ok(fake.calls.every(({ sql }) => !/\b(DROP|TRUNCATE)\b/.test(sql)))
  assert.deepEqual(await fs.readdir(context.dataDir), [])
  await reopened.close()
  await reopened.close()
  assert.equal(fake.lifecycle.closed, 1)
})

test('MySQL sessions persist across instances, ignore expired records, and support logout', async (t) => {
  const context = await fixture(t)
  const fake = fakeMysql()
  const storage = createPortalStorage({ ...context, env: fake.env, createPool: fake.createPool })
  await storage.initialize()
  const valid = session()
  const expired = session({ tokenHash: 'c'.repeat(64), expiresAt: Date.now() - 1 })
  await storage.createSession(valid)
  await storage.createSession(expired)
  assert.deepEqual(await storage.getSession(valid.tokenHash), valid)
  assert.equal(await storage.getSession(expired.tokenHash), null)
  const reopened = createPortalStorage({ ...context, env: fake.env, createPool: fake.createPool })
  await reopened.initialize()
  assert.deepEqual(await reopened.getSession(valid.tokenHash), valid)
  assert.equal(fake.sessions.has(expired.tokenHash), false)
  assert.equal(await reopened.deleteSession(valid.tokenHash), true)
  assert.equal(await reopened.deleteSession(valid.tokenHash), false)
  assert.equal(await reopened.getSession(valid.tokenHash), null)
})

test('MySQL login limiting uses atomic bounded updates and persists between workers', async (t) => {
  const context = await fixture(t)
  const fake = fakeMysql()
  const first = createPortalStorage({ ...context, env: fake.env, createPool: fake.createPool })
  const second = createPortalStorage({ ...context, env: fake.env, createPool: fake.createPool })
  await first.initialize()
  await second.initialize()
  const key = 'e'.repeat(64)
  const now = Date.now()
  for (let index = 0; index < 10; index += 1) {
    assert.deepEqual(await (index % 2 ? first : second).consumeLoginAttempt(key, { now }), { allowed: true, retryAfter: 0 })
  }
  assert.deepEqual(await second.consumeLoginAttempt(key, { now: now + 1500 }), { allowed: false, retryAfter: 899 })
  assert.deepEqual(await first.consumeLoginAttempt(key, { now: now + 900_000 }), { allowed: true, retryAfter: 0 })
  const update = fake.calls.find(({ sql }) => sql.startsWith('INSERT INTO completed_login_limits'))
  assert.match(update.sql, /ON DUPLICATE KEY UPDATE attempts = IF\(window_start <= \?, 1, LEAST\(attempts \+ 1, 4294967295\)\)/)
  assert.deepEqual(update.values, [key, now, now - 900_000, now - 900_000, now])
})

test('retains database URL aliases, explicit environment overrides and TLS configuration', async (t) => {
  const context = await fixture(t)
  for (const urlKey of ['DATABASE_URL', 'MYSQL_URL']) {
    const fake = fakeMysql()
    const storage = createPortalStorage({
      ...context,
      env: { [urlKey]: 'mysql://url-user:url-password@test.invalid:3307/url-database', MYSQL_SSL: 'required', DB_SSL_REJECT_UNAUTHORIZED: 'false' },
      createPool: fake.createPool,
    })
    await storage.initialize()
    assert.equal(fake.config.host, 'test.invalid')
    assert.equal(fake.config.port, 3307)
    assert.equal(fake.config.database, 'url-database')
    assert.equal(fake.config.user, 'url-user')
    assert.equal(fake.config.password, 'url-password')
    assert.deepEqual(fake.config.ssl, { rejectUnauthorized: false })
    await storage.close()
  }
  const fake = fakeMysql()
  const storage = createPortalStorage({ ...context, env: {
    MYSQL_URL: 'mysql2://url-user:url-password@url.invalid/url-database',
    MYSQL_HOST: 'mysql.invalid', MYSQL_DATABASE: 'mysql_database', MYSQL_USER: 'mysql_user', MYSQL_PASSWORD: 'mysql_password', MYSQL_PORT: '3308',
    DB_HOST: 'db.invalid', DB_NAME: 'db_database', DB_USER: 'db_user', DB_PASSWORD: 'db_password', DB_PORT: '3309', DB_SSL: 'true',
  }, createPool: fake.createPool })
  await storage.initialize()
  assert.deepEqual({ host: fake.config.host, database: fake.config.database, user: fake.config.user, password: fake.config.password, port: fake.config.port, ssl: fake.config.ssl },
    { host: 'db.invalid', database: 'db_database', user: 'db_user', password: 'db_password', port: 3309, ssl: { rejectUnauthorized: true } })
})

test('database failures conceal private driver messages and do not fall back to JSON', async (t) => {
  const context = await fixture(t)
  const fake = fakeMysql()
  fake.pool.execute = async () => { throw new Error('private-password host=private-host') }
  const storage = createPortalStorage({ ...context, env: fake.env, createPool: fake.createPool })
  await assert.rejects(storage.initialize(), (error) => {
    assert.equal(error.message, 'Portal database operation failed.')
    assert.doesNotMatch(String(error), /private-/)
    return true
  })
  assert.equal(fake.lifecycle.closed, 1)
  assert.deepEqual(await fs.readdir(context.dataDir), [])
})
