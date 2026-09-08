import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createPortalStorage } from './portal-storage.js'
import { createApp, release } from './app.js'
import { testPresentation } from './test-pptx.js'
import { testPreviews, testJpeg } from './test-previews.js'
import { hashToken, verifyPassword } from './auth.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testPassword = 'fixture-password-only'
const salt = randomBytes(32).toString('hex')
const verifier = `scrypt$${salt}$${scryptSync(testPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 67108864 }).toString('hex')}`

async function presentationForm(buffer, name = 'District report.pptx', title) {
  const form = new FormData()
  form.set('file', new Blob([buffer]), name)
  form.set('previews', new Blob([await testPreviews()]), `${name}.previews.zip`)
  if (title) form.set('title', title)
  return form
}

async function fixture(t, { production = false, decorateStorage } = {}) {
  const dataDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'completed-portal-api-')))
  const baseStorage = createPortalStorage({ dataDir, env: {} })
  await baseStorage.initialize()
  const storage = decorateStorage ? decorateStorage(baseStorage) : baseStorage
  const env = { NODE_ENV: production ? 'production' : 'test', ADMIN_PASSWORD_HASH: verifier }
  const app = await createApp({ rootDir, dataDir, storage, env })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  env.PUBLIC_ORIGIN = origin
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await storage.close()
    assert.ok(path.basename(dataDir).startsWith('completed-portal-api-'))
    await fs.rm(dataDir, { recursive: true, force: true })
  })
  const request = (route, options = {}) => fetch(origin + route, { ...options, signal: AbortSignal.timeout(15000) })
  const login = () => request('/api/admin/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: testPassword }) })
  return { dataDir, storage, request, login, origin }
}

test('public district catalog uses exactly the supplied names and starts empty', async (t) => {
  const { request } = await fixture(t)
  const response = await request('/api/districts')
  const data = await response.json()
  assert.equal(data.districts.length, 39)
  assert.equal(data.totalPresentations, 0)
  for (const name of ['Barshore', 'Chaghi', 'Gawadar', 'Musa Khel', 'Tump', 'Upper Dera Bugti']) {
    assert.ok(data.districts.some((district) => district.name === name))
  }
  assert.equal((await request('/api/admin/session')).status, 200)
  assert.equal((await request('/api/districts/unknown')).status, 404)
  assert.equal((await request('/api/state')).status, 404)
  assert.equal((await request('/server/admin-credential.js')).status, 404)
  assert.equal((await request('/viewer.html')).status, 404)
  const healthResponse = await request('/api/health')
  assert.equal(healthResponse.status, 200)
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    release,
    presentationStorage: 'local',
    storage: 'json',
    districts: 39,
    presentations: 0,
    availablePresentations: 0,
    missingFiles: 0,
    missingOriginalFiles: 0,
    missingPreviews: 0,
    unavailablePresentations: 0,
  })
  const pageResponse = await request('/')
  assert.match(pageResponse.headers.get('content-security-policy'), /connect-src 'self' blob: data:/)
  const page = await pageResponse.text()
  assert.match(page, /http-equiv="Content-Security-Policy"/)
  assert.match(page, /script-src 'self'/)
  assert.match(page, /connect-src 'self' blob: data:/)
})

