import PDFDocument from 'pdfkit'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const REPORT_ALL_DISTRICTS = 'All Districts'
const REPORT_TOTAL_PHASE = 'Total'
const A4_LANDSCAPE = [841.89, 595.28]
const green = '#047857'
const greenDark = '#064e3b'
const greenSoft = '#ecfdf5'
const slate = '#0f172a'
const muted = '#64748b'
const border = '#a7f3d0'
const MAP_ASPECT = 2048 / 1515

const mapPoints = {
  Awaran: { x: 47, y: 79 },
  Barkhan: { x: 82, y: 42 },
  Chaghai: { x: 31, y: 44 },
  Chaman: { x: 60, y: 25 },
  'Dera Bugti': { x: 78, y: 57 },
  Duki: { x: 73, y: 35 },
  Gwadar: { x: 36, y: 92 },
  Harnai: { x: 67, y: 35 },
  Hub: { x: 60, y: 89 },
  Jaffarabad: { x: 69, y: 64 },
  'Jhal Magsi': { x: 65, y: 62 },
  Kachhi: { x: 66, y: 54 },
  Kalat: { x: 58, y: 55 },
  Kech: { x: 30, y: 82 },
  Kharan: { x: 46, y: 50 },
  Khuzdar: { x: 56, y: 68 },
  'Killa Abdullah': { x: 59, y: 30 },
  'Killa Saifullah': { x: 71, y: 26 },
  Kohlu: { x: 76, y: 47 },
  Lasbela: { x: 59, y: 80 },
  Loralai: { x: 75, y: 33 },
  Mastung: { x: 60, y: 45 },
  'Musa Khel': { x: 83, y: 29 },
  Naseerabad: { x: 69, y: 58 },
  Noushki: { x: 49, y: 39 },
  Panjgur: { x: 40, y: 75 },
  Pishin: { x: 63, y: 28 },
  Quetta: { x: 58, y: 36 },
  Sherani: { x: 85, y: 21 },
  Sibi: { x: 68, y: 43 },
  Sohbatpur: { x: 73, y: 61 },
  Surab: { x: 52, y: 58 },
  'Usta Muhammad': { x: 70, y: 65 },
  Washuk: { x: 41, y: 62 },
  Zhob: { x: 78, y: 20 },
  Ziarat: { x: 64, y: 32 },
}

const mapPointLookup = Object.fromEntries(
  Object.entries(mapPoints).map(([name, point]) => [keyFor(name), point]),
)

