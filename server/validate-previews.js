/* eslint no-control-regex: "off" */
import fs from 'node:fs/promises'
import path from 'node:path'
import yauzl from 'yauzl'

export const MAX_PREVIEW_ARCHIVE_BYTES = 200 * 1024 * 1024
const MAX_PREVIEW_EXPANDED_BYTES = 512 * 1024 * 1024
const MAX_PREVIEW_IMAGE_BYTES = 16 * 1024 * 1024
const MAX_PREVIEW_ENTRIES = 502
const MAX_MANIFEST_BYTES = 8 * 1024
const MAX_PREVIEW_PIXELS = 40_000_000
const MAX_DIMENSION = 8192
const MIN_DIMENSION = 240
const fail = (message) => Object.assign(new Error(message), { status: 400 })

function isZipSymlink(entry) {
  return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
}

function readEntry(zip, entry, limit) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error)
      const chunks = []
      let size = 0
      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) stream.destroy(fail('A slide preview is too large.'))
        else chunks.push(chunk)
      })
      stream.on('error', reject)
      stream.on('end', () => {
        if (size !== entry.uncompressedSize) return reject(fail('A slide preview is incomplete.'))
        resolve(Buffer.concat(chunks))
      })
    })
  })
}

function jpegDimensions(buffer) {
  if (buffer.length < 12 || buffer[0] !== 0xff || buffer[1] !== 0xd8 ||
      buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
    throw fail('Every slide preview must be a valid JPEG image.')
  }
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset < buffer.length - 1) {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) break
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) throw fail('A slide preview JPEG is damaged.')
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) throw fail('A slide preview JPEG is damaged.')
    if (sofMarkers.has(marker)) {
      if (length < 7) throw fail('A slide preview JPEG is damaged.')
      const height = buffer.readUInt16BE(offset + 3)
      const width = buffer.readUInt16BE(offset + 5)
      if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION ||
          width < MIN_DIMENSION || height < MIN_DIMENSION || width * height > MAX_PREVIEW_PIXELS) {
        throw fail('A slide preview has unsupported dimensions.')
      }
      return { width, height }
    }
    offset += length
  }
  throw fail('A slide preview JPEG is missing image dimensions.')
}

function validateManifest(buffer, expectedSlideCount, images) {
  let manifest
  try {
    manifest = JSON.parse(buffer.toString('utf8'))
  } catch {
    throw fail('The slide preview manifest is invalid.')
  }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') {
    throw fail('The slide preview manifest is invalid.')
  }
  const keys = Object.keys(manifest).sort()
  if (keys.join(',') !== 'format,height,slideCount,version,width') {
    throw fail('The slide preview manifest contains unsupported fields.')
  }
  if (manifest.version !== 1 || manifest.format !== 'jpg' ||
      !Number.isSafeInteger(manifest.slideCount) || manifest.slideCount !== expectedSlideCount ||
      !Number.isSafeInteger(manifest.width) || !Number.isSafeInteger(manifest.height) ||
      manifest.width < MIN_DIMENSION || manifest.height < MIN_DIMENSION ||
      manifest.width > MAX_DIMENSION || manifest.height > MAX_DIMENSION ||
      manifest.width * manifest.height > MAX_PREVIEW_PIXELS) {
    throw fail('The slide preview manifest does not match the PowerPoint file.')
  }
  if (images.size !== expectedSlideCount) throw fail('Provide one preview image for every slide.')
  for (let number = 1; number <= expectedSlideCount; number += 1) {
    const image = images.get(number)
    if (!image || image.width !== manifest.width || image.height !== manifest.height) {
      throw fail('All slide previews must use the dimensions declared in the manifest.')
    }
  }
  return Object.freeze({
    version: 1,
    slideCount: manifest.slideCount,
    width: manifest.width,
    height: manifest.height,
    format: 'jpg',
  })
}

