import { strFromU8, unzipSync } from 'fflate'

export const DEFAULT_GOOGLE_SHEET_ID = '1wFiY9w9OiWgKWosE9cZNoIwfKz92-_NxTga_RwQuG6c'
export const DEFAULT_GOOGLE_SHEET_URL =
  `https://docs.google.com/spreadsheets/d/${DEFAULT_GOOGLE_SHEET_ID}/edit?gid=1491221426#gid=1491221426`

const COMPLETED_THRESHOLD = 100

export const officialDivisions = [
  {
    id: 'kalat-division',
    name: 'Kalat Division',
    districts: ['Awaran', 'Hub', 'Kalat', 'Khuzdar', 'Lasbela', 'Mastung', 'Surab'],
  },
  {
    id: 'loralai-division',
    name: 'Loralai Division',
    districts: ['Barkhan', 'Duki', 'Loralai', 'Musa Khel'],
  },
  {
    id: 'makran-division',
    name: 'Makran Division',
    districts: ['Gwadar', 'Kech', 'Panjgur'],
  },
  {
    id: 'naseerabad-division',
    name: 'Naseerabad Division',
    districts: ['Jaffarabad', 'Jhal Magsi', 'Kachhi', 'Naseerabad', 'Sohbatpur', 'Usta Muhammad'],
  },
  {
    id: 'quetta-division',
    name: 'Quetta Division',
    districts: ['Chaman', 'Killa Abdullah', 'Pishin', 'Quetta'],
  },
  {
    id: 'rakshan-division',
    name: 'Rakhshan Division',
    districts: ['Chaghai', 'Kharan', 'Noushki', 'Washuk'],
  },
  {
    id: 'sibi-division',
    name: 'Sibi Division',
    districts: ['Dera Bugti', 'Harnai', 'Kohlu', 'Sibi', 'Ziarat'],
  },
  {
    id: 'zhob-division',
    name: 'Zhob Division',
    districts: ['Killa Saifullah', 'Sherani', 'Zhob'],
  },
]

const districtToDivision = new Map(
  officialDivisions.flatMap((division) =>
    division.districts.map((district) => [district, division.name]),
  ),
)

const districtSheets = new Map(Object.entries({
  Awaran: 'Awaran',
  Barkhan: 'Barkhan',
  Chaman: 'Chaman',
  Chaghai: 'Chaghi',
  'Dera Bugti': 'Dera Bughti',
  Duki: 'Duki',
  Gwadar: 'Gawadar',
  Harnai: 'Harnai',
  Hub: 'Hub',
  Jaffarabad: 'Jaffarabad',
  'Jhal Magsi': 'Jhal Magsi',
  Kachhi: 'Kachhi',
  Kalat: 'Kalat',
  Kech: 'Kech',
  Kharan: 'Kharan',
  Khuzdar: 'Khuzdar',
  'Killa Abdullah': 'Killa Abdullah',
  'Killa Saifullah': 'QS',
  Kohlu: 'Kohlu',
  Lasbela: 'Lasbela',
  Loralai: 'LLI',
  Mastung: 'Mastung',
  'Musa Khel': 'Musa Khel',
  Naseerabad: 'Naseerabad',
  Noushki: 'Nushki',
  Panjgur: 'Panjgur',
  Pishin: 'Pishin',
  Quetta: 'Quetta',
  Sherani: 'Sherani',
  Sibi: 'Sibi',
  Sohbatpur: 'Sohbatpur',
  Surab: 'Surab',
  'Usta Muhammad': 'Usta Muhammad',
  Washuk: 'Washuk',
  Zhob: 'Zhob',
  Ziarat: 'Ziarat',
}))

function decodeXml(value = '') {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function xmlText(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return match ? decodeXml(match[1]) : ''
}

function columnIndex(ref = '') {
  const letters = String(ref).match(/[A-Z]+/i)?.[0]?.toUpperCase() || ''
  let index = 0
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
  return index
}

function normalizeText(value = '') {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w.%/()& +-]/g, '')
    .trim()
}

function toKey(value = '') {
  return normalizeText(value).toLowerCase()
}

function slugify(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value ?? '').replace(/,/g, '').trim()
  if (!text) return null
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function parseProgress(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return value <= 1.5 ? value * 100 : value
  }
  const text = String(value).trim().toLowerCase()
  if (!text) return null
  if (/complete|completed|yes|done/.test(text)) return 100
  const number = toNumber(text)
  if (number == null) return null
  return text.includes('%') || number > 1.5 ? number : number * 100
}