function keyFor(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function sanitizePathPart(value, fallback = 'item') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function countBy(items, key) {
  const counts = new Map()
  for (const item of items) {
    const value = item?.[key] || 'Unassigned'
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function parseCostToMillions(value) {
  if (!value) return 0
  const text = String(value).replace(/,/g, '').trim().toLowerCase()
  const number = Number.parseFloat(text.match(/[\d.]+/)?.[0] || '0')
  if (!number) return 0
  if (text.includes('bn') || text.includes('billion')) return number * 1000
  return number
}

function formatCostMillions(value) {
  const amount = Number(value) || 0
  if (!amount) return '-'
  if (amount >= 1000) return `Rs ${(amount / 1000).toFixed(2).replace(/\.00$/, '')} Bn`
  return `Rs ${Math.round(amount)} Mn`
}

function getMapPoint(name) {
  return mapPointLookup[keyFor(name)] || null
}

function getProjectMapPoint(projects = [], fallbackName = '') {
  const direct = getMapPoint(fallbackName)
  if (direct) return direct
  const points = projects.map((project) => getMapPoint(project.district)).filter(Boolean)
  if (!points.length) return null
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

function filterProjects(data, filters = {}) {
  const phase = filters.phase || REPORT_TOTAL_PHASE
  const district = filters.district || REPORT_ALL_DISTRICTS
  const projects = Array.isArray(data.projects) ? data.projects : []
  return projects.filter((project) => {
    const phaseMatch = phase === REPORT_TOTAL_PHASE || (project.phase || 'Phase 1') === phase
    const districtMatch = district === REPORT_ALL_DISTRICTS || project.district === district
    return phaseMatch && districtMatch
  })
}

function summarizeProjects(projects) {
  const media = projects.flatMap((project) => (Array.isArray(project.media) ? project.media : []))
  return {
    completed: projects.length,
    districts: unique(projects.map((project) => project.district)).length,
    divisions: unique(projects.map((project) => project.division)).length,
    media: media.length,
    budgetMn: projects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0),
  }
}

function reportFileName(filters = {}) {
  return `bsdi-report-${sanitizePathPart(filters.phase || REPORT_TOTAL_PHASE)}-${sanitizePathPart(filters.district || REPORT_ALL_DISTRICTS)}.pdf`
}

export async function clearReportCache(reportsDir) {
  await fs.mkdir(reportsDir, { recursive: true })
  const entries = await fs.readdir(reportsDir, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
      .map((entry) => fs.rm(path.join(reportsDir, entry.name), { force: true })),
  )
}

function resolveAsset(rootDir, relativePath) {
  return path.join(rootDir, 'public', relativePath)
}

function resolveImagePath(src, rootDir, dataDir) {
  if (!src || /^https?:\/\//i.test(src) || src.startsWith('blob:')) return ''
  if (src.startsWith('/synced-media/')) {
    return path.join(dataDir, 'media', src.replace('/synced-media/', ''))
  }
  if (src.startsWith('/')) {
    return path.join(rootDir, 'public', src.slice(1))
  }
  return path.join(rootDir, 'public', src)
}

function canUseImage(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return false
  return /\.(png|jpe?g)$/i.test(filePath)
}

async function optimizeReportImage(filePath, reportsDir) {
  if (!canUseImage(filePath)) return ''
  try {
    const stat = await fs.stat(filePath)
    const thumbDir = path.join(reportsDir, 'thumbs')
    await fs.mkdir(thumbDir, { recursive: true })
    const key = `${sanitizePathPart(path.basename(filePath))}-${stat.size}-${Math.round(stat.mtimeMs)}.jpg`
    const thumbPath = path.join(thumbDir, key)
    if (fsSync.existsSync(thumbPath)) return thumbPath
    await sharp(filePath)
      .rotate()
      .resize({ width: 1400, height: 950, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 74, mozjpeg: true })
      .toFile(thumbPath)
    return thumbPath
  } catch {
    return filePath
  }
}

function drawSafeImage(doc, filePath, x, y, width, height, options = {}) {
  if (!canUseImage(filePath)) return false
  try {
    doc.image(filePath, x, y, {
      cover: [width, height],
      align: 'center',
      valign: 'center',
      ...options,
    })
    return true
  } catch {
    return false
  }
}

function drawContainImage(doc, filePath, x, y, width, height) {
  if (!canUseImage(filePath)) return false
  try {
    doc.image(filePath, x, y, {
      fit: [width, height],
      align: 'center',
      valign: 'center',
    })
    return true
  } catch {
    return false
  }
}

function roundedFill(doc, x, y, width, height, radius, fill, stroke = '') {
  doc.roundedRect(x, y, width, height, radius).fill(fill)
  if (stroke) doc.roundedRect(x, y, width, height, radius).stroke(stroke)
}

function drawText(doc, text, x, y, options = {}) {
  const {
    size = 10,
    color = slate,
    font = 'Helvetica',
    width,
    height,
    align = 'left',
    lineGap = 1,
  } = options
  doc.font(font).fontSize(size).fillColor(color).text(String(text || ''), x, y, {
    width,
    height,
    align,
    lineGap,
    ellipsis: true,
  })
}

function drawBindingRail(doc, dark = false) {
  const fill = dark ? '#34d399' : '#10b981'
  doc.roundedRect(24, 24, 8, 548, 4).fill(fill)
  for (const y of [90, 224, 358, 492]) {
    doc.circle(28, y, 3).fill('#ffffff')
    doc.circle(28, y, 1.5).fill(dark ? greenDark : '#d1fae5')
  }
}

function addPage(doc, dark = false) {
  doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 })
  doc.rect(0, 0, A4_LANDSCAPE[0], A4_LANDSCAPE[1]).fill(dark ? '#f8fafc' : '#ffffff')
  drawBindingRail(doc, dark)
}

function drawBadge(doc, text, x, y, dark = false) {
  const width = Math.max(46, doc.widthOfString(text, { font: 'Helvetica-Bold', size: 8 }) + 18)
  roundedFill(doc, x, y, width, 22, 11, dark ? '#1f5b50' : greenSoft, dark ? '#6ee7b7' : border)
  drawText(doc, text, x, y + 7, {
    width,
    size: 8,
    font: 'Helvetica-Bold',
    color: dark ? '#ffffff' : greenDark,
    align: 'center',
  })
  return width
}

function drawLandmarks(doc, rootDir, x, y, width, height, dark = false) {
  const paths = [
    'brand/landmark-gate.png',
    'brand/landmark-princess-of-hope.png',
    'brand/landmark-residency.png',
    'brand/landmark-fort.png',
  ].map((item) => resolveAsset(rootDir, item))
  roundedFill(doc, x, y, width, height, 15, dark ? '#123d37' : '#ecfdf5', dark ? '#facc15' : '#a7f3d0')
  const gap = 7
  const imageWidth = (width - gap * 5) / 4
  paths.forEach((filePath, index) => {
    const ix = x + gap + index * (imageWidth + gap)
    const iy = y + gap
    doc.roundedRect(ix, iy, imageWidth, height - gap * 2, 10).fill('#ffffff')
    drawSafeImage(doc, filePath, ix, iy, imageWidth, height - gap * 2)
    doc.roundedRect(ix, iy, imageWidth, height - gap * 2, 10).stroke('#fde68a')
  })
}

function drawStatCard(doc, label, value, x, y, width, height, dark = false) {
  roundedFill(doc, x, y, width, height, 10, dark ? '#236558' : '#ffffff', dark ? '#6ee7b7' : border)
  drawText(doc, label.toUpperCase(), x + 12, y + 10, {
    size: 7,
    color: dark ? '#d1fae5' : green,
    font: 'Helvetica-Bold',
    width: width - 24,
  })
  drawText(doc, value, x + 12, y + 27, {
    size: 17,
    color: dark ? '#ffffff' : slate,
    font: 'Helvetica-Bold',
    width: width - 24,
  })
}

function drawMapPanel(doc, rootDir, title, subtitle, markerLabel, markerPoint, x, y, width, height, dark = false) {
  roundedFill(doc, x, y, width, height, 12, dark ? '#236558' : '#ffffff', dark ? '#6ee7b7' : border)
  drawText(doc, title.toUpperCase(), x + 12, y + 9, {
    size: 8,
    font: 'Helvetica-Bold',
    color: dark ? '#ffffff' : greenDark,
    width: width / 2,
  })
  drawText(doc, subtitle, x + width / 2, y + 9, {
    size: 7,
    color: dark ? '#d1fae5' : muted,
    font: 'Helvetica-Bold',
    width: width / 2 - 14,
    align: 'right',
  })
  const mapPath = resolveAsset(rootDir, 'brand/balochistan-district-map-print.jpg')
  const mapX = x + 12
  const mapY = y + 27
  const mapW = width - 24
  const mapH = height - 39
  const drawnW = Math.min(mapW, mapH * MAP_ASPECT)
  const drawnH = drawnW / MAP_ASPECT
  const drawX = mapX + (mapW - drawnW) / 2
  const drawY = mapY + (mapH - drawnH) / 2
  roundedFill(doc, mapX, mapY, mapW, mapH, 9, '#ffffff', '#d1fae5')
  drawContainImage(doc, mapPath, drawX, drawY, drawnW, drawnH)
  if (markerPoint) {
    const mx = drawX + (drawnW * markerPoint.x) / 100
    const my = drawY + (drawnH * markerPoint.y) / 100
    doc.circle(mx, my, 15).fillOpacity(0.18).fill('#ef4444').fillOpacity(1)
    doc.circle(mx, my, 8).fill('#ef4444')
    doc.circle(mx, my, 10).stroke('#ffffff')
    const labelWidth = Math.min(118, Math.max(48, doc.widthOfString(markerLabel, { font: 'Helvetica-Bold', size: 7 }) + 16))
    roundedFill(doc, mx - labelWidth / 2, my + 13, labelWidth, 17, 8, greenDark)
    drawText(doc, markerLabel, mx - labelWidth / 2, my + 18, {
      size: 7,
      font: 'Helvetica-Bold',
      color: '#ffffff',
      width: labelWidth,
      align: 'center',
    })
  }
}

function sectionData(projects) {
  return unique(projects.map((project) => project.division)).map((divisionName) => {
    const divisionProjects = projects.filter((project) => project.division === divisionName)
    const districts = unique(divisionProjects.map((project) => project.district)).map((districtName) => {
      const districtProjects = divisionProjects
        .filter((project) => project.district === districtName)
        .sort((a, b) => (Number(a.slide) || 99999) - (Number(b.slide) || 99999))
      return {
        name: districtName,
        projects: districtProjects,
        media: districtProjects.reduce((sum, project) => sum + (project.media || []).length, 0),
        costMn: districtProjects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0),
        categories: countBy(districtProjects, 'category').slice(0, 8),
      }
    })
    return {
      name: divisionName,
      projects: divisionProjects,
      districts,
      media: divisionProjects.reduce((sum, project) => sum + (project.media || []).length, 0),
      costMn: divisionProjects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0),
      categories: countBy(divisionProjects, 'category').slice(0, 8),
    }
  })
}