export async function validateAndExtractPreviewZip(zipPath, { expectedSlideCount, outputDir }) {
  if (!Number.isSafeInteger(expectedSlideCount) || expectedSlideCount < 1 || expectedSlideCount > 500 ||
      !path.isAbsolute(outputDir)) throw fail('The slide preview request is invalid.')
  const archiveStat = await fs.lstat(zipPath).catch(() => null)
  if (!archiveStat?.isFile() || archiveStat.isSymbolicLink() || archiveStat.size < 1 ||
      archiveStat.size > MAX_PREVIEW_ARCHIVE_BYTES) throw fail('Choose a valid slide preview ZIP file.')

  await fs.mkdir(outputDir, { recursive: false, mode: 0o700 })
  const slidesDir = path.join(outputDir, 'slides')
  await fs.mkdir(slidesDir, { recursive: false, mode: 0o700 })
  try {
    const result = await new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (openError, zip) => {
        if (openError) return reject(fail('The slide preview ZIP file is invalid.'))
        let finished = false
        let total = 0
        let entryCount = 0
        let manifestBuffer = null
        const images = new Map()
        const seen = new Set()

        function stop(reason) {
          if (finished) return
          finished = true
          zip.close()
          reject(reason?.status ? reason : fail('The slide preview ZIP file is damaged.'))
        }

        zip.on('error', stop)
        zip.on('entry', (entry) => {
          ;(async () => {
            const name = entry.fileName
            const lower = name.toLowerCase()
            entryCount += 1
            total += entry.uncompressedSize
            if (entryCount > MAX_PREVIEW_ENTRIES || total > MAX_PREVIEW_EXPANDED_BYTES ||
                entry.isEncrypted() || isZipSymlink(entry)) {
              throw fail('The slide preview ZIP exceeds the allowed safety limits.')
            }
            if (seen.has(lower) || name.startsWith('/') || name.split('/').includes('..') ||
                /[\x00-\x1f\\]/.test(name)) throw fail('The slide preview ZIP contains unsafe paths.')
            seen.add(lower)

            if (name === 'slides/') {
              if (entry.uncompressedSize !== 0) throw fail('The slide preview ZIP is invalid.')
            } else if (name === 'manifest.json') {
              if (manifestBuffer || entry.uncompressedSize > MAX_MANIFEST_BYTES) {
                throw fail('The slide preview manifest is invalid.')
              }
              manifestBuffer = await readEntry(zip, entry, MAX_MANIFEST_BYTES)
            } else {
              const match = /^slides\/slide-(\d{4})\.jpg$/.exec(name)
              if (!match || entry.uncompressedSize < 1 || entry.uncompressedSize > MAX_PREVIEW_IMAGE_BYTES) {
                throw fail('The slide preview ZIP contains unsupported files.')
              }
              const number = Number(match[1])
              if (number < 1 || number > expectedSlideCount ||
                  name !== `slides/slide-${String(number).padStart(4, '0')}.jpg` || images.has(number)) {
                throw fail('The slide preview filenames do not match the PowerPoint slides.')
              }
              const bytes = await readEntry(zip, entry, MAX_PREVIEW_IMAGE_BYTES)
              const dimensions = jpegDimensions(bytes)
              await fs.writeFile(path.join(slidesDir, path.basename(name)), bytes, { flag: 'wx', mode: 0o600 })
              images.set(number, dimensions)
            }
            if (!finished) zip.readEntry()
          })().catch(stop)
        })
        zip.on('end', () => {
          if (finished) return
          try {
            if (!manifestBuffer) throw fail('The slide preview manifest is missing.')
            const manifest = validateManifest(manifestBuffer, expectedSlideCount, images)
            finished = true
            resolve(manifest)
          } catch (error) {
            stop(error)
          }
        })
        zip.readEntry()
      })
    })
    await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(result)}\n`, { flag: 'wx', mode: 0o600 })
    return result
  } catch (error) {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
