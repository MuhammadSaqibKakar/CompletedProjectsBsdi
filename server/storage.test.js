import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCleanupStorage } from './storage.js'

const CANONICAL = 'Completed_BSDI-14-03-2026.pptx'

async function fixture(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bsdi-cleanup-test-')))
  const rootDir = path.join(temp, 'app')
  const dataDir = path.join(temp, 'bsdi-data')
  await fs.mkdir(rootDir)
  await fs.mkdir(dataDir)
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  return { temp, rootDir, dataDir, env: {} }
}

async function write(target, content = 'legacy data') {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

async function exists(target) {
  return fs.lstat(target).then(() => true, (error) => {
    if (error.code === 'ENOENT') return false
    throw error
  })
}

test('clears dedicated data and safe templates; preserves neighboring files and local sibling PPT', async (t) => {
  const context = await fixture(t)
  const neighbor = path.join(context.temp, 'unrelated.pdf')
  const appCode = path.join(context.rootDir, 'index.js')
  const siblingCanonical = path.join(context.temp, CANONICAL)
  const canonical = path.join(context.rootDir, CANONICAL)
  const configured = path.join(context.rootDir, 'templates', 'legacy.pptx')
  await Promise.all([
    write(path.join(context.dataDir, 'bsdi-db.json')),
    write(path.join(context.dataDir, 'database', 'media', 'old.jpg')),
    write(path.join(context.dataDir, 'private', 'arbitrary.bin')),
    write(path.join(context.dataDir, 'generated-reports', 'report.pdf')),
    write(path.join(context.dataDir, 'videos', 'old.mp4')),
    write(neighbor), write(appCode), write(canonical), write(configured), write(siblingCanonical),
  ])
  const storage = createCleanupStorage({ ...context, env: { BSDI_TEMPLATE_PPTX_PATH: configured } })
  assert.equal(storage.mode, 'none')
  assert.deepEqual(await storage.verifyClean(), {
    storage: 'none', mysqlTablePresent: null, persistentFileCount: 5, remainingLegacyFiles: 2, clean: false,
  })
  assert.deepEqual(await storage.clearLegacyData(), {
    storage: 'none', mysqlTablePresent: null, persistentFileCount: 0, remainingLegacyFiles: 0, clean: true,
  })
  assert.deepEqual(await fs.readdir(context.dataDir), [])
  for (const untouched of [neighbor, appCode, siblingCanonical]) assert.equal(await exists(untouched), true)
  assert.equal(await exists(configured), false)
  assert.equal((await storage.clearLegacyData()).clean, true)
  await write(path.join(context.dataDir, 'repopulated.json'))
  assert.equal((await storage.verifyClean()).clean, false)
  assert.equal(await exists(path.join(context.dataDir, 'repopulated.json')), true)
  await storage.close()
})

test('removes the observed canonical sibling only under the Hostinger domain directory', async (t) => {
  const context = await fixture(t)
  const domainDir = path.join(context.temp, 'completedprojects.online')
  const rootDir = path.join(domainDir, 'public_html')
  await fs.mkdir(rootDir, { recursive: true })
  const canonical = path.join(domainDir, CANONICAL)
  await write(canonical)
  assert.equal((await createCleanupStorage({ ...context, rootDir }).clearLegacyData()).clean, true)
  assert.equal(await exists(canonical), false)
})

test('refuses unsafe, root and ancestor data directories before deleting files', async (t) => {
  const context = await fixture(t)
  for (const dataDir of [context.rootDir, context.temp, path.parse(context.temp).root]) {
    await assert.rejects(createCleanupStorage({ ...context, dataDir }).clearLegacyData(), /unsafe data directory/)
  }
  const ancestor = path.join(context.temp, 'server-data')
  const nestedApp = path.join(ancestor, 'app')
  await fs.mkdir(nestedApp, { recursive: true })
  await assert.rejects(createCleanupStorage({ ...context, rootDir: nestedApp, dataDir: ancestor }).clearLegacyData(), /unsafe data directory/)
  const protectedFile = path.join(context.dataDir, 'keep.json')
  const externalTemplate = path.join(context.temp, CANONICAL)
  await write(protectedFile)
  await write(externalTemplate)
  const storage = createCleanupStorage({ ...context, env: { BSDI_CANONICAL_PPTX_PATH: externalTemplate } })
  await assert.rejects(storage.clearLegacyData(), /unsafe configured presentation path/)
  assert.equal(await exists(protectedFile), true)
  assert.equal(await exists(externalTemplate), true)
})

test('unlinks nested directory junctions without traversing external files', async (t) => {
  const context = await fixture(t)
  const outside = path.join(context.temp, 'other-project')
  const untouched = path.join(outside, 'keep.pdf')
  await write(untouched)
  await fs.symlink(outside, path.join(context.dataDir, 'linked-media'), process.platform === 'win32' ? 'junction' : 'dir')
  const storage = createCleanupStorage(context)
  assert.equal((await storage.verifyClean()).persistentFileCount, 1)
  assert.equal((await storage.clearLegacyData()).clean, true)
  assert.equal(await exists(untouched), true)
})

test('refuses a linked data directory or a linked ancestor', async (t) => {
  const context = await fixture(t)
  const outside = path.join(context.temp, 'other-project')
  await write(path.join(outside, 'keep.json'))
  await fs.rmdir(context.dataDir)
  await fs.symlink(outside, context.dataDir, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(createCleanupStorage(context).clearLegacyData(), /unsafe data directory/)
  const redirect = path.join(context.rootDir, 'redirect')
  await fs.symlink(outside, redirect, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(createCleanupStorage({ ...context, dataDir: path.join(redirect, 'bsdi-data') }).clearLegacyData(), /redirected/)
  assert.equal(await exists(path.join(outside, 'keep.json')), true)
})

test('refuses an app template redirected through a directory junction', async (t) => {
  const context = await fixture(t)
  const outside = path.join(context.temp, 'other-project')
  await write(path.join(outside, 'template.pptx'))
  const redirect = path.join(context.rootDir, 'templates')
  await fs.symlink(outside, redirect, process.platform === 'win32' ? 'junction' : 'dir')
  const storage = createCleanupStorage({ ...context, env: { BSDI_TEMPLATE_PPTX_PATH: path.join(redirect, 'template.pptx') } })
  await assert.rejects(storage.clearLegacyData(), /unsafe configured presentation path/)
  assert.equal(await exists(path.join(outside, 'template.pptx')), true)
})

test('absent persistent directory stays absent; an empty nested directory is detected', async (t) => {
  const context = await fixture(t)
  await fs.mkdir(path.join(context.dataDir, 'empty'))
  const storage = createCleanupStorage(context)
  assert.equal((await storage.verifyClean()).clean, false)
  assert.equal((await storage.clearLegacyData()).clean, true)
  await fs.rmdir(context.dataDir)
  assert.equal((await storage.clearLegacyData()).clean, true)
  assert.equal(await exists(context.dataDir), false)
})

test('requires MySQL in production and does not allow the former JSON bypass', async (t) => {
  const context = await fixture(t)
  for (const env of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', BSDI_ALLOW_JSON_WRITES: 'true' },
    { BSDI_REQUIRE_MYSQL: 'required' },
    { DB_HOST: 'db-host' },
  ]) {
    assert.throws(() => createCleanupStorage({ ...context, env }), /requires complete MySQL configuration/)
  }
  assert.throws(() => createCleanupStorage({ ...context, env: { DATABASE_URL: 'bad-secret-url' } }), /configuration is invalid/)
})

test('drops only the exact state table, verifies without writes, retains TLS and closes pool', async (t) => {
  const context = await fixture(t)
  let present = true
  let closed = 0
  let config
  const queries = []
  const storage = createCleanupStorage({
    ...context,
    env: {
      MYSQL_URL: 'mysql://test-user:test-pass@db.example:3307/test-db',
      MYSQL_SSL: 'required',
      DB_SSL_REJECT_UNAUTHORIZED: 'false',
    },
    createPool(value) {
      config = value
      return {
        async query(sql, values) {
          queries.push({ sql, values })
          if (sql === 'DROP TABLE IF EXISTS `bsdi_dashboard_state`') {
            present = false
            return [{}]
          }
          assert.match(sql, /table_schema = DATABASE\(\) AND BINARY table_name = \?/)
          assert.deepEqual(values, ['bsdi_dashboard_state'])
          return [[{ table_count: present ? 1 : 0 }]]
        },
        async end() { closed += 1 },
      }
    },
  })
  assert.equal((await storage.verifyClean()).mysqlTablePresent, true)
  assert.equal((await storage.clearLegacyData()).clean, true)
  assert.equal((await storage.verifyClean()).mysqlTablePresent, false)
  assert.equal(queries.filter(({ sql }) => sql.startsWith('DROP')).length, 1)
  assert.equal(config.host, 'db.example')
  assert.equal(config.port, 3307)
  assert.deepEqual(config.ssl, { rejectUnauthorized: false })
  present = true
  assert.equal((await storage.verifyClean()).clean, false)
  assert.equal(present, true)
  await storage.close()
  await storage.close()
  assert.equal(closed, 1)
})

test('database failures block cleanup before file deletion without exposing driver details', async (t) => {
  const context = await fixture(t)
  const data = path.join(context.dataDir, 'keep-until-db-clean.json')
  await write(data)
  const storage = createCleanupStorage({
    ...context,
    env: { DB_HOST: 'host', DB_NAME: 'database', DB_USER: 'user' },
    createPool: () => ({
      async query() { throw new Error('private-password-and-host') },
      async end() {},
    }),
  })
  await assert.rejects(storage.clearLegacyData(), (error) => {
    assert.equal(error.message, 'BSDI database cleanup or verification failed.')
    assert.doesNotMatch(String(error), /private-password/)
    return true
  })
  assert.equal(await exists(data), true)
  await storage.close()
})
