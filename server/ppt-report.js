import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import pptxgen from 'pptxgenjs'
import sharp from 'sharp'

const REPORT_ALL_DISTRICTS = 'All Districts'
const REPORT_TOTAL_PHASE = 'Total'
const MAP_ASPECT = 2048 / 1515

const colors = {
  navy: '0F1B3D',
  blue: '1D4ED8',
  sky: '38BDF8',
  green: '059669',
  greenDark: '064E3B',
  greenSoft: 'ECFDF5',
  amber: 'FACC15',
  white: 'FFFFFF',
  slate: '0F172A',
  muted: '64748B',
  border: 'A7F3D0',
  line: 'BFDBFE',
  panel: 'F8FAFC',
}

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

function sectionData(projects) {
  return unique(projects.map((project) => project.division)).map((divisionName) => {
    const divisionProjects = projects.filter((project) => project.division === divisionName)
    const districts = unique(divisionProjects.map((project) => project.district)).map((districtName) => {
      const districtProjects = divisionProjects
        .filter((project) => project.district === districtName)
        .sort((a, b) => (Number(a.slide) || 99999) - (Number(b.slide) || 99999))
      return {
        key: `${divisionName}::${districtName}`,
        name: districtName,
        projects: districtProjects,
        media: districtProjects.reduce((sum, project) => sum + (project.media || []).length, 0),
        costMn: districtProjects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0),
        categories: countBy(districtProjects, 'category').slice(0, 8),
      }
    })
    return {
      key: divisionName,
      name: divisionName,
      projects: divisionProjects,
      districts,
      media: divisionProjects.reduce((sum, project) => sum + (project.media || []).length, 0),
      costMn: divisionProjects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0),
      categories: countBy(divisionProjects, 'category').slice(0, 8),
    }
  })
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

function resolveAsset(rootDir, relativePath) {
  return path.join(rootDir, 'public', relativePath)
}

function resolveImagePath(src, rootDir, dataDir) {
  if (!src || /^https?:\/\//i.test(src) || src.startsWith('blob:')) return ''
  if (src.startsWith('/synced-media/')) {
    return path.join(dataDir, 'media', src.replace('/synced-media/', ''))
  }
  if (src.startsWith('/')) return path.join(rootDir, 'public', src.slice(1))
  return path.join(rootDir, 'public', src)
}

function canUseImage(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return false
  return /\.(png|jpe?g|webp)$/i.test(filePath)
}

async function makePptImage(filePath, reportsDir, widthIn, heightIn, mode = 'cover') {
  if (!canUseImage(filePath)) return ''
  try {
    const stat = await fs.stat(filePath)
    const thumbDir = path.join(reportsDir, 'ppt-thumbs')
    await fs.mkdir(thumbDir, { recursive: true })
    const width = Math.max(320, Math.round(widthIn * 170))
    const height = Math.max(220, Math.round(heightIn * 170))
    const key = `${sanitizePathPart(path.basename(filePath))}-${stat.size}-${Math.round(stat.mtimeMs)}-${width}x${height}-${mode}.jpg`
    const thumbPath = path.join(thumbDir, key)
    if (fsSync.existsSync(thumbPath)) return thumbPath
    await sharp(filePath)
      .rotate()
      .resize({ width, height, fit: mode, withoutEnlargement: false, background: '#ffffff' })
      .jpeg({ quality: 62, mozjpeg: true })
      .toFile(thumbPath)
    return thumbPath
  } catch {
    return filePath
  }
}

function addText(slide, text, x, y, w, h, options = {}) {
  slide.addText(String(text || ''), {
    x,
    y,
    w,
    h,
    margin: options.margin ?? 0.04,
    fontFace: 'Aptos',
    fontSize: options.size || 10,
    bold: Boolean(options.bold),
    color: options.color || colors.slate,
    align: options.align || 'left',
    valign: options.valign || 'mid',
    fit: 'shrink',
    breakLine: false,
  })
}

function addRoundRect(slide, pptx, x, y, w, h, fill, line = fill, options = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: options.radius || 0.08,
    fill: { color: fill, transparency: options.fillTransparency || 0 },
    line: { color: line, transparency: options.lineTransparency || 0, width: options.lineWidth || 1 },
    shadow: options.shadow ? { type: 'outer', color: '0F172A', opacity: 0.12, blur: 2, angle: 45, distance: 1 } : undefined,
    hyperlink: options.hyperlink,
  })
}

