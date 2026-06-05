import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

const DATABASE_MEDIA_PREFIX = '/database/media/'
const GIT_LFS_POINTER = 'version https://git-lfs.github.com/spec/v1'

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zip) => {
      if (error) reject(error)
      else resolve(zip)
    })
  })
}

function normalizeUrlPath(value) {
  return String(value || '').replace(/\\/g, '/')
}

function mediaLookupKeys(fileName) {
  const baseName = path.basename(String(fileName || '')).toLowerCase()
  const stem = baseName.replace(/\.[^.]+$/, '')
  return [baseName, stem].filter(Boolean)
}

function safeResolve(root, relativePath) {
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(resolvedRoot, relativePath)
  return resolvedPath.startsWith(resolvedRoot) ? resolvedPath : ''
}

async function isGitLfsPointer(filePath) {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size > 512) return false
    const text = await fs.readFile(filePath, 'utf8')
    return text.startsWith(GIT_LFS_POINTER)
  } catch {
    return false
  }
}

async function isUsableMediaFile(filePath, expectedSize = 0) {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size <= 0) return false
    if (await isGitLfsPointer(filePath)) return false
    if (expectedSize && stat.size < Math.min(expectedSize, 1024)) return false
    return true
  } catch {
    return false
  }
}

function collectMediaRecords(data) {
  const fromProjects = (Array.isArray(data?.projects) ? data.projects : [])
    .flatMap((project) => Array.isArray(project.media) ? project.media : [])
  const fromTopLevel = Array.isArray(data?.media) ? data.media : []
  const recordsBySrc = new Map()

  for (const item of [...fromProjects, ...fromTopLevel]) {
    const src = normalizeUrlPath(item?.src)
    if (!src.startsWith(DATABASE_MEDIA_PREFIX)) continue
    recordsBySrc.set(src, item)
  }

  return recordsBySrc
}

async function zipMediaIndex(templatePath) {
  const zip = await openZip(templatePath)
  const entries = new Map()
  try {
    await new Promise((resolve, reject) => {
      zip.readEntry()
      zip.on('entry', (entry) => {
        if (entry.fileName.startsWith('ppt/media/')) {
          const fileName = path.basename(entry.fileName).toLowerCase()
          const record = {
            fileName: entry.fileName,
            size: entry.uncompressedSize,
          }
          for (const key of mediaLookupKeys(fileName)) {
            if (!entries.has(key)) entries.set(key, record)
          }
        }
        zip.readEntry()
      })
      zip.on('end', resolve)
      zip.on('error', reject)
    })
  } finally {
    zip.close()
  }
  return entries
}

async function copyZipEntry(templatePath, entryName, destination) {
  const zip = await openZip(templatePath)
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const tempPath = `${destination}.${Date.now()}.tmp`
    await new Promise((resolve, reject) => {
      zip.readEntry()
      zip.on('entry', (entry) => {
        if (entry.fileName !== entryName) {
          zip.readEntry()
          return
        }

        zip.openReadStream(entry, async (error, stream) => {
          if (error) {
            reject(error)
            return
          }
          try {
            await pipeline(stream, fsSync.createWriteStream(tempPath))
            await fs.rename(tempPath, destination)
            resolve()
          } catch (copyError) {
            reject(copyError)
          }
        })
      })
      zip.on('end', () => reject(new Error(`PowerPoint media entry not found: ${entryName}`)))
      zip.on('error', reject)
    })
  } finally {
    zip.close()
  }
}

function mediaDestinationForSrc(databaseMediaDir, src) {
  const normalized = normalizeUrlPath(src)
  if (!normalized.startsWith(DATABASE_MEDIA_PREFIX)) return ''
  const relative = decodeURIComponent(normalized.slice(DATABASE_MEDIA_PREFIX.length))
  return safeResolve(databaseMediaDir, relative)
}

function mediaEntryForRecord(record, mediaIndex) {
  const originalName = String(record?.originalName || record?.name || '').trim()
  if (!originalName) return null
  return mediaLookupKeys(originalName)
    .map((key) => mediaIndex.get(key))
    .find(Boolean)
}