function renderCover(doc, rootDir, divisions, stats, filters) {
  doc.rect(0, 0, A4_LANDSCAPE[0], A4_LANDSCAPE[1]).fill('#053b31')
  doc.circle(705, 120, 210).fillOpacity(0.20).fill('#34d399').fillOpacity(1)
  doc.circle(230, 520, 260).fillOpacity(0.14).fill('#22c55e').fillOpacity(1)
  drawBindingRail(doc, true)
  const logo = resolveAsset(rootDir, 'brand/bsdi-logo.png')
  drawContainImage(doc, logo, 52, 32, 58, 58)
  drawText(doc, 'BALOCHISTAN SPECIAL DEVELOPMENT INITIATIVE', 122, 38, {
    size: 8,
    color: '#d1fae5',
    font: 'Helvetica-Bold',
    width: 310,
  })
  drawText(doc, 'Completed Projects BSDI', 122, 54, {
    size: 25,
    color: '#ffffff',
    font: 'Helvetica-Bold',
    width: 360,
  })
  drawLandmarks(doc, rootDir, 572, 28, 222, 58, true)
  let badgeX = 52
  for (const label of [filters.phase || REPORT_TOTAL_PHASE, filters.district || REPORT_ALL_DISTRICTS, `${stats.divisions} divisions`]) {
    badgeX += drawBadge(doc, label, badgeX, 104, true) + 8
  }
  const cardY = 142
  const cardW = 184
  drawStatCard(doc, 'Completed projects', String(stats.completed), 52, cardY, cardW, 58, true)
  drawStatCard(doc, 'Districts', String(stats.districts), 246, cardY, cardW, 58, true)
  drawStatCard(doc, 'Total media', String(stats.media), 440, cardY, cardW, 58, true)
  drawStatCard(doc, 'Budget', formatCostMillions(stats.budgetMn), 634, cardY, cardW, 58, true)
  const divY = 214
  const divW = 184
  divisions.slice(0, 8).forEach((division, index) => {
    const col = index % 4
    const row = Math.floor(index / 4)
    const x = 52 + col * 194
    const y = divY + row * 78
    roundedFill(doc, x, y, divW, 62, 10, '#236558', '#6ee7b7')
    drawText(doc, division.name, x + 12, y + 11, { size: 9, color: '#ffffff', font: 'Helvetica-Bold', width: divW - 24 })
    drawText(doc, String(division.projects.length), x + 12, y + 29, { size: 18, color: '#ffffff', font: 'Helvetica-Bold', width: 60 })
    drawText(doc, `${division.districts.length} districts - ${formatCostMillions(division.costMn)}`, x + 12, y + 50, {
      size: 7,
      color: '#d1fae5',
      font: 'Helvetica-Bold',
      width: divW - 24,
    })
  })
}