function addStatCard(slide, pptx, label, value, x, y, w, h, dark = false, hyperlink) {
  addRoundRect(slide, pptx, x, y, w, h, dark ? '246B5D' : colors.white, dark ? '6EE7B7' : colors.border, {
    shadow: !dark,
    hyperlink,
  })
  addText(slide, label.toUpperCase(), x + 0.12, y + 0.1, w - 0.24, 0.16, {
    size: 6.5,
    bold: true,
    color: dark ? 'D1FAE5' : colors.green,
  })
  addText(slide, value, x + 0.12, y + 0.28, w - 0.24, h - 0.32, {
    size: String(value).length > 12 ? 10 : 16,
    bold: true,
    color: dark ? colors.white : colors.slate,
  })
}

function addBadge(slide, pptx, text, x, y, options = {}) {
  const w = Math.min(options.maxW || 2.0, Math.max(options.minW || 0.66, String(text).length * 0.075 + 0.28))
  addRoundRect(slide, pptx, x, y, w, 0.28, options.dark ? '1F5B50' : colors.greenSoft, options.dark ? '6EE7B7' : colors.border, {
    hyperlink: options.hyperlink,
  })
  addText(slide, text, x, y + 0.04, w, 0.16, {
    size: 6.2,
    bold: true,
    color: options.dark ? colors.white : colors.greenDark,
    align: 'center',
  })
  return w
}

function addBindingRail(slide, pptx, dark = false) {
  addRoundRect(slide, pptx, 0.34, 0.32, 0.1, 6.82, dark ? '34D399' : '10B981', dark ? '34D399' : '10B981')
  for (const y of [1.2, 2.82, 4.44, 6.06]) {
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.375,
      y,
      w: 0.05,
      h: 0.05,
      fill: { color: colors.white },
      line: { color: colors.white },
    })
  }
}

function addSlideBase(slide, pptx, dark = false) {
  slide.background = { color: dark ? 'F8FAFC' : colors.white }
  addBindingRail(slide, pptx, dark)
  addText(slide, 'BSDI Completed Projects', 11.0, 7.12, 1.8, 0.16, {
    size: 5.4,
    color: dark ? colors.muted : '94A3B8',
    align: 'right',
  })
}

async function addImage(slide, filePath, reportsDir, x, y, w, h, mode = 'cover') {
  const imagePath = await makePptImage(filePath, reportsDir, w, h, mode)
  if (!imagePath) return false
  slide.addImage({ path: imagePath, x, y, w, h })
  return true
}

async function addLandmarks(slide, pptx, rootDir, reportsDir, x, y, w, h, dark = false) {
  addRoundRect(slide, pptx, x, y, w, h, dark ? '123D37' : colors.greenSoft, dark ? colors.amber : colors.border)
  const assets = [
    'brand/landmark-gate.png',
    'brand/landmark-princess-of-hope.png',
    'brand/landmark-residency.png',
    'brand/landmark-fort.png',
  ].map((item) => resolveAsset(rootDir, item))
  const gap = 0.1
  const imageW = (w - gap * 5) / 4
  for (const [index, filePath] of assets.entries()) {
    const ix = x + gap + index * (imageW + gap)
    addRoundRect(slide, pptx, ix, y + gap, imageW, h - gap * 2, colors.white, 'FDE68A')
    await addImage(slide, filePath, reportsDir, ix, y + gap, imageW, h - gap * 2, 'cover')
  }
}