function parseCostToMillions(value = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value).replace(/,/g, '').trim().toLowerCase()
  const number = Number(text.match(/-?\d+(?:\.\d+)?/)?.[0] || 0)
  if (!Number.isFinite(number)) return 0
  if (/\bbn\b|billion/.test(text)) return number * 1000
  return number
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function stringifyCell(value) {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return normalizeText(value)
}

function formatCost(value) {
  const number = toNumber(value)
  if (number == null) return normalizeText(value)
  return `${Number(number.toFixed(number >= 100 ? 1 : number >= 10 ? 2 : 3)).toString()} Mn`
}

function categoryFromTitle(category, title) {
  const text = `${category} ${title}`.toLowerCase()
  if (/phe|wss|water|bore|tube.?well|filtration|ro plant/.test(text)) return category || 'PHE'
  if (/school|college|education|gbps|ggps|gbhs|gghs|ggms|bemis|it lab/.test(text)) return category || 'Education'
  if (/hospital|bhu|health|dhq|rhc|mch/.test(text)) return category || 'Health'
  if (/road|bridge|street|tuff|pcc/.test(text)) return category || 'Roads & Bridges'
  if (/solar|electr/.test(text)) return category || 'Energy & Solar'
  if (/irrigation|dam|karez|pond|channel/.test(text)) return category || 'Irrigation & Drainage'
  if (/wall|building|office|library|park|shed|washroom|toilet|boundary/.test(text)) return category || 'Buildings & Civic Works'
  return category || 'Infrastructure'
}

function get(row, col) {
  return row?.[col] ?? ''
}

function isPhaseMarker(row) {
  const text = toKey((row || []).join(' '))
  const compact = text.replace(/[^a-z0-9]/g, '')
  if (/phase\s*[- ]?\s*1/.test(text) || compact.includes('phase1')) return 'Phase 1'
  if (/phase\s*[- ]?\s*2/.test(text) || compact.includes('phase2')) return 'Phase 2'
  if (/phase\s*[- ]?\s*3/.test(text) || compact.includes('phase3')) return 'Phase 3'
  return ''
}

function findHeader(rows) {
  let best = { rowIndex: 0, score: 0, columns: {} }
  for (let i = 1; i < Math.min(rows.length, 24); i += 1) {
    const row = rows[i] || []
    const next = rows[i + 1] || []
    const labels = {}
    for (let col = 1; col <= Math.max(row.length, next.length, 32); col += 1) {
      labels[col] = toKey(`${row[col] || ''} ${next[col] || ''}`)
    }
    const columns = {}
    for (const [colText, colValue] of Object.entries(labels)) {
      const col = Number(colText)
      if (!columns.serial && /\bser(?:ial)?\b/.test(colValue)) columns.serial = col
      if (!columns.category && /(category|sector)/.test(colValue)) columns.category = col
      if (
        !columns.title &&
        /(description|title|name of project|scheme|project)/.test(colValue) &&
        !/(payment|progress|status)/.test(colValue)
      ) columns.title = col
      if (!columns.cost && /\bcost\b/.test(colValue)) columns.cost = col
      if (!columns.approvedPayment && /approved payment/.test(colValue)) columns.approvedPayment = col
      if (!columns.vendorPayment && /vendor payment/.test(colValue)) columns.vendorPayment = col
      if (!columns.approvedPayPercent && /approved pay.*%|approved.*percentage/.test(colValue)) columns.approvedPayPercent = col
      if (!columns.executingAgency && /executing agency|agency/.test(colValue)) columns.executingAgency = col
      if (!columns.tse && /\btse\b/.test(colValue)) columns.tse = col
      if (!columns.nitStatus && /\bnit/.test(colValue) && /status/.test(colValue)) columns.nitStatus = col
      if (!columns.nitOpening && /(opening date|date.*time)/.test(colValue)) columns.nitOpening = col
      if (!columns.techBid && /tech/.test(colValue)) columns.techBid = col
      if (!columns.finBid && /fin/.test(colValue)) columns.finBid = col
      if (!columns.workOrder && /(work o|work order)/.test(colValue)) columns.workOrder = col
      if (!columns.workStarted && /work started/.test(colValue)) columns.workStarted = col
      if (!columns.progress && /(progress|completed yes)/.test(colValue)) columns.progress = col
      if (!columns.remarks && /^remarks\b/.test(colValue)) columns.remarks = col
      if (!columns.contractor && /contractor/.test(colValue)) columns.contractor = col
      if (!columns.xen && /\bxen\b/.test(colValue)) columns.xen = col
      if (!columns.contact && /contact/.test(colValue)) columns.contact = col
      if (!columns.visitStatus && /visit status/.test(colValue)) columns.visitStatus = col
      if (!columns.visitRemarks && /visit remarks|remarks visit/.test(colValue)) columns.visitRemarks = col
      if (!columns.pictureLink && /picture link|image link|pic link/.test(colValue)) columns.pictureLink = col
      if (!columns.videoLink && /video link/.test(colValue)) columns.videoLink = col
    }
    const score = ['serial', 'title', 'cost', 'progress'].filter((key) => columns[key]).length
    if (score > best.score) best = { rowIndex: i, score, columns }
  }
  return best
}

