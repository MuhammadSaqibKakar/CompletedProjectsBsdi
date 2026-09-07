import fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const managedDirectoryNames = new Set([
  '.next', '.output', 'build', 'builds', 'current', 'deploy', 'deployments',
  'dist', 'nodejs', 'out', 'public_html', 'release', 'releases',
])

function rawPathSegments(value, pathApi) {
  const root = pathApi.parse(value).root
  return value.slice(root.length).split(/[\\/]+/).filter(Boolean)
}

function pathSegments(value, pathApi) {
  return rawPathSegments(value, pathApi).map((part) => part.toLowerCase())
}

function samePath(first, second, pathApi) {
  const left = pathApi.normalize(first)
  const right = pathApi.normalize(second)
  return pathApi === path.win32 ? left.toLowerCase() === right.toLowerCase() : left === right
}

function isWithin(parent, candidate, pathApi) {
  const relative = pathApi.relative(pathApi.resolve(parent), pathApi.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative))
}

function configuredTemporaryRoots(pathApi) {
  const values = [os.tmpdir()]
  if (pathApi === path.win32) {
    values.push(process.env.TEMP, process.env.TMP)
    if (process.env.SystemRoot) values.push(pathApi.join(process.env.SystemRoot, 'Temp'))
  } else {
    values.push('/tmp', '/var/tmp', '/private/tmp')
  }
  return [...new Set(values.filter((value) => typeof value === 'string' && pathApi.isAbsolute(value)).map((value) => pathApi.resolve(value)))]
}

export function deriveHostingerDataDir(deploymentRoot, { pathApi = path.posix } = {}) {
  if (typeof deploymentRoot !== 'string' || !pathApi.isAbsolute(deploymentRoot)) return null
  const normalized = pathApi.resolve(deploymentRoot)
  const parsed = pathApi.parse(normalized)
  const segments = rawPathSegments(normalized, pathApi)
  const normalizedSegments = segments.map((part) => part.toLowerCase())
  if (segments.length < 5 || normalizedSegments[0] !== 'home' || normalizedSegments[2] !== 'domains' || normalizedSegments[4] !== 'nodejs') return null
  return pathApi.join(parsed.root, ...segments.slice(0, 4), 'bsdi-data')
}

export function validatePersistentDataPath({
  configuredPath,
  deploymentRoot,
  temporaryRoots,
  pathApi = path,
}) {
  if (typeof configuredPath !== 'string' || !configuredPath.trim() || !pathApi.isAbsolute(configuredPath.trim())) {
    throw new Error('Production presentation storage requires an absolute BSDI_DATA_DIR.')
  }
  const candidate = pathApi.resolve(configuredPath.trim())
  if (candidate === pathApi.parse(candidate).root) {
    throw new Error('Production presentation storage requires a dedicated directory.')
  }
  if (typeof deploymentRoot === 'string' && deploymentRoot && isWithin(deploymentRoot, candidate, pathApi)) {
    throw new Error('Production presentation storage must be outside the deployment directory.')
  }
  if (typeof deploymentRoot === 'string' && deploymentRoot && isWithin(candidate, deploymentRoot, pathApi)) {
    throw new Error('Production presentation storage must use a dedicated directory outside the deployment tree.')
  }
  const tempDirectories = temporaryRoots === undefined ? configuredTemporaryRoots(pathApi) : temporaryRoots
  if (tempDirectories.some((temporaryRoot) =>
    typeof temporaryRoot === 'string' && pathApi.isAbsolute(temporaryRoot) && isWithin(temporaryRoot, candidate, pathApi))) {
    throw new Error('Production presentation storage cannot use an operating-system temporary directory.')
  }
  const managedSegment = pathSegments(candidate, pathApi).find((segment) => managedDirectoryNames.has(segment))
  if (managedSegment) {
    throw new Error(`Production presentation storage cannot be inside ${managedSegment}.`)
  }
  return candidate
}

async function prepareCandidate({ configuredPath, deploymentRoot, temporaryRoots, pathApi, fileSystem }) {
  const candidate = validatePersistentDataPath({ configuredPath, deploymentRoot, temporaryRoots, pathApi })
  try {
    await fileSystem.mkdir(candidate, { recursive: true, mode: 0o700 })
    const info = await fileSystem.lstat(candidate)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Production presentation storage must use a dedicated real directory.')
    }
    const realCandidate = await fileSystem.realpath(candidate)
    const realDeploymentRoot = deploymentRoot
      ? await fileSystem.realpath(deploymentRoot)
      : deploymentRoot
    // Hostinger may canonicalize an ancestor of the domain directory. The
    // requested data directory itself is already proven not to be a symlink;
    // validate both canonical paths to preserve the deployment boundary.
    validatePersistentDataPath({
      configuredPath: realCandidate,
      deploymentRoot: realDeploymentRoot,
      temporaryRoots,
      pathApi,
    })
    await fileSystem.access(realCandidate, fsConstants.W_OK)
    const probePath = pathApi.join(realCandidate, `.bsdi-write-probe-${randomUUID()}`)
    let handle
    try {
      handle = await fileSystem.open(probePath, 'wx', 0o600)
      await handle.writeFile('storage-ready\n', 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
    } finally {
      if (handle) await handle.close().catch(() => {})
      await fileSystem.unlink(probePath).catch(() => {})
    }
    return realCandidate
  } catch (error) {
    if (/^Production presentation storage/.test(error.message || '')) throw error
    throw new Error('Production presentation storage directory is not writable.', { cause: error })
  }
}

export async function prepareProductionDataDir({
  configuredPath,
  deploymentRoot,
  temporaryRoots,
  pathApi = path,
  fileSystem = fs,
}) {
  const hostingerPath = deriveHostingerDataDir(deploymentRoot, { pathApi })
  if (hostingerPath) {
    const dataDir = await prepareCandidate({
      configuredPath: hostingerPath,
      deploymentRoot,
      temporaryRoots,
      pathApi,
      fileSystem,
    })
    const configured = typeof configuredPath === 'string' && configuredPath.trim()
      ? pathApi.resolve(configuredPath.trim())
      : null
    return {
      dataDir,
      source: 'hostinger',
      replacedUnsafeConfiguration: Boolean(configured && !samePath(configured, hostingerPath, pathApi)),
    }
  }
  const dataDir = await prepareCandidate({
    configuredPath,
    deploymentRoot,
    temporaryRoots,
    pathApi,
    fileSystem,
  })
  return { dataDir, source: 'configured', replacedUnsafeConfiguration: false }
}