async function addMap(slide, pptx, rootDir, reportsDir, title, subtitle, markerLabel, markerPoint, x, y, w, h) {
  addRoundRect(slide, pptx, x, y, w, h, colors.white, colors.border, { shadow: true })
  addText(slide, title.toUpperCase(), x + 0.18, y + 0.12, w * 0.48, 0.18, {
    size: 7,
    bold: true,
    color: colors.greenDark,
  })
  addText(slide, subtitle, x + w * 0.48, y + 0.12, w * 0.48, 0.18, {
    size: 6,
    bold: true,
    color: colors.muted,
    align: 'right',
  })
  const mapPath = resolveAsset(rootDir, 'brand/balochistan-district-map-print.jpg')
  const mapX = x + 0.18
  const mapY = y + 0.42
  const mapW = w - 0.36
  const mapH = h - 0.58
  const drawnW = Math.min(mapW, mapH * MAP_ASPECT)
  const drawnH = drawnW / MAP_ASPECT
  const drawX = mapX + (mapW - drawnW) / 2
  const drawY = mapY + (mapH - drawnH) / 2
  addRoundRect(slide, pptx, mapX, mapY, mapW, mapH, colors.white, 'D1FAE5')
  await addImage(slide, mapPath, reportsDir, drawX, drawY, drawnW, drawnH, 'contain')
  if (markerPoint) {
    const mx = drawX + (drawnW * markerPoint.x) / 100
    const my = drawY + (drawnH * markerPoint.y) / 100
    slide.addShape(pptx.ShapeType.ellipse, {
      x: mx - 0.13,
      y: my - 0.13,
      w: 0.26,
      h: 0.26,
      fill: { color: 'EF4444' },
      line: { color: colors.white, width: 1 },
    })
    const labelW = Math.min(1.8, Math.max(0.8, markerLabel.length * 0.07 + 0.35))
    addRoundRect(slide, pptx, mx - labelW / 2, my + 0.16, labelW, 0.24, colors.greenDark, colors.greenDark)
    addText(slide, markerLabel, mx - labelW / 2, my + 0.2, labelW, 0.12, {
      size: 5.8,
      bold: true,
      color: colors.white,
      align: 'center',
    })
  }
}

function addNavButton(slide, pptx, label, slideNumber, x, y, w = 0.96) {
  if (!slideNumber) return
  addRoundRect(slide, pptx, x, y, w, 0.32, colors.greenSoft, colors.border, {
    hyperlink: { slide: slideNumber, tooltip: label },
  })
  addText(slide, label, x, y + 0.055, w, 0.14, {
    size: 6.2,
    bold: true,
    color: colors.greenDark,
    align: 'center',
  })
}

function imageBoxes(count, x, y, width, height) {
  const gap = 0.1
  if (count <= 1) return [{ x, y, w: width, h: height }]
  if (count === 2) {
    return [
      { x, y, w: width * 0.58 - gap / 2, h: height },
      { x: x + width * 0.58 + gap / 2, y, w: width * 0.42 - gap / 2, h: height },
    ]
  }
  if (count === 3) {
    const bigW = width * 0.58
    return [
      { x, y, w: bigW - gap / 2, h: height },
      { x: x + bigW + gap / 2, y, w: width - bigW - gap / 2, h: (height - gap) / 2 },
      { x: x + bigW + gap / 2, y: y + (height + gap) / 2, w: width - bigW - gap / 2, h: (height - gap) / 2 },
    ]
  }
  return [
    { x, y, w: width * 0.52 - gap / 2, h: height },
    { x: x + width * 0.52 + gap / 2, y, w: width * 0.48 - gap / 2, h: (height - gap) / 2 },
    { x: x + width * 0.52 + gap / 2, y: y + (height + gap) / 2, w: (width * 0.48 - gap * 1.5) / 2, h: (height - gap) / 2 },
    { x: x + width * 0.76 + gap / 2, y: y + (height + gap) / 2, w: (width * 0.48 - gap * 1.5) / 2, h: (height - gap) / 2 },
  ]
}

