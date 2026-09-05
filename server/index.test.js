import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function reservePort() {
  const reservation = net.createServer()
  await new Promise((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', resolve)
  })
  const port = reservation.address().port
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()))
  return port
}

for (const [startupMode, startupArgs] of [
  ['direct', ['server/index.js']],
  ['host require', ['-e', "require('./server/index.js')"]],
]) {
test(`maintenance ${startupMode} startup deletes content and prevents legacy clients from restoring it`, { timeout: 35_000 }, async (t) => {
  // Copy the application so the real checkout and its data are never cleanup targets.
  const temporaryRoot = await fs.realpath(os.tmpdir())
  const fixtureRoot = await fs.mkdtemp(path.join(temporaryRoot, 'completed-projects-integration-'))
  const dataDir = path.join(fixtureRoot, 'server-data')
  let child
  let childExit
  let startupError
  let output = ''

  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill()
      const stopped = await Promise.race([childExit.then(() => true), delay(3000, false, { ref: false })])
      if (!stopped) {
        child.kill('SIGKILL')
        await Promise.race([childExit, delay(3000, undefined, { ref: false })])
      }
    }
    const resolvedFixture = await fs.realpath(fixtureRoot)
    const relative = path.relative(temporaryRoot, resolvedFixture)
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    assert.ok(path.basename(resolvedFixture).startsWith('completed-projects-integration-'))
    // fs.rm removes the dependency junction itself without following its target.
    await fs.rm(resolvedFixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })

  await fs.mkdir(path.join(fixtureRoot, 'server'), { recursive: true })
  await fs.writeFile(path.join(fixtureRoot, 'package.json'), '{"type":"module"}\n')
  await fs.copyFile(path.join(projectRoot, 'server/index.js'), path.join(fixtureRoot, 'server/index.js'))
  await fs.copyFile(path.join(projectRoot, 'server/storage.js'), path.join(fixtureRoot, 'server/storage.js'))
  await fs.cp(path.join(projectRoot, 'dist'), path.join(fixtureRoot, 'dist'), { recursive: true })
  await fs.symlink(path.join(projectRoot, 'node_modules'), path.join(fixtureRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')

  const seededPaths = [
    'bsdi-db.json',
    'media/legacy-image.jpg',
    'media/legacy-video.mp4',
    'generated-reports/legacy-report.pdf',
    'templates/Completed_BSDI-14-03-2026.pptx',
  ]
  for (const relative of seededPaths) {
    const file = path.join(dataDir, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, relative.endsWith('.json') ? '{"projects":[{"id":"legacy-project"}]}' : 'legacy content fixture')
  }

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
    !/^(?:DB_|MYSQL_|MARIADB_|DATABASE_|BSDI_)/i.test(key) && key.toUpperCase() !== 'NODE_OPTIONS'
  )))
  const port = await reservePort()
  const baseUrl = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, startupArgs, {
    cwd: fixtureRoot,
    env: { ...env, NODE_ENV: 'test', BSDI_DATA_DIR: dataDir, PORT: String(port) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(-8000) })
  child.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(-8000) })
  childExit = new Promise((resolve) => {
    child.once('exit', resolve)
    child.once('error', (error) => { startupError = error; resolve() })
  })

  const request = (route, options = {}) => fetch(`${baseUrl}${route}`, { ...options, signal: AbortSignal.timeout(3000) })
  let health
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (startupError || child.exitCode !== null || child.signalCode !== null) {
      assert.fail(`Maintenance server failed to start: ${startupError?.message || child.exitCode}\n${output}`)
    }
    try {
      const response = await request('/api/health')
      if (response.ok) {
        health = await response.json()
        break
      }
    } catch {
      // The listener is unavailable until startup cleanup has completed.
    }
    await delay(100)
  }
  assert.ok(health, `Maintenance server did not become healthy within 15 seconds.\n${output}`)
  assert.equal(health.clean, true)
  assert.equal(health.storage, 'none')
  assert.equal(health.mysqlTablePresent, null)
  assert.equal(health.persistentFileCount, 0)
  assert.equal(health.remainingLegacyFiles, 0)
  assert.equal(health.googleSheet.enabled, false)
  for (const relative of seededPaths) {
    await assert.rejects(fs.stat(path.join(dataDir, relative)), { code: 'ENOENT' })
  }

  const snapshot = { revision: 9999, adminPassword: 'old-fixture-password', data: { projects: [{ id: 'legacy-project' }], media: [{ src: '/media/legacy-image.jpg' }] } }
  for (const [method, route] of [
    ['PUT', '/api/state'],
    ['POST', '/api/state'],
    ['POST', '/api/media'],
    ['POST', '/api/google-sheet/sync'],
    ['POST', '/api/database-media'],
  ]) {
    const response = await request(route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) })
    assert.equal(response.status, 410, `${method} ${route} must reject legacy writes`)
    await response.arrayBuffer()
  }
  const stateResponse = await request('/api/state?forceSheetSync=1')
  assert.equal(stateResponse.status, 200)
  const state = await stateResponse.json()
  for (const collection of ['phases', 'divisions', 'districts', 'projects', 'media', 'proposalDocuments']) {
    assert.deepEqual(state[collection], [], `${collection} must remain empty after attempted writes`)
  }
  assert.deepEqual(state.settings, {})
  for (const route of [
    '/database/bsdi-db.json', '/data/projects.json', '/database/media/legacy-image.jpg',
    '/synced-media/legacy-video.mp4', '/media/legacy-image.jpg', '/brand/bsdi-logo.png',
    '/api/report/pdf', '/api/report/pptx', '/legacy.pdf', '/legacy.ppt', '/legacy.pptx',
  ]) {
    const response = await request(route)
    assert.equal(response.status, 410, `${route} must not expose removed content`)
    await response.arrayBuffer()
  }

  const workerResponse = await request('/sw.js')
  assert.equal(workerResponse.status, 200)
  assert.match(workerResponse.headers.get('cache-control'), /no-store/)
  assert.match(await workerResponse.text(), /registration\.unregister/)
  const pageResponse = await request('/')
  assert.equal(pageResponse.status, 200)
  const html = await pageResponse.text()
  assert.match(html, /<title>Completed Projects<\/title>/)
  const scriptPath = html.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(scriptPath, 'The holding page must load its built application')
  const scriptResponse = await request(scriptPath)
  assert.equal(scriptResponse.status, 200)
  assert.match(await scriptResponse.text(), /The website is being prepared for an update\./)

  // Verify health checks disk contents instead of reporting hardcoded zero counts.
  await fs.mkdir(path.join(dataDir, 'media'), { recursive: true })
  const unexpectedFile = path.join(dataDir, 'media', 'unexpected.jpg')
  await fs.writeFile(unexpectedFile, 'unexpected content fixture')
  const dirtyResponse = await request('/api/health')
  assert.equal(dirtyResponse.status, 503)
  const dirtyHealth = await dirtyResponse.json()
  assert.equal(dirtyHealth.clean, false)
  assert.equal(dirtyHealth.persistentFileCount, 1)
  await fs.unlink(unexpectedFile)
  await fs.rmdir(path.dirname(unexpectedFile))
  const finalHealthResponse = await request('/api/health')
  assert.equal(finalHealthResponse.status, 200)
  const finalHealth = await finalHealthResponse.json()
  assert.equal(finalHealth.clean, true)
  assert.equal(finalHealth.persistentFileCount, 0)
})
}
