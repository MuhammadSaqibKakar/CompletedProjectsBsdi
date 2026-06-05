import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'

const TEMPLATE_SLIDE = 'ppt/slides/slide6.xml'
const TEMPLATE_SLIDE_RELS = 'ppt/slides/_rels/slide6.xml.rels'
const PRESENTATION_XML = 'ppt/presentation.xml'
const PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels'
const CONTENT_TYPES = '[Content_Types].xml'
const REPORT_FILE = 'BSDI Completed Projects - current.pptx'
const META_FILE = 'BSDI Completed Projects - current.pptx.json'
const SLIDE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, zip) => {
      if (error) reject(error)
      else resolve(zip)
    })
  })
}

async function readZipEntryText(filePath, entryName) {
  const zip = await openZip(filePath)
  try {
    return await new Promise((resolve, reject) => {
      zip.readEntry()
      zip.on('entry', (entry) => {
        if (entry.fileName !== entryName) {
          zip.readEntry()
          return
        }

        zip.openReadStream(entry, (error, stream) => {
          if (error) {
            reject(error)
            return
          }

          let text = ''
          stream.setEncoding('utf8')
          stream.on('data', (chunk) => {
            text += chunk
          })
          stream.on('end', () => resolve(text))
          stream.on('error', reject)
        })
      })
      zip.on('end', () => reject(new Error(`PowerPoint entry not found: ${entryName}`)))
      zip.on('error', reject)
    })
  } finally {
    zip.close()
  }
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function isWebsiteCreatedProject(project) {
  return Boolean(project?.title) && !project.legacyId && !project.sourceSheet && !project.sourceRow
}

function projectFingerprint(project) {
  return normalizeValue([
    project?.phase,
    project?.division,
    project?.district,
    project?.title,
    project?.cost,
  ].filter(Boolean).join(' | '))
}

function collectGeneratedProjects(data) {
  return (Array.isArray(data?.projects) ? data.projects : [])
    .filter(isWebsiteCreatedProject)
    .map((project, index) => ({
      ...project,
      _templateSerial: index + 1,
      _templateFingerprint: projectFingerprint(project),
    }))
    .filter((project) => project._templateFingerprint)
}

function textRuns(xml) {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => ({
    raw: match[1],
    text: match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>'),
  }))
}

function firstValueAfter(runs, label) {
  const normalizedLabel = normalizeValue(label)
  const index = runs.findIndex((run) => normalizeValue(run.text) === normalizedLabel)
  if (index === -1) return -1
  for (let runIndex = index + 1; runIndex < runs.length; runIndex += 1) {
    if (String(runs[runIndex].text || '').trim()) return runIndex
  }
  return -1
}

function replaceFieldRangeAfterLabel(runs, replacements, label, value, stopLabels = []) {
  const normalizedLabel = normalizeValue(label)
  const normalizedStops = stopLabels.map((stop) => normalizeValue(stop))
  const labelIndex = runs.findIndex((run) => normalizeValue(run.text) === normalizedLabel)
  if (labelIndex === -1) return

  let firstValueIndex = -1
  for (let runIndex = labelIndex + 1; runIndex < runs.length; runIndex += 1) {
    const normalizedText = normalizeValue(runs[runIndex].text)
    if (normalizedStops.includes(normalizedText)) break
    if (String(runs[runIndex].text || '').trim()) {
      firstValueIndex = runIndex
      break
    }
  }
  if (firstValueIndex === -1) return

  replacements.set(firstValueIndex, value)
  for (let runIndex = firstValueIndex + 1; runIndex < runs.length; runIndex += 1) {
    const normalizedText = normalizeValue(runs[runIndex].text)
    if (normalizedStops.includes(normalizedText)) break
    if (String(runs[runIndex].text || '').trim()) replacements.set(runIndex, '')
  }
}