function isDataRow(row, columns) {
  const title = normalizeText(get(row, columns.title))
  if (!title) return false
  const text = toKey(row.join(' '))
  if (/^(description|name of project|category|sector|phase|total|grand total|g\.?total)/.test(toKey(title))) return false
  if (/cancelled proj|cancelled project/.test(text)) return false
  return Boolean(columns.title && (columns.cost || columns.category || columns.progress))
}

function getProgressValue(row, columns, phase) {
  const direct = parseProgress(get(row, columns.progress))
  if (direct != null) return direct
  const fallbackColumns = phase === 'Phase 2' ? [15, 16, 14, 17] : [16, 15, 17]
  for (const col of fallbackColumns) {
    const candidate = parseProgress(get(row, col))
    if (candidate != null && candidate >= 0 && candidate <= 150) return candidate
  }
  return null
}

function makeSheetProject(row, columns, district, sheetName, rowIndex, phase) {
  const title = normalizeText(get(row, columns.title))
  const category = categoryFromTitle(normalizeText(get(row, columns.category)), title)
  const progressValue = getProgressValue(row, columns, phase)
  const progress = progressValue == null ? '' : `${Number(progressValue.toFixed(2)).toString()}%`
  const division = districtToDivision.get(district) || ''
  const serial = stringifyCell(get(row, columns.serial))
  const cost = formatCost(get(row, columns.cost))
  const scopeParts = [
    ['Executing agency', get(row, columns.executingAgency)],
    ['TSE', get(row, columns.tse)],
    ['NIT status', get(row, columns.nitStatus)],
    ['NIT opening', get(row, columns.nitOpening)],
    ['Tech bid', get(row, columns.techBid)],
    ['Fin bid', get(row, columns.finBid)],
    ['Work order', get(row, columns.workOrder)],
    ['Work started', get(row, columns.workStarted)],
    ['Approved payment', get(row, columns.approvedPayment)],
    ['Vendor payment', get(row, columns.vendorPayment)],
    ['Approved pay', get(row, columns.approvedPayPercent)],
    ['Contractor', get(row, columns.contractor)],
    ['XEN contact', get(row, columns.contact)],
  ]
    .filter(([, value]) => stringifyCell(value))
    .map(([label, value]) => `${label}: ${stringifyCell(value)}`)
  const remarks = stringifyCell(get(row, columns.remarks))
  const mediaLinks = [
    stringifyCell(get(row, columns.pictureLink)),
    stringifyCell(get(row, columns.videoLink)),
  ].filter(Boolean)

  return {
    phase,
    district,
    division,
    sourceSheet: sheetName,
    sourceRow: rowIndex,
    sourceSerial: serial,
    title,
    category,
    cost,
    progress,
    progressNumber: progressValue,
    executingAgency: stringifyCell(get(row, columns.executingAgency)),
    tse: stringifyCell(get(row, columns.tse)),
    nitStatus: stringifyCell(get(row, columns.nitStatus)),
    nitDate: stringifyCell(get(row, columns.nitOpening)),
    techBid: stringifyCell(get(row, columns.techBid)),
    finBid: stringifyCell(get(row, columns.finBid)),
    workOrder: stringifyCell(get(row, columns.workOrder)),
    workStarted: stringifyCell(get(row, columns.workStarted)),
    approvedPayment: stringifyCell(get(row, columns.approvedPayment)),
    vendorPayment: stringifyCell(get(row, columns.vendorPayment)),
    approvedPayPercent: stringifyCell(get(row, columns.approvedPayPercent)),
    contractor: stringifyCell(get(row, columns.contractor)),
    xen: stringifyCell(get(row, columns.xen)),
    contact: stringifyCell(get(row, columns.contact)),
    gps: stringifyCell(get(row, 21)),
    remarks,
    visitStatus: stringifyCell(get(row, columns.visitStatus)),
    visitRemarks: stringifyCell(get(row, columns.visitRemarks)),
    driveLink: mediaLinks.join('\n'),
    scope: scopeParts.join('; '),
    description: `${title} is recorded as a completed BSDI project under ${district}, ${division}.`,
  }
}