test('authenticated upload, isolated preview, exact download, persistence and deletion', async (t) => {
  const { request, login, origin, dataDir } = await fixture(t)
  const unauthorized = await request('/api/admin/districts/aw aran/presentations', { method: 'POST', headers: { Origin: origin } })
  assert.equal(unauthorized.status, 401)
  const signedIn = await login()
  assert.equal(signedIn.status, 200)
  const setCookie = signedIn.headers.get('set-cookie')
  assert.match(setCookie, /HttpOnly/i)
  assert.match(setCookie, /SameSite=Strict/i)
  const cookie = setCookie.split(';')[0]
  const { csrfToken } = await signedIn.json()
  assert.equal((await request('/api/admin/session', { headers: { Cookie: cookie } }).then((res) => res.json())).authenticated, true)
  const protectedHeaders = { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrfToken }
  const missingCsrf = await request('/api/admin/districts/aw aran/presentations', { method: 'POST', headers: { Origin: origin, Cookie: cookie } })
  assert.equal(missingCsrf.status, 403)
  const buffer = await testPresentation()
  const form = await presentationForm(buffer, 'District report.pptx', 'District report')
  const upload = await request('/api/admin/districts/aw aran/presentations'.replace('aw aran', 'awaran'), { method: 'POST', headers: protectedHeaders, body: form })
  const uploaded = await upload.json()
  assert.equal(upload.status, 201, JSON.stringify(uploaded))
  const item = uploaded.presentation
  assert.equal(item.slideCount, 2)
  assert.equal(item.title, 'District report')
  assert.equal(item.available, true)
  assert.equal(item.storedName, undefined)
  assert.equal(item.fileUrl, undefined)
  assert.equal(item.downloadUrl, undefined)
  assert.deepEqual(item.preview, {
    version: 1, slideCount: 2, width: 1600, height: 900, format: 'jpg',
    baseUrl: `/api/presentations/${item.id}/previews`,
  })
  const catalog = await request('/api/districts').then((res) => res.json())
  assert.equal(catalog.totalPresentations, 1)
  assert.equal(catalog.districts.find((district) => district.id === 'awaran').presentationCount, 1)
  const duplicateForm = new FormData()
  duplicateForm.set('file', new Blob([buffer]), 'Another report.pptx')
  const duplicateUpload = await request('/api/admin/districts/awaran/presentations', { method: 'POST', headers: protectedHeaders, body: duplicateForm })
  assert.equal(duplicateUpload.status, 409)
  assert.match((await duplicateUpload.json()).error, /already has a presentation/)
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/tmp')), [])
  assert.equal((await fs.readdir(path.join(dataDir, 'portal/files'))).length, 1)
  assert.equal((await fs.readdir(path.join(dataDir, 'portal/previews'))).length, 1)
  const preview = await request(item.viewUrl)
  assert.equal(preview.status, 200)
  assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/)
  assert.doesNotMatch(preview.headers.get('content-security-policy'), /allow-downloads/)
  assert.doesNotMatch(preview.headers.get('content-security-policy'), /allow-same-origin/)
  const previewHtml = await preview.text()
  assert.match(previewHtml, /<iframe[^>]+sandbox="allow-scripts"/)
  assert.doesNotMatch(previewHtml, /allow-downloads/)
  assert.match(previewHtml, /srcdoc="/)
  assert.match(previewHtml, /http-equiv="Content-Security-Policy"/)
  assert.doesNotMatch(previewHtml, /allow-same-origin/)
  assert.match(previewHtml, /name=&quot;presentation-id&quot;/)
  const slide = await request(`${item.preview.baseUrl}/slide-0001.jpg`)
  assert.equal(slide.status, 200)
  assert.equal(slide.headers.get('content-type'), 'image/jpeg')
  assert.equal(slide.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(Buffer.from(await slide.arrayBuffer()), testJpeg({ marker: 1 }))
  assert.equal((await request(`/api/presentations/${item.id}/file`)).status, 404)
  assert.equal((await request(`/api/presentations/${item.id}/download`)).status, 404)
  assert.equal((await request(`/api/admin/presentations/${item.id}/download`)).status, 401)
  const download = await request(`/api/admin/presentations/${item.id}/download`, { headers: { Cookie: cookie } })
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-disposition'), /attachment/)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), buffer)
  const restarted = createPortalStorage({ dataDir, env: {} })
  await restarted.initialize()
  assert.equal((await restarted.listPresentations()).length, 1)
  await restarted.close()
  const crossSite = await request(`/api/admin/presentations/${item.id}`, { method: 'DELETE', headers: { ...protectedHeaders, Origin: 'https://example.invalid' } })
  assert.equal(crossSite.status, 403)
  const remove = await request(`/api/admin/presentations/${item.id}`, { method: 'DELETE', headers: protectedHeaders })
  assert.equal(remove.status, 200)
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/files')), [])
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/previews')), [])
  assert.equal((await request(`/api/admin/presentations/${item.id}/download`, { headers: { Cookie: cookie } })).status, 404)
  assert.equal((await request(`${item.preview.baseUrl}/slide-0001.jpg`)).status, 404)
  assert.equal((await request(item.viewUrl)).status, 404)
  const logout = await request('/api/admin/logout', { method: 'POST', headers: protectedHeaders })
  assert.equal(logout.status, 200)
  assert.equal((await request('/api/admin/session', { headers: { Cookie: cookie } }).then((res) => res.json())).authenticated, false)
})

test('reports and atomically repairs an orphaned database record when its PowerPoint file is missing', async (t) => {
  const { request, login, origin, dataDir } = await fixture(t)
  const signedIn = await login()
  const cookie = signedIn.headers.get('set-cookie').split(';')[0]
  const { csrfToken } = await signedIn.json()
  const protectedHeaders = { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrfToken }
  const form = await presentationForm(await testPresentation())
  const upload = await request('/api/admin/districts/awaran/presentations', {
    method: 'POST', headers: protectedHeaders, body: form,
  })
  const item = (await upload.json()).presentation
  const [storedName] = await fs.readdir(path.join(dataDir, 'portal/files'))
  await fs.unlink(path.join(dataDir, 'portal/files', storedName))

  const detail = await request('/api/districts/awaran').then((response) => response.json())
  assert.equal(detail.presentations[0].available, false)
  const metadata = await request(`/api/presentations/${item.id}`).then((response) => response.json())
  assert.equal(metadata.presentation.available, false)
  const catalog = await request('/api/districts').then((response) => response.json())
  assert.equal(catalog.districts.find((district) => district.id === 'awaran').presentationCount, 0)
  const healthResponse = await request('/api/health')
  const health = await healthResponse.json()
  assert.equal(healthResponse.status, 200)
  assert.equal(health.ok, false)
  assert.equal(health.release, release)
  assert.equal(health.presentationStorage, 'local')
  assert.equal(health.storage, 'json')
  assert.equal(health.districts, 39)
  assert.equal(health.presentations, 1)
  assert.equal(health.availablePresentations, 0)
  assert.equal(health.missingFiles, 1)
  assert.equal(health.missingOriginalFiles, 1)
  assert.equal(health.missingPreviews, 0)
  assert.equal(health.unavailablePresentations, 1)
  assert.equal((await request(`/api/presentations/${item.id}/file`)).status, 404)
  assert.equal((await request(`/api/presentations/${item.id}/download`)).status, 404)

  const invalidRepairForm = new FormData()
  invalidRepairForm.set('file', new Blob([Buffer.from('not a presentation')]), 'Invalid repair.pptx')
  invalidRepairForm.set('previews', new Blob([await testPreviews()]), 'Invalid repair.previews.zip')
  const invalidRepair = await request('/api/admin/districts/awaran/presentations', {
    method: 'POST', headers: protectedHeaders, body: invalidRepairForm,
  })
  assert.equal(invalidRepair.status, 400)
  assert.equal((await request('/api/districts/awaran').then((response) => response.json())).presentations[0].id, item.id)
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/files')), [])
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/tmp')), [])

  const replacementBuffer = await testPresentation()
  const replacementForm = await presentationForm(replacementBuffer, 'Repaired district report.pptx', 'Repaired district report')
  const repair = await request('/api/admin/districts/awaran/presentations', {
    method: 'POST', headers: protectedHeaders, body: replacementForm,
  })
  const repaired = await repair.json()
  assert.equal(repair.status, 201, JSON.stringify(repaired))
  assert.notEqual(repaired.presentation.id, item.id)
  assert.equal(repaired.presentation.title, 'Repaired district report')
  assert.equal(repaired.presentation.available, true)
  assert.equal((await request(`/api/admin/presentations/${item.id}/download`, { headers: { Cookie: cookie } })).status, 404)
  const repairedDownload = await request(`/api/admin/presentations/${repaired.presentation.id}/download`, { headers: { Cookie: cookie } })
  assert.equal(repairedDownload.status, 200)
  assert.deepEqual(Buffer.from(await repairedDownload.arrayBuffer()), replacementBuffer)
  assert.equal((await fs.readdir(path.join(dataDir, 'portal/files'))).length, 1)
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/tmp')), [])
  const repairedDetail = await request('/api/districts/awaran').then((response) => response.json())
  assert.equal(repairedDetail.presentations.length, 1)
  assert.equal(repairedDetail.presentations[0].id, repaired.presentation.id)
  assert.equal(repairedDetail.presentations[0].available, true)
  const repairedHealthResponse = await request('/api/health')
  const repairedHealth = await repairedHealthResponse.json()
  assert.equal(repairedHealthResponse.status, 200)
  assert.equal(repairedHealth.presentations, 1)
  assert.equal(repairedHealth.availablePresentations, 1)
  assert.equal(repairedHealth.missingFiles, 0)
  assert.equal(repairedHealth.missingPreviews, 0)

  const occupiedForm = new FormData()
  occupiedForm.set('file', new Blob([replacementBuffer]), 'Should not replace healthy report.pptx')
  const occupied = await request('/api/admin/districts/awaran/presentations', {
    method: 'POST', headers: protectedHeaders, body: occupiedForm,
  })
  assert.equal(occupied.status, 409)
  assert.match((await occupied.json()).error, /already has a presentation/)
  assert.equal((await fs.readdir(path.join(dataDir, 'portal/files'))).length, 1)
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/tmp')), [])

  const remove = await request(`/api/admin/presentations/${repaired.presentation.id}`, {
    method: 'DELETE', headers: protectedHeaders,
  })
  assert.equal(remove.status, 200)
})

test('rejects disguised files, active content and externally linked decks without retaining uploads', async (t) => {
  const { request, login, origin, dataDir } = await fixture(t)
  const signedIn = await login()
  const cookie = signedIn.headers.get('set-cookie').split(';')[0]
  const { csrfToken } = await signedIn.json()
  for (const [name, buffer] of [
    ['fake.pptx', Buffer.from('<script>alert(1)</script>')],
    ['old.ppt', await testPresentation()],
    ['macro.pptx', await testPresentation({ active: true })],
    ['linked.pptx', await testPresentation({ external: true })],
  ]) {
    const form = new FormData()
    form.set('file', new Blob([buffer]), name)
    form.set('previews', new Blob([await testPreviews()]), `${name}.previews.zip`)
    const response = await request('/api/admin/districts/barkhan/presentations', {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrfToken }, body: form,
    })
    assert.equal(response.status, 400, name)
  }
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/tmp')), [])
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/files')), [])
})