function buildSlideMap(divisions) {
  let slideNumber = 1
  const divisionSlides = new Map()
  const districtSlides = new Map()
  const projectSlides = new Map()
  slideNumber += 1
  for (const division of divisions) {
    divisionSlides.set(division.key, slideNumber)
    slideNumber += 1
    for (const district of division.districts) {
      districtSlides.set(district.key, slideNumber)
      slideNumber += 1
      for (const project of district.projects) {
        projectSlides.set(project.id || `${district.key}::${project.title}`, slideNumber)
        slideNumber += 1
      }
    }
  }
  return { cover: 1, divisionSlides, districtSlides, projectSlides }
}

async function renderCover(pptx, rootDir, reportsDir, divisions, stats, filters, links) {
  const slide = pptx.addSlide()
  slide.background = { color: '06362E' }
  slide.addShape(pptx.ShapeType.arc, {
    x: 8.4,
    y: -0.9,
    w: 4.8,
    h: 4.8,
    fill: { color: '34D399', transparency: 78 },
    line: { color: '34D399', transparency: 100 },
  })
  addBindingRail(slide, pptx, true)
  const logo = resolveAsset(rootDir, 'brand/bsdi-logo.png')
  await addImage(slide, logo, reportsDir, 0.78, 0.42, 0.72, 0.72, 'contain')
  addText(slide, 'BALOCHISTAN SPECIAL DEVELOPMENT INITIATIVE', 1.68, 0.46, 4.4, 0.18, {
    size: 7,
    color: 'D1FAE5',
    bold: true,
  })
  addText(slide, 'Completed Projects BSDI', 1.68, 0.66, 5.2, 0.42, {
    size: 24,
    color: colors.white,
    bold: true,
  })
  await addLandmarks(slide, pptx, rootDir, reportsDir, 8.3, 0.36, 3.56, 0.76, true)

  let badgeX = 0.78
  for (const label of [filters.phase || REPORT_TOTAL_PHASE, filters.district || REPORT_ALL_DISTRICTS, `${stats.divisions} divisions`]) {
    badgeX += addBadge(slide, pptx, label, badgeX, 1.28, { dark: true }) + 0.12
  }

  const cardY = 1.78
  addStatCard(slide, pptx, 'Completed projects', String(stats.completed), 0.78, cardY, 2.72, 0.74, true)
  addStatCard(slide, pptx, 'Districts', String(stats.districts), 3.64, cardY, 2.72, 0.74, true)
  addStatCard(slide, pptx, 'Total media', String(stats.media), 6.5, cardY, 2.72, 0.74, true)
  addStatCard(slide, pptx, 'Budget', formatCostMillions(stats.budgetMn), 9.36, cardY, 2.72, 0.74, true)

  divisions.slice(0, 8).forEach((division, index) => {
    const col = index % 4
    const row = Math.floor(index / 4)
    const x = 0.78 + col * 2.86
    const y = 2.72 + row * 0.98
    addStatCard(
      slide,
      pptx,
      division.name,
      String(division.projects.length),
      x,
      y,
      2.72,
      0.78,
      true,
      { slide: links.divisionSlides.get(division.key), tooltip: `Open ${division.name}` },
    )
    addText(slide, `${division.districts.length} districts - ${formatCostMillions(division.costMn)}`, x + 0.12, y + 0.58, 2.45, 0.12, {
      size: 5.8,
      bold: true,
      color: 'D1FAE5',
    })
  })
  addText(slide, 'Click any division card to jump to that section.', 0.78, 6.74, 4.5, 0.14, {
    size: 6.2,
    color: 'D1FAE5',
    bold: true,
  })
}

