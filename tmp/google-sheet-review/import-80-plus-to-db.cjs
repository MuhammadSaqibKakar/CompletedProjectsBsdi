const fs = require('fs')
const path = require('path')

const root = process.cwd()
const dbPath = path.join(root, 'public', 'database', 'bsdi-db.json')
const inputPath = path.join(root, 'tmp', 'google-sheet-review', 'progress-80-plus-projects.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
}

function slugify(value, maxLength = 80) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
}

function normalizeDistrict(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/bughti/g, 'bugti')
    .replace(/chaghi|chagai/g, 'chaghai')
    .replace(/^qs$/g, 'killa saifullah')
    .replace(/qilla/g, 'killa')
    .replace(/nushki/g, 'noushki')
    .replace(/sorab/g, 'surab')
    .replace(/gawadar/g, 'gwadar')
    .replace(/musakhel/g, 'musa khel')
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bwss\b/g, 'water supply scheme')
    .replace(/\bconst\b|\bconstr\b|\bconstt\b/g, 'construction')
    .replace(/\brenov\b|\brenovation\b/g, 'renovation')
    .replace(/\breh\b|\brehab\b/g, 'rehabilitation')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(
      /\b(the|of|and|at|in|for|to|from|with|a|an|no|number|scheme|project|proj|district)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenScore(a, b) {
  const left = new Set(normalizeText(a).split(' ').filter((item) => item.length > 1))
  const right = new Set(normalizeText(b).split(' ').filter((item) => item.length > 1))
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return 0
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  const number = match ? Number(match[0]) : 0
  return Number.isFinite(number) ? number : 0
}

function formatCost(value) {
  const number = parseNumber(value)
  return number ? `${number} Mn` : ''
}

function formatPercent(value) {
  const number = parseNumber(value)
  if (!number) return ''
  return `${Math.round(number)}%`
}

function cleanValue(value) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/""/g, '"')
    .trim()
    .replace(/^"+|"+$/g, '')
    .trim()
  return text === '-' ? '' : text
}

function buildScope(row) {
  const details = [
    ['Executing agency', row.ExecutingAgency],
    ['TSE', row.TSE],
    ['NIT status', row.NITStatus],
    ['NIT opening', row.NITOpening],
    ['Tech bid', row.TechBid],
    ['Fin bid', row.FinBid],
    ['Work order', row.WorkOrderDate],
    ['Work started', row.WorkStartedDate],
    ['Approved payment', row.ApprovedPayment],
    ['Vendor payment', row.VendorPayment],
    ['Approved pay', row.ApprovedPayPercent ? `${Math.round(parseNumber(row.ApprovedPayPercent) * 100)}%` : ''],
    ['Contractor', row.Contractor],
    ['XEN contact', row.Contact],
    ['GPS', row.GPS],
    ['Visit status', row.VisitStatus],
    ['Remarks', row.Remarks],
  ]
    .map(([label, value]) => [label, cleanValue(value)])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)

  return details.join('; ')
}