test('keeps a presentation when MySQL commits but its acknowledgement is lost', async (t) => {
  const { request, login, origin, dataDir } = await fixture(t, {
    decorateStorage(base) {
      return {
        ...base,
        mode: 'mysql',
        async addPresentation(metadata) {
          await base.addPresentation(metadata)
          throw new Error('simulated lost commit acknowledgement')
        },
        async replacePresentation(expectedId, metadata) {
          await base.replacePresentation(expectedId, metadata)
          throw new Error('simulated lost commit acknowledgement')
        },
      }
    },
  })
  const signedIn = await login()
  const cookie = signedIn.headers.get('set-cookie').split(';')[0]
  const { csrfToken } = await signedIn.json()
  const headers = { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrfToken }
  const buffer = await testPresentation()
  const firstForm = await presentationForm(buffer, 'Initial report.pptx')
  const firstResponse = await request('/api/admin/districts/barkhan/presentations', {
    method: 'POST', headers, body: firstForm,
  })
  const first = await firstResponse.json()
  assert.equal(firstResponse.status, 201, JSON.stringify(first))
  const [firstStoredName] = await fs.readdir(path.join(dataDir, 'portal/files'))
  await fs.unlink(path.join(dataDir, 'portal/files', firstStoredName))

  const replacementForm = await presentationForm(buffer, 'Recovered report.pptx')
  const replacementResponse = await request('/api/admin/districts/barkhan/presentations', {
    method: 'POST', headers, body: replacementForm,
  })
  const replacement = await replacementResponse.json()
  assert.equal(replacementResponse.status, 201, JSON.stringify(replacement))
  assert.notEqual(replacement.presentation.id, first.presentation.id)
  assert.equal((await request(`/api/admin/presentations/${replacement.presentation.id}/download`, { headers: { Cookie: cookie } })).status, 200)
  assert.equal((await fs.readdir(path.join(dataDir, 'portal/files'))).length, 1)
  assert.equal((await fs.readdir(path.join(dataDir, 'portal/previews'))).length, 1)
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/tmp')), [])
})