async function renderDivisionPage(pptx, rootDir, reportsDir, division, links) {
  const slide = pptx.addSlide()
  addSlideBase(slide, pptx)
  addNavButton(slide, pptx, 'Home', links.cover, 11.72, 0.34)
  addText(slide, 'DIVISION MAIN PAGE', 0.78, 0.42, 2.4, 0.16, { size: 7, color: colors.green, bold: true })
  addText(slide, division.name, 0.78, 0.64, 4.4, 0.42, { size: 24, bold: true })
  await addLandmarks(slide, pptx, rootDir, reportsDir, 8.32, 0.38, 3.5, 0.72)
  addStatCard(slide, pptx, 'Projects', String(division.projects.length), 0.78, 1.34, 2.64, 0.68)
  addStatCard(slide, pptx, 'Districts', String(division.districts.length), 3.64, 1.34, 2.64, 0.68)
  addStatCard(slide, pptx, 'Media', String(division.media), 6.5, 1.34, 2.64, 0.68)
  addStatCard(slide, pptx, 'Cost', formatCostMillions(division.costMn), 9.36, 1.34, 2.64, 0.68)

  addRoundRect(slide, pptx, 0.78, 2.3, 5.54, 1.24, colors.white, 'D1FAE5', { shadow: true })
  addText(slide, 'DISTRICT COVERAGE', 0.96, 2.44, 2.2, 0.14, { size: 7, bold: true, color: colors.greenDark })
  let chipX = 0.96
  let chipY = 2.74
  for (const district of division.districts.slice(0, 14)) {
    const text = `${district.name} (${district.projects.length})`
    const w = addBadge(slide, pptx, text, chipX, chipY, {
      maxW: 1.36,
      hyperlink: { slide: links.districtSlides.get(district.key), tooltip: `Open ${district.name}` },
    })
    chipX += w + 0.08
    if (chipX > 5.68) {
      chipX = 0.96
      chipY += 0.32
    }
  }

  addRoundRect(slide, pptx, 6.52, 2.3, 5.48, 1.24, colors.white, 'D1FAE5', { shadow: true })
  addText(slide, 'TOP CATEGORIES', 6.7, 2.44, 2.2, 0.14, { size: 7, bold: true, color: colors.greenDark })
  chipX = 6.7
  chipY = 2.74
  for (const category of division.categories.slice(0, 12)) {
    const w = addBadge(slide, pptx, `${category.name} (${category.count})`, chipX, chipY, { maxW: 1.36 })
    chipX += w + 0.08
    if (chipX > 11.3) {
      chipX = 6.7
      chipY += 0.32
    }
  }
  await addMap(
    slide,
    pptx,
    rootDir,
    reportsDir,
    'Division map',
    `${division.name} active coverage`,
    division.name.replace(' Division', ''),
    getProjectMapPoint(division.projects, division.name),
    0.78,
    3.82,
    11.22,
    2.72,
  )
}

async function renderDistrictPage(pptx, rootDir, reportsDir, division, district, links) {
  const slide = pptx.addSlide()
  addSlideBase(slide, pptx)
  addNavButton(slide, pptx, 'Home', links.cover, 10.64, 0.34)
  addNavButton(slide, pptx, 'Division', links.divisionSlides.get(division.key), 11.72, 0.34)
  addText(slide, 'DISTRICT MAIN PAGE', 0.78, 0.42, 2.4, 0.16, { size: 7, color: colors.green, bold: true })
  addText(slide, district.name, 0.78, 0.64, 3.8, 0.42, { size: 24, bold: true })
  addText(slide, division.name, 0.78, 0.98, 3.2, 0.16, { size: 8, color: colors.muted, bold: true })
  await addLandmarks(slide, pptx, rootDir, reportsDir, 8.32, 0.38, 3.5, 0.72)
  addStatCard(slide, pptx, 'Projects', String(district.projects.length), 0.78, 1.42, 2.64, 0.68)
  addStatCard(slide, pptx, 'Media', String(district.media), 3.64, 1.42, 2.64, 0.68)
  addStatCard(slide, pptx, 'Cost', formatCostMillions(district.costMn), 6.5, 1.42, 2.64, 0.68)
  addStatCard(slide, pptx, 'Categories', String(district.categories.length), 9.36, 1.42, 2.64, 0.68)

  addRoundRect(slide, pptx, 0.78, 2.32, 5.5, 1.22, colors.white, 'D1FAE5', { shadow: true })
  addText(slide, 'PROJECT TAGS', 0.96, 2.46, 2.2, 0.14, { size: 7, bold: true, color: colors.greenDark })
  let chipX = 0.96
  let chipY = 2.74
  for (const project of district.projects.slice(0, 12)) {
    const text = project.slide ? `#${project.slide}` : String(project.title || 'Project').slice(0, 16)
    const w = addBadge(slide, pptx, text, chipX, chipY, {
      minW: 0.48,
      maxW: 1.1,
      hyperlink: { slide: links.projectSlides.get(project.id || `${district.key}::${project.title}`), tooltip: project.title },
    })
    chipX += w + 0.08
    if (chipX > 5.48) {
      chipX = 0.96
      chipY += 0.32
    }
  }

  addRoundRect(slide, pptx, 6.52, 2.32, 5.48, 1.22, colors.white, 'D1FAE5', { shadow: true })
  addText(slide, 'TOP CATEGORIES', 6.7, 2.46, 2.2, 0.14, { size: 7, bold: true, color: colors.greenDark })
  chipX = 6.7
  chipY = 2.74
  for (const category of district.categories.slice(0, 12)) {
    const w = addBadge(slide, pptx, `${category.name} (${category.count})`, chipX, chipY, { maxW: 1.3 })
    chipX += w + 0.08
    if (chipX > 11.3) {
      chipX = 6.7
      chipY += 0.32
    }
  }
  await addMap(
    slide,
    pptx,
    rootDir,
    reportsDir,
    'District map',
    `${district.name} highlighted`,
    district.name,
    getProjectMapPoint(district.projects, district.name),
    0.78,
    3.82,
    11.22,
    2.72,
  )
}