function replaceSlideText(xml, project) {
  const runs = textRuns(xml)
  const replacements = new Map()
  const titleIndex = runs.findIndex((run) => normalizeValue(run.text) === 'wss zamdan goth')
  if (titleIndex !== -1) replacements.set(titleIndex, String(project.title || 'BSDI Project').toUpperCase())

  const singleRunFieldValues = [
    ['Cost (PC-1)', project.cost || '-'],
    ['Duration', project.duration || '-'],
    ['NIT (Opening Date)', project.nitDate || project.techBid || '-'],
    ['Work O', project.workOrder || '-'],
    ['Progress', project.progress || '100%'],
  ]

  for (const [label, value] of singleRunFieldValues) {
    const valueIndex = firstValueAfter(runs, label)
    if (valueIndex !== -1) replacements.set(valueIndex, value)
  }

  replaceFieldRangeAfterLabel(runs, replacements, 'Contr', project.contractor || '-', ['Work O'])
  replaceFieldRangeAfterLabel(runs, replacements, 'XEN', project.xen || '-', ['Loc on Map'])

  // The original slide has the focal-officer label split across two runs:
  // "Focal " and "Offr". Replace the next value after "Offr".
  const focalIndex = firstValueAfter(runs, 'Offr')
  if (focalIndex !== -1) replacements.set(focalIndex, project.focalOfficer || '-')

  let index = 0
  return xml.replace(/<a:t>[\s\S]*?<\/a:t>/g, (match) => {
    if (!replacements.has(index)) {
      index += 1
      return match
    }
    const value = replacements.get(index)
    index += 1
    return `<a:t>${escapeXml(value)}</a:t>`
  })
}

function maxNumber(regex, text) {
  let max = 0
  for (const match of text.matchAll(regex)) {
    max = Math.max(max, Number(match[1]) || 0)
  }
  return max
}

function addSlideOverride(contentTypesXml, slidePath) {
  const partName = `/${slidePath}`
  if (contentTypesXml.includes(`PartName="${partName}"`)) return contentTypesXml
  const override = `<Override PartName="${partName}" ContentType="${SLIDE_CONTENT_TYPE}"/>`
  return contentTypesXml.replace('</Types>', `${override}</Types>`)
}

function addPresentationRelationship(relsXml, relId, slidePath) {
  const relationship = `<Relationship Id="${relId}" Type="${SLIDE_REL_TYPE}" Target="${slidePath.replace(/^ppt\//, '')}"/>`
  return relsXml.replace('</Relationships>', `${relationship}</Relationships>`)
}

function addPresentationSlideId(presentationXml, slideId, relId) {
  const slide = `<p:sldId id="${slideId}" r:id="${relId}"/>`
  return presentationXml.replace('</p:sldIdLst>', `${slide}</p:sldIdLst>`)
}

function resolveMediaPath(src, mediaDir) {
  if (!src) return ''
  const normalized = String(src).replace(/\\/g, '/')
  const marker = '/synced-media/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex === -1 && !normalized.startsWith('synced-media/')) return ''
  const relative = normalized.startsWith('synced-media/')
    ? normalized.slice('synced-media/'.length)
    : normalized.slice(markerIndex + marker.length)
  const filePath = path.resolve(mediaDir, decodeURIComponent(relative))
  const mediaRoot = path.resolve(mediaDir)
  return filePath.startsWith(mediaRoot) ? filePath : ''
}

function collectProjectImages(project, mediaDir) {
  return (Array.isArray(project.media) ? project.media : [])
    .filter((item) => item?.type !== 'video')
    .map((item) => resolveMediaPath(item.src, mediaDir))
    .filter((filePath) => filePath && fsSync.existsSync(filePath))
    .slice(0, 2)
}

function rewriteSlideRels(relsXml, project, slideNumber, images) {
  let imageIndex = 0
  let rewritten = relsXml.replace(/<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"[^>]*\/>/g, (match) => {
    const imagePath = images[imageIndex]
    if (!imagePath) return match
    imageIndex += 1
    const extension = path.extname(imagePath).toLowerCase() || '.jpg'
    const target = `../media/bsdi-generated-${slideNumber}-${imageIndex}${extension}`
    return match.replace(/Target="[^"]*"/, `Target="${target}"`)
  })

  const target = `Districts/${encodeURIComponent(project.district || 'Unassigned')}/${encodeURIComponent(project.title || 'BSDI Project')}`
  rewritten = rewritten.replace(/<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/hyperlink"[^>]*\/>/, (match) => (
    match.replace(/Target="[^"]*"/, `Target="${target}"`).replace(/TargetMode="[^"]*"/, 'TargetMode="External"')
  ))

  return rewritten
}