const divisionCatalog = [
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
    name: 'Rakshan Division',
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

const districtToDivision = new Map()
for (const division of divisionCatalog) {
  for (const district of division.districts) {
    districtToDivision.set(normalizeDistrict(district), division)
  }
}

const previousDb = readJson(dbPath)
const sheetRows = readJson(inputPath)
const usedPreviousIds = new Set()

const previousByDistrict = new Map()
for (const project of previousDb.projects || []) {
  const key = normalizeDistrict(project.district)
  if (!previousByDistrict.has(key)) previousByDistrict.set(key, [])
  previousByDistrict.get(key).push(project)
}

function findPreviousProject(row) {
  const candidates = previousByDistrict.get(normalizeDistrict(row.District)) || []
  let best = { score: 0, project: null }
  for (const candidate of candidates) {
    if (usedPreviousIds.has(candidate.id)) continue
    const score = tokenScore(row.Title, candidate.title)
    if (score > best.score) best = { score, project: candidate }
  }
  if (best.score >= 0.66) {
    usedPreviousIds.add(best.project.id)
    return best.project
  }
  return null
}

const projects = []
for (const row of sheetRows) {
  const division = districtToDivision.get(normalizeDistrict(row.District))
  if (!division) {
    throw new Error(`No division mapped for district: ${row.District}`)
  }

  const phase = row.Phase === 'Phase 2' ? 'Phase 2' : 'Phase 1'
  const phaseId = phase === 'Phase 2' ? 'phase-2' : 'phase-1'
  const districtId = slugify(row.District)
  const id = [
    phase === 'Phase 2' ? 'p2' : 'p1',
    slugify(division.name, 35),
    districtId,
    `r${String(row.Row).padStart(3, '0')}`,
    slugify(row.Title, 55),
  ]
    .filter(Boolean)
    .join('-')

  const previousProject = findPreviousProject(row)
  const media = (previousProject?.media || []).map((item) => ({
    ...item,
    projectId: id,
  }))
  const imageIds = media.filter((item) => item.type !== 'video').map((item) => item.id)
  const videoIds = media.filter((item) => item.type === 'video').map((item) => item.id)
  const progress = formatPercent(row.ProgressPercent)
  const cost = formatCost(row.CostMn)
  const title = cleanValue(row.Title) || 'Untitled BSDI project'
  const category = cleanValue(row.Category) || 'Uncategorized'
  const description = `${title} is treated as a completed BSDI project because it is ${progress || '80%+'} complete. It is recorded under ${row.District}, ${division.name}.`
  const scope = buildScope(row)

  projects.push({
    id,
    legacyId: `${row.Sheet}-row-${row.Row}`,
    phaseId,
    phase,
    slide: Number(row.Row) || '',
    title,
    description,
    divisionId: division.id,
    division: division.name,
    districtId,
    district: row.District,
    category,
    cost,
    duration: '',
    nitDate: cleanValue(row.NITOpening),
    contractor: cleanValue(row.Contractor),
    workOrder: cleanValue(row.WorkOrderDate),
    focalOfficer: cleanValue(row.ExecutingAgency),
    progress,
    xen: cleanValue(row.XEN),
    scope,
    driveLink: '',
    executingAgency: cleanValue(row.ExecutingAgency),
    tse: cleanValue(row.TSE),
    nitStatus: cleanValue(row.NITStatus),
    techBid: cleanValue(row.TechBid),
    finBid: cleanValue(row.FinBid),
    workStarted: cleanValue(row.WorkStartedDate),
    approvedPayment: cleanValue(row.ApprovedPayment),
    vendorPayment: cleanValue(row.VendorPayment),
    approvedPayPercent: cleanValue(row.ApprovedPayPercent),
    contact: cleanValue(row.Contact),
    gps: cleanValue(row.GPS),
    visitStatus: cleanValue(row.VisitStatus),
    remarks: cleanValue(row.Remarks),
    sourceSheet: row.Sheet,
    sourceRow: Number(row.Row) || '',
    sourceSerial: cleanValue(row.Serial),
    searchText: [
      title,
      row.District,
      division.name,
      category,
      cost,
      progress,
      row.ExecutingAgency,
      row.Contractor,
      row.XEN,
      row.GPS,
      row.Remarks,
    ]
      .filter(Boolean)
      .join(' '),
    mediaIds: media.map((item) => item.id),
    imageIds,
    videoIds,
    media,
  })
}

const totalCostMn = projects.reduce((sum, project) => sum + parseNumber(project.cost), 0)
const flatMedia = projects.flatMap((project) => project.media || [])
const imageCount = flatMedia.filter((item) => item.type !== 'video').length
const videoCount = flatMedia.filter((item) => item.type === 'video').length
const phase1Ids = projects.filter((project) => project.phase === 'Phase 1').map((project) => project.id)
const phase2Ids = projects.filter((project) => project.phase === 'Phase 2').map((project) => project.id)

const divisions = divisionCatalog.map((division) => ({
  ...division,
  projectCount: projects.filter((project) => project.division === division.name).length,
}))

const districtNames = divisionCatalog.flatMap((division) => division.districts)
const districts = districtNames
  .slice()
  .sort((a, b) => a.localeCompare(b))
  .map((district) => ({
    id: slugify(district),
    name: district,
    projectCount: projects.filter((project) => project.district === district).length,
    divisions: [districtToDivision.get(normalizeDistrict(district)).name],
  }))

const importedDb = {
  schemaVersion: 2,
  databaseName: 'bsdi-completed-projects',
  generatedAt: new Date().toISOString(),
  source: {
    file: 'Google Sheet: 1wFiY9w9OiWgKWosE9cZNoIwfKz92-_NxTga_RwQuG6c',
    date: '15 May 2026',
    rule: '% Progress >= 80%',
    importedFrom: 'tmp/google-sheet-review/progress-80-plus-projects.csv',
    previousSourceFile:
      previousDb.source?.previousSourceFile &&
      !previousDb.source.previousSourceFile.startsWith('Google Sheet')
        ? previousDb.source.previousSourceFile
        : previousDb.source?.file?.startsWith('Google Sheet')
          ? 'Completed_BSDI-14-03-2026.pptx'
          : previousDb.source?.file || '',
  },
  settings: {
    ...(previousDb.settings || {}),
    adminPassword: previousDb.settings?.adminPassword || previousDb.settings?.admin?.password || '',
    editable: {
      phases: true,
      divisions: true,
      districts: true,
      ...(previousDb.settings?.editable || {}),
    },
    storage: {
      localStateKey: 'bsdi-dashboard-state-v1',
      ...(previousDb.settings?.storage || {}),
    },
  },
  totals: {
    projects: projects.length,
    divisions: divisions.length,
    districts: districts.length,
    media: flatMedia.length,
    images: imageCount,
    videos: videoCount,
    budgetBn: Number((totalCostMn / 1000).toFixed(3)),
  },
  phases: [
    {
      id: 'phase-1',
      name: 'Phase 1',
      status: 'completed',
      projectCount: phase1Ids.length,
      projectIds: phase1Ids,
    },
    {
      id: 'phase-2',
      name: 'Phase 2',
      status: 'completed',
      projectCount: phase2Ids.length,
      projectIds: phase2Ids,
    },
  ],
  divisions,
  districts,
  projects,
  media: flatMedia,
}

fs.writeFileSync(dbPath, `${JSON.stringify(importedDb, null, 2)}\n`, 'utf8')

console.log(
  JSON.stringify(
    {
      projects: projects.length,
      phase1: phase1Ids.length,
      phase2: phase2Ids.length,
      districts: districts.length,
      divisions: divisions.length,
      budgetBn: importedDb.totals.budgetBn,
      preservedMediaProjects: projects.filter((project) => project.media.length).length,
      preservedMediaItems: flatMedia.length,
      previousMediaProjectsMatched: usedPreviousIds.size,
    },
    null,
    2,
  ),
)