async function renderProjectPage(pptx, rootDir, dataDir, reportsDir, project, index, division, district, links) {
  const slide = pptx.addSlide()
  addSlideBase(slide, pptx)
  addNavButton(slide, pptx, 'Home', links.cover, 9.56, 0.34)
  addNavButton(slide, pptx, 'District', links.districtSlides.get(district.key), 10.64, 0.34)
  addNavButton(slide, pptx, 'Division', links.divisionSlides.get(division.key), 11.72, 0.34)
  const serial = project.slide ? `#${project.slide}` : String(index + 1).padStart(3, '0')
  addText(slide, 'PROJECT PAGE', 0.78, 0.42, 2.0, 0.16, { size: 7, color: colors.green, bold: true })
  addText(slide, project.title || 'Untitled project', 0.78, 0.64, 7.6, 0.48, { size: 22, bold: true })
  addRoundRect(slide, pptx, 11.0, 0.42, 1.0, 0.58, colors.greenDark, colors.greenDark)
  addText(slide, 'SERIAL', 11.0, 0.51, 1.0, 0.12, { size: 5.8, color: 'D1FAE5', bold: true, align: 'center' })
  addText(slide, serial, 11.0, 0.66, 1.0, 0.22, { size: 13, color: colors.white, bold: true, align: 'center' })

  const meta = [
    ['Division', division.name || project.division],
    ['District', district.name || project.district],
    ['Phase', project.phase || 'Phase 1'],
    ['Cost', project.cost || '-'],
    ['Category', project.category || '-'],
    ['Beneficiary', project.beneficiary || 'Not added'],
    ['Progress', project.progress || 'Completed'],
    ['Media', String((project.media || []).length)],
  ]
  meta.forEach(([label, value], i) => {
    const col = i % 4
    const row = Math.floor(i / 4)
    addStatCard(slide, pptx, label, String(value), 0.78 + col * 2.86, 1.42 + row * 0.58, 2.58, 0.46)
  })

  const description = project.description || project.scope || ''
  if (description) {
    addRoundRect(slide, pptx, 0.78, 2.74, 11.2, 0.44, colors.white, 'D1FAE5')
    addText(slide, description, 0.96, 2.85, 10.84, 0.18, { size: 6.3, bold: true, color: '334155' })
  }
  addText(slide, 'PROJECT IMAGES', 0.78, 3.42, 2.0, 0.14, { size: 7, color: colors.greenDark, bold: true })
  const images = (project.media || [])
    .filter((item) => item.type !== 'video')
    .map((item) => resolveImagePath(item.src, rootDir, dataDir))
    .filter(canUseImage)
    .slice(0, 4)
  if (!images.length) {
    addRoundRect(slide, pptx, 0.78, 3.72, 11.2, 2.38, colors.panel, 'D1FAE5')
    addText(slide, 'No image added', 0.78, 4.75, 11.2, 0.22, { size: 14, color: colors.muted, bold: true, align: 'center' })
  } else {
    const boxes = imageBoxes(images.length, 0.78, 3.72, 11.2, 2.38)
    for (const [i, imagePath] of images.entries()) {
      const box = boxes[i]
      addRoundRect(slide, pptx, box.x, box.y, box.w, box.h, colors.panel, 'D1FAE5')
      await addImage(slide, imagePath, reportsDir, box.x, box.y, box.w, box.h, 'cover')
    }
  }
  const videoCount = (project.media || []).filter((item) => item.type === 'video').length
  const footer = `${(project.media || []).length} media file${(project.media || []).length === 1 ? '' : 's'}${videoCount ? ` | ${videoCount} video${videoCount === 1 ? '' : 's'} available in app` : ''}`
  addBadge(slide, pptx, footer, 0.78, 6.38, { maxW: 2.4 })
}

