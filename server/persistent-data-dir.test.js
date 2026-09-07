import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  deriveHostingerDataDir,
  prepareProductionDataDir,
  validatePersistentDataPath,
} from './persistent-data-dir.js'

test('production storage requires an explicit absolute path outside the deployment', () => {
  const deploymentRoot = path.resolve('application')
  assert.throws(() => validatePersistentDataPath({ configuredPath: '', deploymentRoot }), /absolute BSDI_DATA_DIR/)
  assert.throws(() => validatePersistentDataPath({ configuredPath: 'persistent-data', deploymentRoot }), /absolute BSDI_DATA_DIR/)
  assert.throws(() => validatePersistentDataPath({ configuredPath: deploymentRoot, deploymentRoot }), /outside the deployment/)
  assert.throws(() => validatePersistentDataPath({ configuredPath: path.join(deploymentRoot, 'data'), deploymentRoot }), /outside the deployment/)
})

test('production storage rejects temporary and deployment-managed paths', () => {
  const root = path.parse(process.cwd()).root
  const deploymentRoot = path.join(root, 'srv', 'completed-projects', 'nodejs')
  assert.throws(() => validatePersistentDataPath({
    configuredPath: path.join(os.tmpdir(), 'completed-projects'), deploymentRoot,
  }), /temporary directory/)
  for (const segment of ['nodejs', 'public_html', 'dist', 'build', 'releases', 'current']) {
    assert.throws(() => validatePersistentDataPath({
      configuredPath: path.join(root, 'srv', segment, 'bsdi-data'), deploymentRoot, temporaryRoots: [],
    }), new RegExp(`inside ${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  }
})

test('Hostinger deployment roots derive a durable domain sibling', () => {
  assert.equal(
    deriveHostingerDataDir('/home/u123/domains/completedprojects.online/nodejs/releases/42'),
    '/home/u123/domains/completedprojects.online/bsdi-data',
  )
  assert.equal(
    deriveHostingerDataDir('/home/AccountName/domains/Example.test/nodejs/current'),
    '/home/AccountName/domains/Example.test/bsdi-data',
  )
  assert.equal(deriveHostingerDataDir('/srv/completedprojects/nodejs'), null)
  assert.equal(deriveHostingerDataDir('relative/nodejs'), null)
})

test('Hostinger always uses the durable domain sibling instead of deployment configuration', async () => {
  const directories = new Set()
  const files = new Set()
  const fakeFileSystem = {
    async mkdir(directory) { directories.add(directory) },
    async lstat(directory) {
      assert.ok(directories.has(directory))
      return { isDirectory: () => true, isSymbolicLink: () => false }
    },
    async realpath(directory) { return directory },
    async access(directory) { assert.ok(directories.has(directory)) },
    async open(file) {
      files.add(file)
      return { writeFile: async () => {}, sync: async () => {}, close: async () => {} }
    },
    async unlink(file) { files.delete(file) },
  }
  const result = await prepareProductionDataDir({
    configuredPath: '/srv/otherwise-valid/presentation-data',
    deploymentRoot: '/home/u123/domains/completedprojects.online/nodejs/releases/42',
    temporaryRoots: [], pathApi: path.posix, fileSystem: fakeFileSystem,
  })
  assert.deepEqual(result, {
    dataDir: '/home/u123/domains/completedprojects.online/bsdi-data',
    source: 'hostinger',
    replacedUnsafeConfiguration: true,
  })
  assert.equal(files.size, 0)
})

test('Hostinger does not silently fall back when its durable directory is unavailable', async () => {
  const fakeFileSystem = {
    async mkdir() { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) },
  }
  await assert.rejects(prepareProductionDataDir({
    configuredPath: '/srv/otherwise-valid/presentation-data',
    deploymentRoot: '/home/u123/domains/completedprojects.online/nodejs/releases/42',
    temporaryRoots: [], pathApi: path.posix, fileSystem: fakeFileSystem,
  }), /not writable/)
})

test('prepared storage is writable and leaves no probe file', async (t) => {
  const fixtureRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'persistent-data-dir-test-')))
  const deploymentRoot = path.join(fixtureRoot, 'nodejs')
  const configuredPath = path.join(fixtureRoot, 'bsdi-data')
  t.after(async () => fs.rm(fixtureRoot, { recursive: true, force: true }))
  const result = await prepareProductionDataDir({ configuredPath, deploymentRoot, temporaryRoots: [] })
  assert.equal(result.dataDir, configuredPath)
  assert.equal(result.source, 'configured')
  assert.equal(result.replacedUnsafeConfiguration, false)
  assert.deepEqual(await fs.readdir(configuredPath), [])
})