function readWorkbook(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const files = unzipSync(bytes)

  const readText = (filePath) => {
    const file = files[filePath]
    if (!file) throw new Error(`Workbook part is missing: ${filePath}`)
    return strFromU8(file)
  }

  const optionalText = (filePath) => {
    const file = files[filePath]
    return file ? strFromU8(file) : ''
  }

  const workbookXml = readText('xl/workbook.xml')
  const relsXml = readText('xl/_rels/workbook.xml.rels')
  const sharedStrings = []
  const sharedXml = optionalText('xl/sharedStrings.xml')
  if (sharedXml) {
    for (const item of sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) {
      const text = [...item[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((match) => decodeXml(match[1]))
        .join('')
      sharedStrings.push(text)
    }
  }

  const rels = new Map()
  for (const rel of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = Object.fromEntries(
      [...rel[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
    )
    rels.set(attrs.Id, attrs.Target)
  }

  const sheets = []
  for (const sheet of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attrs = Object.fromEntries(
      [...sheet[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], decodeXml(match[2])]),
    )
    const target = rels.get(attrs['r:id'])
    const fullPath = target?.startsWith('/') ? target.slice(1) : `xl/${target}`
    sheets.push({ name: attrs.name, id: attrs.sheetId, path: fullPath })
  }

  function readSheet(name) {
    const sheet = sheets.find((item) => item.name === name)
    if (!sheet) throw new Error(`Sheet not found: ${name}`)
    const xml = readText(sheet.path)
    const rows = []
    for (const rowMatch of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const rowIndex = Number(rowMatch[1])
      const row = []
      for (const cell of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = Object.fromEntries(
          [...cell[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
        )
        const ref = attrs.r || ''
        const col = columnIndex(ref)
        const type = attrs.t
        let value
        if (type === 'inlineStr') {
          value = xmlText(cell[2], 't')
        } else {
          const raw = xmlText(cell[2], 'v')
          if (type === 's') value = sharedStrings[Number(raw)] ?? ''
          else if (type === 'b') value = raw === '1'
          else value = raw
        }
        const numeric = type ? null : Number(value)
        row[col] = Number.isFinite(numeric) && String(value).trim() !== '' ? numeric : decodeXml(value)
      }
      rows[rowIndex] = row
    }
    return rows
  }

  return { sheets, readSheet }
}

export function extractCompletedProjectsFromWorkbook(buffer, options = {}) {
  const threshold = Number(options.threshold || COMPLETED_THRESHOLD)
  const workbook = readWorkbook(buffer)
  const allProjects = []
  const completedProjects = []
  const audits = []
  const missingSheets = []

  for (const [district, sheetName] of districtSheets) {
    let rows
    try {
      rows = workbook.readSheet(sheetName)
    } catch (error) {
      missingSheets.push({ district, sheetName, error: error.message })
      continue
    }

    const header = findHeader(rows)
    let phase = district === 'Quetta' ? 'Phase 2' : 'Phase 1'
    const rowProjects = []

    for (let i = Math.max(1, header.rowIndex); i < rows.length; i += 1) {
      const row = rows[i] || []
      if (district === 'Musa Khel' && i >= 20) phase = 'Phase 2'
      const marker = isPhaseMarker(row)
      if (marker) {
        phase = marker
        continue
      }
      if (!isDataRow(row, header.columns)) continue
      const project = makeSheetProject(row, header.columns, district, sheetName, i, phase)
      if (!project.title) continue
      rowProjects.push(project)
      allProjects.push(project)
      if (project.progressNumber != null && project.progressNumber >= threshold) {
        completedProjects.push(project)
      }
    }

    audits.push({
      district,
      sheetName,
      headerRow: header.rowIndex,
      score: header.score,
      rows: rowProjects.length,
      completed: rowProjects.filter((project) => project.progressNumber != null && project.progressNumber >= threshold).length,
      phase1Completed: rowProjects.filter((project) => project.phase === 'Phase 1' && project.progressNumber != null && project.progressNumber >= threshold).length,
      phase2Completed: rowProjects.filter((project) => project.phase === 'Phase 2' && project.progressNumber != null && project.progressNumber >= threshold).length,
      phase3Completed: rowProjects.filter((project) => project.phase === 'Phase 3' && project.progressNumber != null && project.progressNumber >= threshold).length,
    })
  }

  return {
    workbookSheets: workbook.sheets.length,
    districtSheetCount: districtSheets.size,
    missingSheets,
    audits,
    allProjects,
    completedProjects,
  }
}

function projectSourceKey(project = {}) {
  const row = project.sourceRow || project.sourceSerial || ''
  const sheet = project.sourceSheet || project.district || ''
  return `${project.phase || 'Phase 1'}|${toKey(sheet)}|${row}`
}

function projectTitleKey(project = {}) {
  return `${project.phase || 'Phase 1'}|${toKey(project.district)}|${slugify(project.title || '')}`
}

function legacySourceKey(project = {}) {
  return `${toKey(project.district)}-row-${project.sourceRow || ''}`
}

function phaseId(phase) {
  return slugify(phase || 'Phase 1')
}

function phasePrefix(phase) {
  return `p${String(phase || 'Phase 1').match(/\d+/)?.[0] || '1'}`
}

function projectSearchText(project) {
  return [
    project.title,
    project.district,
    project.division,
    project.category,
    project.cost,
    project.progress,
    project.executingAgency,
    project.contractor,
    project.xen,
    project.gps,
    project.remarks,
    project.scope,
  ]
    .filter(Boolean)
    .join(' ')
}

function cleanMediaForProject(media = [], projectId) {
  return (Array.isArray(media) ? media : []).map((item, index) => ({
    ...item,
    projectId,
    order: item.order || index + 1,
  }))
}

function mediaRefs(media = []) {
  return {
    mediaIds: media.map((item) => item.id).filter(Boolean),
    imageIds: media.filter((item) => item.type !== 'video').map((item) => item.id).filter(Boolean),
    videoIds: media.filter((item) => item.type === 'video').map((item) => item.id).filter(Boolean),
  }
}

function dashboardProjectFromSheet(raw, existing, usedIds) {
  const division = districtToDivision.get(raw.district) || raw.division || ''
  const generatedId = [
    'sheet',
    phasePrefix(raw.phase),
    slugify(division),
    slugify(raw.district),
    `r${String(raw.sourceRow || raw.sourceSerial || 0).padStart(3, '0')}`,
    slugify(raw.title).slice(0, 90),
  ]
    .filter(Boolean)
    .join('-')
  let id = existing?.id || generatedId
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${generatedId}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)

  const media = cleanMediaForProject(existing?.media || [], id)
  const refs = mediaRefs(media)
  const progress = raw.progress || '100%'
  const description =
    raw.description ||
    `${raw.title} is treated as a completed BSDI project because it is ${progress} complete. It is recorded under ${raw.district}, ${division}.`

  return {
    ...(existing || {}),
    id,
    legacyId: existing?.legacyId || `google-sheet-${raw.phase}-${raw.sourceSheet}-row-${raw.sourceRow}`,
    phaseId: phaseId(raw.phase),
    phase: raw.phase,
    slide: existing?.slide || raw.sourceRow,
    title: raw.title,
    description,
    divisionId: slugify(division),
    division,
    districtId: slugify(raw.district),
    district: raw.district,
    category: raw.category || existing?.category || 'Infrastructure',
    cost: raw.cost || existing?.cost || '',
    duration: existing?.duration || '',
    nitDate: raw.nitDate || existing?.nitDate || '',
    contractor: raw.contractor || existing?.contractor || '',
    workOrder: raw.workOrder || existing?.workOrder || '',
    focalOfficer: raw.executingAgency || existing?.focalOfficer || '',
    progress,
    beneficiary: existing?.beneficiary || '',
    xen: raw.xen || existing?.xen || '',
    scope: raw.scope || existing?.scope || '',
    driveLink: raw.driveLink || existing?.driveLink || '',
    executingAgency: raw.executingAgency || existing?.executingAgency || '',
    tse: raw.tse || existing?.tse || '',
    nitStatus: raw.nitStatus || existing?.nitStatus || '',
    techBid: raw.techBid || existing?.techBid || '',
    finBid: raw.finBid || existing?.finBid || '',
    workStarted: raw.workStarted || existing?.workStarted || '',
    approvedPayment: raw.approvedPayment || existing?.approvedPayment || '',
    vendorPayment: raw.vendorPayment || existing?.vendorPayment || '',
    approvedPayPercent: raw.approvedPayPercent || existing?.approvedPayPercent || '',
    contact: raw.contact || existing?.contact || '',
    gps: raw.gps || existing?.gps || '',
    visitStatus: raw.visitStatus || existing?.visitStatus || '',
    remarks: raw.remarks || raw.visitRemarks || existing?.remarks || '',
    sourceSheet: raw.sourceSheet,
    sourceRow: raw.sourceRow,
    sourceSerial: raw.sourceSerial,
    sourceType: 'google-sheet',
    sourceProgress: raw.progress,
    sourceProgressNumber: raw.progressNumber,
    searchText: projectSearchText({ ...raw, division, progress }),
    ...refs,
    media,
  }
}

function catalogDistricts(projects) {
  return officialDivisions.flatMap((division) =>
    division.districts.map((district) => ({
      id: slugify(district),
      name: district,
      projectCount: projects.filter((project) => project.district === district).length,
      divisions: [division.name],
    })),
  )
}

function catalogDivisions(projects) {
  return officialDivisions.map((division) => ({
    ...division,
    projectCount: projects.filter((project) => project.division === division.name).length,
  }))
}

function catalogPhases(projects, existingPhases = []) {
  const phaseNames = unique([
    'Phase 1',
    'Phase 2',
    'Phase 3',
    ...existingPhases.map((phase) => (typeof phase === 'string' ? phase : phase?.name)),
    ...projects.map((project) => project.phase),
  ])
  return phaseNames.map((name) => {
    const phaseProjects = projects.filter((project) => (project.phase || 'Phase 1') === name)
    return {
      id: phaseId(name),
      name,
      status: existingPhases.find((phase) => phase?.name === name)?.status || 'completed',
      projectCount: phaseProjects.length,
      projectIds: phaseProjects.map((project) => project.id),
    }
  })
}

function dashboardTotals(projects, divisions, districts) {
  const media = projects.flatMap((project) => (Array.isArray(project.media) ? project.media : []))
  const budgetMn = projects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0)
  return {
    projects: projects.length,
    divisions: divisions.length,
    districts: districts.length,
    media: media.length,
    images: media.filter((item) => item.type !== 'video').length,
    videos: media.filter((item) => item.type === 'video').length,
    budgetBn: Number((budgetMn / 1000).toFixed(3)),
  }
}

export function mergeCompletedSheetProjects(currentState = {}, sheetProjects = [], options = {}) {
  const currentProjects = Array.isArray(currentState.projects) ? currentState.projects : []
  const bySource = new Map()
  const byTitle = new Map()
  const byLegacy = new Map()
  const usedExistingIds = new Set()

  for (const project of currentProjects) {
    if (!bySource.has(projectSourceKey(project))) bySource.set(projectSourceKey(project), project)
    if (!byTitle.has(projectTitleKey(project))) byTitle.set(projectTitleKey(project), project)
    if (project.legacyId && !byLegacy.has(toKey(project.legacyId))) byLegacy.set(toKey(project.legacyId), project)
  }

  const usedIds = new Set()
  const nextProjects = []
  let added = 0
  let updated = 0
  let unchanged = 0

  for (const raw of sheetProjects) {
    const legacyKey = `google-sheet-${raw.phase}-${raw.sourceSheet}-row-${raw.sourceRow}`
    const existing =
      bySource.get(projectSourceKey(raw)) ||
      byTitle.get(projectTitleKey(raw)) ||
      byLegacy.get(toKey(legacyKey)) ||
      byLegacy.get(legacySourceKey(raw))

    const nextProject = dashboardProjectFromSheet(raw, existing, usedIds)
    nextProjects.push(nextProject)

    if (existing) {
      usedExistingIds.add(existing.id)
      const before = JSON.stringify({ ...existing, _serverRevision: undefined })
      const after = JSON.stringify({ ...nextProject, _serverRevision: undefined })
      if (before === after) unchanged += 1
      else updated += 1
    } else {
      added += 1
    }
  }

  for (const project of currentProjects) {
    if (!usedExistingIds.has(project.id)) {
      let id = project.id
      let suffix = 2
      while (usedIds.has(id)) {
        id = `${project.id}-${suffix}`
        suffix += 1
      }
      usedIds.add(id)
      nextProjects.push(id === project.id ? project : { ...project, id })
    }
  }

  const phases = catalogPhases(nextProjects, currentState.phases || [])
  const divisions = catalogDivisions(nextProjects)
  const districts = catalogDistricts(nextProjects)
  const now = new Date().toISOString()
  const completedByPhase = sheetProjects.reduce((acc, project) => {
    acc[project.phase] = (acc[project.phase] || 0) + 1
    return acc
  }, {})

  const nextState = {
    ...currentState,
    schemaVersion: Math.max(Number(currentState.schemaVersion) || 0, 3),
    databaseName: currentState.databaseName || 'bsdi-completed-projects',
    updatedAt: now,
    source: {
      ...(currentState.source || {}),
      googleSheet: {
        spreadsheetId: options.spreadsheetId || DEFAULT_GOOGLE_SHEET_ID,
        url: options.url || DEFAULT_GOOGLE_SHEET_URL,
        completedThreshold: options.threshold || COMPLETED_THRESHOLD,
        districtSheets: districtSheets.size,
        lastSyncAt: now,
        completedRows: sheetProjects.length,
        completedByPhase,
        added,
        updated,
        unchanged,
        missingSheets: options.missingSheets || [],
      },
    },
    settings: {
      ...(currentState.settings || {}),
      googleSheet: {
        ...(currentState.settings?.googleSheet || {}),
        spreadsheetId: options.spreadsheetId || DEFAULT_GOOGLE_SHEET_ID,
        url: options.url || DEFAULT_GOOGLE_SHEET_URL,
        completedThreshold: options.threshold || COMPLETED_THRESHOLD,
        autoSync: true,
      },
    },
    projects: nextProjects,
    phases,
    divisions,
    districts,
    totals: dashboardTotals(nextProjects, divisions, districts),
  }

  return {
    data: nextState,
    summary: {
      added,
      updated,
      unchanged,
      sheetCompleted: sheetProjects.length,
      totalProjects: nextProjects.length,
      completedByPhase,
      changed: added > 0 || updated > 0,
    },
  }
}

export function googleSheetExportUrl(spreadsheetId = DEFAULT_GOOGLE_SHEET_ID) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`
}

export async function fetchGoogleSheetWorkbook(config = {}) {
  const spreadsheetId = config.spreadsheetId || DEFAULT_GOOGLE_SHEET_ID
  const exportUrl = config.exportUrl || googleSheetExportUrl(spreadsheetId)
  const timeoutMs = Number(config.timeoutMs || 120000)
  const controller = new globalThis.AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await globalThis.fetch(exportUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'BSDI Completed Projects Google Sheet Sync',
      },
    })
    if (!response.ok) {
      throw new Error(`Google Sheet export failed with HTTP ${response.status}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/html') && bytes.length < 1024 * 1024) {
      throw new Error('Google Sheet export returned HTML. Make sure the sheet is shared/exportable.')
    }
    return bytes
  } finally {
    clearTimeout(timeout)
  }
}

export async function syncCompletedProjectsFromGoogleSheet(currentState = {}, config = {}) {
  const spreadsheetId = config.spreadsheetId || DEFAULT_GOOGLE_SHEET_ID
  const sourceUrl = config.url || DEFAULT_GOOGLE_SHEET_URL
  const workbook = config.workbook || await fetchGoogleSheetWorkbook({ ...config, spreadsheetId })
  const extracted = extractCompletedProjectsFromWorkbook(workbook, {
    threshold: config.threshold || COMPLETED_THRESHOLD,
  })
  const merged = mergeCompletedSheetProjects(currentState, extracted.completedProjects, {
    spreadsheetId,
    url: sourceUrl,
    threshold: config.threshold || COMPLETED_THRESHOLD,
    missingSheets: extracted.missingSheets,
  })
  return {
    ...merged,
    extracted: {
      workbookSheets: extracted.workbookSheets,
      districtSheetCount: extracted.districtSheetCount,
      missingSheets: extracted.missingSheets,
      audits: extracted.audits,
      allRows: extracted.allProjects.length,
      completedRows: extracted.completedProjects.length,
    },
  }
}