export function pptReportFileName(filters = {}) {
  return `bsdi-report-${sanitizePathPart(filters.phase || REPORT_TOTAL_PHASE)}-${sanitizePathPart(filters.district || REPORT_ALL_DISTRICTS)}.pptx`
}

export async function getPptReportStatus({ reportsDir, filters = {} }) {
  await fs.mkdir(reportsDir, { recursive: true })
  const fileName = pptReportFileName(filters)
  const reportPath = path.join(reportsDir, fileName)
  try {
    const stat = await fs.stat(reportPath)
    return {
      ready: true,
      fileName,
      readyAt: stat.mtime.toISOString(),
      size: stat.size,
    }
  } catch {
    return {
      ready: false,
      fileName,
      readyAt: '',
      size: 0,
    }
  }
}

export async function clearPptReportCache(reportsDir, keepNames = []) {
  await fs.mkdir(reportsDir, { recursive: true })
  const keep = new Set(keepNames)
  const entries = await fs.readdir(reportsDir, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pptx') && !keep.has(entry.name))
      .map((entry) => fs.rm(path.join(reportsDir, entry.name), { force: true })),
  )
}

export async function generateCachedPptReport({ data, reportsDir, rootDir, dataDir, filters = {}, force = false }) {
  const phase = filters.phase || REPORT_TOTAL_PHASE
  const district = filters.district || REPORT_ALL_DISTRICTS
  await fs.mkdir(reportsDir, { recursive: true })
  const fileName = pptReportFileName({ phase, district })
  const reportPath = path.join(reportsDir, fileName)
  if (!force && fsSync.existsSync(reportPath)) return reportPath

  const projects = filterProjects(data, { phase, district })
  const divisions = sectionData(projects)
  const stats = summarizeProjects(projects)
  const links = buildSlideMap(divisions)

  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Balochistan Special Development Initiative'
  pptx.company = 'BSDI'
  pptx.subject = `${phase} / ${district}`
  pptx.title = 'BSDI Completed Projects'
  pptx.lang = 'en-US'
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'en-US',
  }
  pptx.margin = 0

  await renderCover(pptx, rootDir, reportsDir, divisions, stats, { phase, district }, links)
  for (const division of divisions) {
    await renderDivisionPage(pptx, rootDir, reportsDir, division, links)
    for (const districtItem of division.districts) {
      await renderDistrictPage(pptx, rootDir, reportsDir, division, districtItem, links)
      for (const [index, project] of districtItem.projects.entries()) {
        await renderProjectPage(pptx, rootDir, dataDir, reportsDir, project, index, division, districtItem, links)
      }
    }
  }

  const tempPath = path.join(reportsDir, `${fileName}.${Date.now()}.tmp.pptx`)
  await pptx.writeFile({ fileName: tempPath, compression: true })
  if (force) await fs.rm(reportPath, { force: true })
  await fs.rename(tempPath, reportPath)
  return reportPath
}