function outputPaths(reportsDir) {
  return {
    reportPath: path.join(reportsDir, REPORT_FILE),
    metaPath: path.join(reportsDir, META_FILE),
  }
}

async function copyZipWithGeneratedSlides({
  templatePath,
  outputPath,
  modifiedEntries,
  newEntries,
}) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const tempPath = `${outputPath}.${Date.now()}.tmp`
  const sourceZip = await openZip(templatePath)
  const targetZip = new yazl.ZipFile()
  const output = fsSync.createWriteStream(tempPath)
  const done = pipeline(targetZip.outputStream, output)

  await new Promise((resolve, reject) => {
    sourceZip.on('error', reject)
    output.on('error', reject)
    sourceZip.readEntry()
    sourceZip.on('entry', (entry) => {
      if (modifiedEntries.has(entry.fileName)) {
        targetZip.addBuffer(Buffer.from(modifiedEntries.get(entry.fileName)), entry.fileName)
        sourceZip.readEntry()
        return
      }

      sourceZip.openReadStream(entry, (error, stream) => {
        if (error) {
          reject(error)
          return
        }
        targetZip.addReadStream(stream, entry.fileName, { compress: false })
        stream.on('end', () => sourceZip.readEntry())
        stream.on('error', reject)
      })
    })
    sourceZip.on('end', () => {
      for (const entry of newEntries) {
        if (entry.buffer) {
          targetZip.addBuffer(entry.buffer, entry.name)
        } else {
          targetZip.addFile(entry.filePath, entry.name, { compress: false })
        }
      }
      targetZip.end()
      resolve()
    })
  }).finally(() => {
    sourceZip.close()
  })

  await done
  await fs.rename(tempPath, outputPath)
}

async function removeGeneratedReport(reportsDir) {
  const { reportPath, metaPath } = outputPaths(reportsDir)
  await Promise.all([
    fs.rm(reportPath, { force: true }),
    fs.rm(metaPath, { force: true }),
  ])
}