async function restoreMediaRecord({
  record,
  destination,
  templatePath,
  mediaIndex,
}) {
  const entry = mediaEntryForRecord(record, mediaIndex)
  if (!entry) return false
  await copyZipEntry(templatePath, entry.fileName, destination)
  return true
}

async function copyNeededZipEntries(templatePath, neededByEntry) {
  if (!neededByEntry.size) return

  const zip = await openZip(templatePath)
  try {
    await new Promise((resolve, reject) => {
      zip.readEntry()
      zip.on('entry', (entry) => {
        const destinations = neededByEntry.get(entry.fileName)
        if (!destinations?.length) {
          zip.readEntry()
          return
        }

        zip.openReadStream(entry, async (error, stream) => {
          if (error) {
            reject(error)
            return
          }

          try {
            const [primary, ...duplicates] = destinations
            await fs.mkdir(path.dirname(primary), { recursive: true })
            const tempPath = `${primary}.${Date.now()}.tmp`
            await pipeline(stream, fsSync.createWriteStream(tempPath))
            await fs.rename(tempPath, primary)

            for (const duplicate of duplicates) {
              await fs.mkdir(path.dirname(duplicate), { recursive: true })
              await fs.copyFile(primary, duplicate)
            }
            zip.readEntry()
          } catch (copyError) {
            reject(copyError)
          }
        })
      })
      zip.on('end', resolve)
      zip.on('error', reject)
    })
  } finally {
    zip.close()
  }
}

export function databaseMediaDirectory(dataDir) {
  return path.join(dataDir, 'database', 'media')
}

export async function restoreMissingDatabaseMedia({
  data,
  templatePath,
  dataDir,
  logger = console,
}) {
  if (!templatePath || !fsSync.existsSync(templatePath)) return { restored: 0, skipped: 0, missing: 0 }

  const databaseMediaDir = databaseMediaDirectory(dataDir)
  const recordsBySrc = collectMediaRecords(data)
  if (!recordsBySrc.size) return { restored: 0, skipped: 0, missing: 0 }

  const mediaIndex = await zipMediaIndex(templatePath)
  const neededByEntry = new Map()
  let restored = 0
  let skipped = 0
  let missing = 0

  for (const [src, record] of recordsBySrc.entries()) {
    const destination = mediaDestinationForSrc(databaseMediaDir, src)
    if (!destination) {
      missing += 1
      continue
    }
    if (await isUsableMediaFile(destination, Number(record?.size) || 0)) {
      skipped += 1
      continue
    }

    const entry = mediaEntryForRecord(record, mediaIndex)
    if (!entry) {
      missing += 1
      continue
    }
    if (!neededByEntry.has(entry.fileName)) neededByEntry.set(entry.fileName, [])
    neededByEntry.get(entry.fileName).push(destination)
    restored += 1
  }

  try {
    await copyNeededZipEntries(templatePath, neededByEntry)
  } catch (error) {
    logger.warn?.(`Database media restore stopped: ${error.message}`)
    throw error
  }

  return { restored, skipped, missing }
}

export async function restoreSingleDatabaseMedia({
  src,
  data,
  templatePath,
  dataDir,
}) {
  const databaseMediaDir = databaseMediaDirectory(dataDir)
  const destination = mediaDestinationForSrc(databaseMediaDir, src)
  if (!destination) return ''
  const recordsBySrc = collectMediaRecords(data)
  const record = recordsBySrc.get(normalizeUrlPath(src))
  if (!record || !templatePath || !fsSync.existsSync(templatePath)) return ''

  if (await isUsableMediaFile(destination, Number(record?.size) || 0)) return destination

  const mediaIndex = await zipMediaIndex(templatePath)
  const restored = await restoreMediaRecord({
    record,
    destination,
    templatePath,
    mediaIndex,
  })
  return restored && await isUsableMediaFile(destination, Number(record?.size) || 0) ? destination : ''
}

export async function firstUsableMediaPath(paths, expectedSize = 0) {
  for (const filePath of paths) {
    if (filePath && await isUsableMediaFile(filePath, expectedSize)) return filePath
  }
  return ''
}
