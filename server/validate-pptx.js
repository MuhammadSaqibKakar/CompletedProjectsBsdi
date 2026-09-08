/* eslint no-control-regex: "off" */
// ZIP entry names must not contain control characters.
import yauzl from 'yauzl'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
const MAX_XML_BYTES = 8 * 1024 * 1024
const MAX_ENTRIES = 12000
const parser = new XMLParser({ ignoreAttributes: false, processEntities: false })
const fail = (message) => Object.assign(new Error(message), { status: 400 })
const WEBSITE_TEXT_PART = /^ppt\/(?:slides\/slide\d+|slideLayouts\/slideLayout\d+|slideMasters\/slideMaster\d+)\.xml$/i
const TAB_ALIGNED_TEXT = /<a:t\b[^>]*>[\s\S]*?(?:\t|&#(?:0*9|x0*9);)[\s\S]*?<\/a:t>/i

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error)
      const chunks = []
      let size = 0
      stream.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_XML_BYTES) stream.destroy(fail('A presentation component is too large.'))
        else chunks.push(chunk)
      })
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
  })
}

export async function validatePptx(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(fail('This file is not a valid PowerPoint .pptx presentation.'))
      let total = 0
      let entries = 0
      let slideCount = 0
      let hasMainType = false
      let hasPresentation = false
      let presentationIds = 0
      let done = false
      const seen = new Set()
      function stop(reason) {
        if (done) return
        done = true
        zip.close()
        reject(reason.status ? reason : fail('The presentation is damaged or cannot be read safely.'))
      }
      zip.on('error', stop)
      zip.on('entry', async (entry) => {
        try {
          const name = entry.fileName
          if (++entries > MAX_ENTRIES || (total += entry.uncompressedSize) > MAX_EXPANDED_BYTES ||
              entry.uncompressedSize > MAX_UPLOAD_BYTES || entry.isEncrypted()) {
            throw fail('The presentation is encrypted or exceeds the allowed size limits.')
          }
          if (seen.has(name.toLowerCase()) || name.startsWith('/') || name.split('/').includes('..') ||
              /[\x00-\x1f\\]/.test(name)) throw fail('The presentation contains unsafe file paths.')
          seen.add(name.toLowerCase())
          if (/vbaProject|\/activeX\/|\/embeddings\/|\.html?$|\.js$|\.exe$|\.dll$/i.test(name)) {
            throw fail('Presentations with macros, embedded programs, or embedded documents are not supported.')
          }
          if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) slideCount += 1
          if (slideCount > 500) throw fail('A presentation can contain at most 500 slides.')
          if (/\.(xml|rels|svg)$/i.test(name)) {
            if (entry.uncompressedSize > MAX_XML_BYTES) throw fail('A presentation component is too large.')
            const text = await readEntry(zip, entry)
            if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) {
              throw fail('The presentation contains invalid or unsupported XML.')
            }
            if (WEBSITE_TEXT_PART.test(name) && TAB_ALIGNED_TEXT.test(text)) {
              throw fail('This presentation uses tab-aligned text that cannot render safely on the website. Replace tabs with fixed text columns or a table before uploading.')
            }
            if (/\.svg$/i.test(name) && /<\s*(?:script|foreignObject)|\son\w+\s*=|javascript\s*:|(?:href\s*=\s*["'](?:https?:|\/\/|data:text\/html))/i.test(text)) {
              throw fail('The presentation contains unsupported active image content.')
            }
            if (/\.rels$/i.test(name)) {
              const rels = parser.parse(text)?.Relationships?.Relationship || []
              for (const rel of Array.isArray(rels) ? rels : [rels]) {
                if (String(rel['@_TargetMode']).toLowerCase() === 'external') {
                  throw fail('Use a self-contained presentation. Remove external links or linked files before uploading.')
                }
              }
            }
            if (name === '[Content_Types].xml') {
              hasMainType = text.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')
              if (/macroEnabled|vbaProject|activeX|oleObject/i.test(text)) throw fail('Active content is not supported.')
            }
            if (name === 'ppt/presentation.xml') {
              hasPresentation = true
              const parsed = parser.parse(text)
              const ids = parsed?.['p:presentation']?.['p:sldIdLst']?.['p:sldId']
              presentationIds = ids ? (Array.isArray(ids) ? ids.length : 1) : 0
            }
          }
          if (!done) zip.readEntry()
        } catch (reason) { stop(reason) }
      })
      zip.on('end', () => {
        if (done) return
        done = true
        if (!hasMainType || !hasPresentation || !slideCount || presentationIds !== slideCount) {
          reject(fail('The file must be a valid .pptx presentation with at least one slide.'))
        } else resolve({ slideCount })
      })
      zip.readEntry()
    })
  })
}