function renderDivisionPage(doc, rootDir, division) {
  addPage(doc)
  drawText(doc, 'DIVISION MAIN PAGE', 52, 34, { size: 8, color: green, font: 'Helvetica-Bold', width: 220 })
  drawText(doc, division.name, 52, 52, { size: 26, color: slate, font: 'Helvetica-Bold', width: 360 })
  drawLandmarks(doc, rootDir, 562, 30, 236, 58)
  const statsY = 106
  drawStatCard(doc, 'Projects', String(division.projects.length), 52, statsY, 180, 56)
  drawStatCard(doc, 'Districts', String(division.districts.length), 246, statsY, 180, 56)
  drawStatCard(doc, 'Media', String(division.media), 440, statsY, 180, 56)
  drawStatCard(doc, 'Cost', formatCostMillions(division.costMn), 634, statsY, 180, 56)
  drawChipBlock(doc, 'District Coverage', division.districts.map((item) => `${item.name} (${item.projects.length})`), 52, 184, 370, 96)
  drawChipBlock(doc, 'Top Categories', division.categories.map((item) => `${item.name} (${item.count})`), 446, 184, 368, 96)
  drawMapPanel(
    doc,
    rootDir,
    'Division Map',
    `${division.name} highlighted by active district coverage`,
    division.name.replace(' Division', ''),
    getProjectMapPoint(division.projects, division.name),
    52,
    304,
    762,
    244,
  )
}