export async function generateTemplatePptReport({
  data,
  templatePath,
  reportsDir,
  mediaDir,
  force = false,
}) {
  const projects = collectGeneratedProjects(data)
  const { reportPath, metaPath } = outputPaths(reportsDir)
  const templateStat = await fs.stat(templatePath)
  const fingerprint = [
    templatePath,
    templateStat.mtimeMs,
    data?._serverRevision || data?.updatedAt || data?.generatedAt || '',
    projects.map((project) => project._templateFingerprint).join('||'),
  ].join('::')

  if (!projects.length) {
    await removeGeneratedReport(reportsDir)
    return {
      ready: true,
      generated: false,
      reportPath: templatePath,
      projectCount: 0,
    }
  }

  if (!force && fsSync.existsSync(reportPath) && fsSync.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'))
      if (meta.fingerprint === fingerprint) {
        return {
          ready: true,
          generated: true,
          reportPath,
          projectCount: projects.length,
          readyAt: meta.generatedAt,
        }
      }
    } catch {
      // Rebuild below if metadata is unreadable.
    }
  }

  let presentationXml = await readZipEntryText(templatePath, PRESENTATION_XML)
  let presentationRels = await readZipEntryText(templatePath, PRESENTATION_RELS)
  let contentTypesXml = await readZipEntryText(templatePath, CONTENT_TYPES)
  const templateSlideXml = await readZipEntryText(templatePath, TEMPLATE_SLIDE)
  const templateSlideRels = await readZipEntryText(templatePath, TEMPLATE_SLIDE_RELS)

  const existingSlideNumbers = [
    ...presentationRels.matchAll(/Target="slides\/slide(\d+)\.xml"/g),
  ].map((match) => Number(match[1]) || 0)
  let nextSlideNumber = Math.max(...existingSlideNumbers, 0) + 1
  let nextRelNumber = maxNumber(/Id="rId(\d+)"/g, presentationRels) + 1
  let nextSlideId = maxNumber(/<p:sldId[^>]+id="(\d+)"/g, presentationXml) + 1
  const modifiedEntries = new Map()
  const newEntries = []

  for (const project of projects) {
    const slideNumber = nextSlideNumber
    const relId = `rId${nextRelNumber}`
    const slidePath = `ppt/slides/slide${slideNumber}.xml`
    const slideRelsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`
    const images = collectProjectImages(project, mediaDir)
    const slideXml = replaceSlideText(templateSlideXml, project)
    const slideRels = rewriteSlideRels(templateSlideRels, project, slideNumber, images)

    newEntries.push({ name: slidePath, buffer: Buffer.from(slideXml) })
    newEntries.push({ name: slideRelsPath, buffer: Buffer.from(slideRels) })
    images.forEach((imagePath, index) => {
      const extension = path.extname(imagePath).toLowerCase() || '.jpg'
      newEntries.push({
        name: `ppt/media/bsdi-generated-${slideNumber}-${index + 1}${extension}`,
        filePath: imagePath,
      })
    })

    contentTypesXml = addSlideOverride(contentTypesXml, slidePath)
    presentationRels = addPresentationRelationship(presentationRels, relId, slidePath)
    presentationXml = addPresentationSlideId(presentationXml, nextSlideId, relId)

    nextSlideNumber += 1
    nextRelNumber += 1
    nextSlideId += 1
  }

  modifiedEntries.set(PRESENTATION_XML, presentationXml)
  modifiedEntries.set(PRESENTATION_RELS, presentationRels)
  modifiedEntries.set(CONTENT_TYPES, contentTypesXml)

  await copyZipWithGeneratedSlides({
    templatePath,
    outputPath: reportPath,
    modifiedEntries,
    newEntries,
  })

  const generatedAt = new Date().toISOString()
  await fs.writeFile(metaPath, JSON.stringify({
    fingerprint,
    generatedAt,
    templatePath,
    templateMtime: templateStat.mtime.toISOString(),
    projectCount: projects.length,
    projectIds: projects.map((project) => project.id),
  }, null, 2))

  return {
    ready: true,
    generated: true,
    reportPath,
    readyAt: generatedAt,
    projectCount: projects.length,
  }
}

export async function getTemplatePptStatus({ data, templatePath, reportsDir }) {
  const projects = collectGeneratedProjects(data)
  const { reportPath, metaPath } = outputPaths(reportsDir)
  const templateStat = await fs.stat(templatePath)

  if (!projects.length || !fsSync.existsSync(reportPath)) {
    return {
      ready: true,
      generated: false,
      reportPath: templatePath,
      readyAt: templateStat.mtime.toISOString(),
      size: templateStat.size,
      projectCount: projects.length,
      fileName: path.basename(templatePath),
      source: 'canonical-template',
    }
  }

  const reportStat = await fs.stat(reportPath)
  let meta = {}
  try {
    meta = JSON.parse(await fs.readFile(metaPath, 'utf8'))
  } catch {
    // Metadata is helpful but not required for downloading the generated deck.
  }
  return {
    ready: true,
    generated: true,
    reportPath,
    readyAt: meta.generatedAt || reportStat.mtime.toISOString(),
    size: reportStat.size,
    projectCount: projects.length,
    fileName: path.basename(reportPath),
    source: 'template-updated',
  }
}

export async function getTemplatePptDownloadPath({ data, templatePath, reportsDir }) {
  const status = await getTemplatePptStatus({ data, templatePath, reportsDir })
  return status.reportPath
}

export function hasWebsiteCreatedProjects(data) {
  return collectGeneratedProjects(data).length > 0
}