test('retains a durable file while a MySQL commit outcome cannot be checked', async (t) => {
  const { request, login, origin, dataDir } = await fixture(t, {
    decorateStorage(base) {
      return {
        ...base,
        mode: 'mysql',
        async addPresentation() { throw new Error('simulated uncertain write') },
        async getPresentation() { throw new Error('simulated database outage') },
      }
    },
  })
  const signedIn = await login()
  const cookie = signedIn.headers.get('set-cookie').split(';')[0]
  const { csrfToken } = await signedIn.json()
  const form = await presentationForm(await testPresentation(), 'Uncertain report.pptx')
  const response = await request('/api/admin/districts/barkhan/presentations', {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrfToken },
    body: form,
  })
  assert.equal(response.status, 503)
  assert.equal((await fs.readdir(path.join(dataDir, 'portal/files'))).length, 1)
  assert.equal((await fs.readdir(path.join(dataDir, 'portal/previews'))).length, 1)
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'portal/tmp')), [])
})

test('persistent login throttling, wrong password, missing origin and production cookie flags', async (t) => {
  const { request, login, origin, dataDir } = await fixture(t, { production: true })
  assert.equal((await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: testPassword }) })).status, 403)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request('/api/admin/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"password":"wrong"}' })
    assert.equal(response.status, 401)
  }
  const good = await login()
  assert.match(good.headers.get('set-cookie'), /^__Host-cp_session=/)
  assert.match(good.headers.get('set-cookie'), /; Secure/)
  for (let attempt = 3; attempt < 10; attempt += 1) await login()
  const limited = await login()
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await login()).status, 429)
  const metadata = JSON.parse(await fs.readFile(path.join(dataDir, 'portal/metadata.json'), 'utf8'))
  const globalLimit = metadata.loginLimits.find((entry) => entry.keyHash === hashToken('admin-login-global'))
  assert.equal(globalLimit.attempts, 10, 'A throttled source cannot consume the global login quota.')
})

test('password verifier uses exact characters and a salted hash', async () => {
  assert.equal(await verifyPassword(testPassword, verifier), true)
  assert.equal(await verifyPassword(testPassword + '\\', verifier), false)
  assert.equal(await verifyPassword('', verifier), false)
})