function drawChipBlock(doc, title, chips, x, y, width, height) {
  roundedFill(doc, x, y, width, height, 12, '#ffffff', '#d1fae5')
  drawText(doc, title, x + 12, y + 12, { size: 10, color: greenDark, font: 'Helvetica-Bold', width: width - 24 })
  let chipX = x + 12
  let chipY = y + 36
  for (const chip of chips.slice(0, 14)) {
    const chipW = Math.min(width - 24, Math.max(42, doc.widthOfString(chip, { font: 'Helvetica-Bold', size: 7 }) + 14))
    if (chipX + chipW > x + width - 12) {
      chipX = x + 12
      chipY += 22
    }
    if (chipY + 17 > y + height - 8) break
    roundedFill(doc, chipX, chipY, chipW, 16, 8, greenSoft, border)
    drawText(doc, chip, chipX, chipY + 5, { size: 7, color: greenDark, font: 'Helvetica-Bold', width: chipW, align: 'center' })
    chipX += chipW + 6
  }
}

function renderDistrictPage(doc, rootDir, division, district) {
  addPage(doc)
  drawText(doc, 'DISTRICT MAIN PAGE', 52, 34, { size: 8, color: green, font: 'Helvetica-Bold', width: 220 })
  drawText(doc, district.name, 52, 52, { size: 26, color: slate, font: 'Helvetica-Bold', width: 300 })
  drawText(doc, division.name, 52, 82, { size: 10, color: muted, font: 'Helvetica-Bold', width: 240 })
  drawLandmarks(doc, rootDir, 562, 30, 236, 58)
  const statsY = 110
  drawStatCard(doc, 'Projects', String(district.projects.length), 52, statsY, 180, 56)
  drawStatCard(doc, 'Media', String(district.media), 246, statsY, 180, 56)
  drawStatCard(doc, 'Cost', formatCostMillions(district.costMn), 440, statsY, 180, 56)
  drawStatCard(doc, 'Categories', String(district.categories.length), 634, statsY, 180, 56)
  drawChipBlock(doc, 'Top Categories', district.categories.map((item) => `${item.name} (${item.count})`), 52, 188, 762, 78)
  drawMapPanel(
    doc,
    rootDir,
    'District Map',
    `${district.name} highlighted on Balochistan district map`,
    district.name,
    getProjectMapPoint(district.projects, district.name),
    52,
    290,
    762,
    258,
  )
}

function imageBoxes(count, x, y, width, height) {
  const gap = 8
  if (count <= 1) return [{ x, y, width, height }]
  if (count === 2) return [
    { x, y, width: (width - gap) / 2, height },
    { x: x + (width + gap) / 2, y, width: (width - gap) / 2, height },
  ]
  if (count === 3) {
    const bigW = width * 0.58
    return [
      { x, y, width: bigW - gap / 2, height },
      { x: x + bigW + gap / 2, y, width: width - bigW - gap / 2, height: (height - gap) / 2 },
      { x: x + bigW + gap / 2, y: y + (height + gap) / 2, width: width - bigW - gap / 2, height: (height - gap) / 2 },
    ]
  }
  const bigW = width * 0.45
  const smallW = (width - bigW - gap * 2) / 2
  const smallH = (height - gap) / 2
  const boxes = [{ x, y, width: bigW, height }]
  for (let i = 0; i < Math.min(count - 1, 4); i += 1) {
    const col = i % 2
    const row = Math.floor(i / 2)
    boxes.push({
      x: x + bigW + gap + col * (smallW + gap),
      y: y + row * (smallH + gap),
      width: smallW,
      height: smallH,
    })
  }
  return boxes
}

async function renderProjectPage(doc, rootDir, dataDir, reportsDir, project, index, divisionName, districtName) {
  addPage(doc)
  const serial = project.slide ? `#${project.slide}` : String(index + 1).padStart(3, '0')
  drawText(doc, 'PROJECT PAGE', 52, 34, { size: 8, color: green, font: 'Helvetica-Bold', width: 180 })
  drawText(doc, project.title || 'Untitled project', 52, 52, { size: 22, color: slate, font: 'Helvetica-Bold', width: 560, height: 54 })
  roundedFill(doc, 720, 34, 78, 54, 12, greenDark)
  drawText(doc, 'SERIAL', 720, 45, { size: 7, color: '#d1fae5', font: 'Helvetica-Bold', width: 78, align: 'center' })
  drawText(doc, serial, 720, 60, { size: 16, color: '#ffffff', font: 'Helvetica-Bold', width: 78, align: 'center' })
  const meta = [
    ['Division', divisionName || project.division],
    ['District', districtName || project.district],
    ['Phase', project.phase || 'Phase 1'],
    ['Cost', project.cost || '-'],
    ['Category', project.category || '-'],
    ['Beneficiary', project.beneficiary || '-'],
    ['Progress', project.progress || 'Completed'],
    ['Media', String((project.media || []).length)],
  ]
  meta.forEach(([label, value], i) => {
    const col = i % 4
    const row = Math.floor(i / 4)
    const x = 52 + col * 190
    const y = 112 + row * 52
    drawStatCard(doc, label, String(value), x, y, 174, 42)
  })
  const description = project.description || project.scope || ''
  if (description) {
    roundedFill(doc, 52, 226, 746, 42, 10, '#ffffff', '#d1fae5')
    drawText(doc, description, 64, 239, { size: 8, color: '#334155', font: 'Helvetica-Bold', width: 722, height: 20 })
  }
  drawText(doc, 'PROJECT IMAGES', 52, 288, { size: 8, color: greenDark, font: 'Helvetica-Bold', width: 180 })
  const images = (project.media || [])
    .filter((item) => item.type !== 'video')
    .map((item) => resolveImagePath(item.src, rootDir, dataDir))
    .filter(canUseImage)
    .slice(0, 5)
  const reportImages = []
  for (const imagePath of images) {
    reportImages.push(await optimizeReportImage(imagePath, reportsDir))
  }
  const imageY = 308
  const imageH = 218
  if (!reportImages.length) {
    roundedFill(doc, 52, imageY, 746, imageH, 12, '#f8fafc', '#d1fae5')
    drawText(doc, 'No image added', 52, imageY + imageH / 2 - 6, { size: 12, color: muted, font: 'Helvetica-Bold', width: 746, align: 'center' })
  } else {
    const boxes = imageBoxes(reportImages.length, 52, imageY, 746, imageH)
    reportImages.forEach((filePath, i) => {
      const box = boxes[i]
      doc.roundedRect(box.x, box.y, box.width, box.height, 12).fill('#f8fafc')
      drawSafeImage(doc, filePath, box.x, box.y, box.width, box.height)
      doc.roundedRect(box.x, box.y, box.width, box.height, 12).stroke('#d1fae5')
    })
  }
  const videoCount = (project.media || []).filter((item) => item.type === 'video').length
  const footer = `${(project.media || []).length} media file${(project.media || []).length === 1 ? '' : 's'}${videoCount ? ` | ${videoCount} video${videoCount === 1 ? '' : 's'} available in app` : ''}`
  drawBadge(doc, footer, 52, 542)
}

export async function generateCachedReport({ data, reportsDir, rootDir, dataDir, filters = {} }) {
  const phase = filters.phase || REPORT_TOTAL_PHASE
  const district = filters.district || REPORT_ALL_DISTRICTS
  await fs.mkdir(reportsDir, { recursive: true })
  const fileName = reportFileName({ phase, district })
  const reportPath = path.join(reportsDir, fileName)
  if (fsSync.existsSync(reportPath)) return reportPath

  const projects = filterProjects(data, { phase, district })
  const divisions = sectionData(projects)
  const stats = summarizeProjects(projects)
  const tempPath = path.join(reportsDir, `${fileName}.${Date.now()}.tmp`)
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    autoFirstPage: false,
    info: {
      Title: 'BSDI Completed Projects',
      Author: 'Balochistan Special Development Initiative',
      Subject: `${phase} / ${district}`,
    },
  })
  const stream = fsSync.createWriteStream(tempPath)
  doc.pipe(stream)
  doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 })
  renderCover(doc, rootDir, divisions, stats, { phase, district })
  for (const division of divisions) {
    renderDivisionPage(doc, rootDir, division)
    for (const districtItem of division.districts) {
      renderDistrictPage(doc, rootDir, division, districtItem)
      for (const [index, project] of districtItem.projects.entries()) {
        await renderProjectPage(doc, rootDir, dataDir, reportsDir, project, index, division.name, districtItem.name)
      }
    }
  }
  doc.end()
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
  await fs.rename(tempPath, reportPath)
  return reportPath
}

export function warmDefaultReport(options) {
  generateCachedReport({
    ...options,
    filters: { phase: REPORT_TOTAL_PHASE, district: REPORT_ALL_DISTRICTS },
  }).catch((error) => {
    console.warn(`Report generation failed: ${error.message}`)
  })
}
