import { AnimatePresence, motion } from 'framer-motion'
import { unzipSync } from 'fflate'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  ChartColumnIncreasing,
  ChartPie,
  Check,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  CloudOff,
  ExternalLink,
  FileJson,
  FolderOpen,
  Image as ImageIcon,
  Info,
  LockKeyhole,
  MapPin,
  MapPinned,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Tags,
  TableProperties,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const FALLBACK_ADMIN_PASSWORD = ''
const STORAGE_KEY = 'bsdi-dashboard-state-v1'
const PENDING_SYNC_KEY = 'bsdi-dashboard-pending-sync-v1'
const LAST_SYNC_KEY = 'bsdi-dashboard-last-sync-v1'
const CONFLICT_BACKUP_KEY_PREFIX = 'bsdi-dashboard-conflict-backup-'
const LEGACY_PROJECT_KEYS = ['bsdi-dashboard-projects-v6', 'bsdi-dashboard-projects-v5']
const MEDIA_DB_NAME = 'bsdi-dashboard-media'
const MEDIA_STORE_NAME = 'files'
const MEDIA_CACHE_NAME = 'bsdi-media'
const API_BASE_URL = (import.meta.env.VITE_BSDI_API_BASE_URL || '').replace(/\/+$/, '')
const API_STATE_ENDPOINT = `${API_BASE_URL}/api/state`
const API_MEDIA_ENDPOINT = `${API_BASE_URL}/api/media`
const API_REPORT_ENDPOINT = `${API_BASE_URL}/api/report/pdf`
const API_REPORT_STATUS_ENDPOINT = `${API_BASE_URL}/api/report/status`
const API_UNAVAILABLE_MESSAGE = 'Shared sync server is not enabled on this deployment'
const BRAND_LOGO = '/brand/bsdi-logo.png'
const BALOCHISTAN_MAP = '/brand/balochistan-district-map-print.jpg'
const LANDMARK_CARDS = [
  { src: '/brand/landmark-gate.png', alt: 'Balochistan gateway landmark' },
  { src: '/brand/landmark-princess-of-hope.png', alt: 'Princess of Hope' },
  { src: '/brand/landmark-residency.png', alt: 'Quaid-e-Azam Residency' },
  { src: '/brand/landmark-fort.png', alt: 'Balochistan fort landmark' },
]
const MAP_POINTS = {
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
const phaseOptions = ['Total', 'Phase 1', 'Phase 2', 'Phase 3']
const projectPhaseOptions = phaseOptions.filter((phase) => phase !== 'Total')
const DISTRICT_FILTER_ALL = 'All Districts'
const pakistanDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Karachi',
})
const pakistanTimestampFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Karachi',
})

const fieldList = [
  ['title', 'Project title', 'text'],
  ['phase', 'Phase', 'text'],
  ['category', 'Category', 'text'],
  ['beneficiary', 'Beneficiary', 'text'],
  ['cost', 'Cost', 'text'],
  ['progress', 'Progress', 'text'],
  ['duration', 'Duration', 'text'],
  ['contractor', 'Contractor', 'text'],
  ['nitDate', 'NIT date', 'text'],
  ['workOrder', 'Work order', 'text'],
  ['focalOfficer', 'Executing agency', 'text'],
  ['xen', 'XEN', 'text'],
  ['driveLink', 'Drive folder link', 'text'],
]

const ENGINEER_ASSESSMENT_OPTIONS = [
  'For benefit of people',
  'For political cause',
  'Highly recommended by military',
  'Urgent public need',
  'Technically feasible',
  'Needs field verification',
  'Duplicate / overlap',
  'Low priority',
]

const RECOMMENDATION_OPTIONS = ['Yes', 'No']

const PROPOSAL_HEADER_ALIASES = {
  serial: ['#', 'serial', 'sr', 'sno', 'srno'],
  description: ['description', 'projectdescription', 'project', 'name', 'projectname'],
  district: ['district'],
  category: ['category', 'sector'],
  phase: ['phase'],
  costMn: ['costmn', 'cost', 'estimatedcost', 'estimatedcostmn'],
  executingAgency: ['executingagency', 'agency', 'department'],
  status: ['status'],
  submittedBy: ['submittedby'],
  submittedAt: ['submittedat'],
  piuForwardedBy: ['piuforwardedby'],
  piuForwardedAt: ['piuforwardedat'],
  pscReviewedBy: ['pscreviewedby'],
  pscReviewedAt: ['pscreviewedat'],
  rejectionReason: ['pscpiurejectionreason', 'rejectionreason'],
  projectId: ['projectid', 'id'],
  sourceRemarks: ['remarks', 'sourceRemarks'],
  assessedByEngr: ['asstbyengr', 'assessedbyengr', 'asstbyengineer', 'assessmentbyengr', 'asstbynegr'],
  recommendation: ['recommendation', 'recommended', 'yesno'],
  remarksComd: ['remarkscomd', 'comdremarks', 'remarkscommand', 'commandremarks'],
}

function createBlankProject(divisions) {
  const id = `project-${Date.now()}`
  return {
    id,
    slide: '',
    title: 'New BSDI project',
    phase: 'Phase 1',
    division: divisions[0] || 'Kalat Division',
    district: '',
    category: 'Infrastructure',
    beneficiary: '',
    cost: '',
    duration: '',
    nitDate: '',
    contractor: '',
    workOrder: '',
    focalOfficer: '',
    progress: '',
    xen: '',
    scope: '',
    driveLink: '',
    searchText: '',
    media: [],
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function getPakistanDisplayDate() {
  return pakistanDateFormatter.format(new Date())
}

function getPakistanPrintTimestamp(date = new Date()) {
  return pakistanTimestampFormatter.format(date)
}

function toId(value) {
  return String(value || 'item')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `item-${Date.now()}`
}

function compactKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9#]+/g, '')
}

function cleanCellText(value) {
  if (value == null) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) return getPakistanPrintTimestamp(value)
  const text = String(value).replace(/\r\n/g, '\n').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim()
  return ['—', '-', 'nil', 'n/a', 'na', 'null'].includes(text.toLowerCase()) ? '' : text
}

function proposalDocumentId(fileName = 'proposal') {
  const now = new Date()
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now).map((part) => [part.type, part.value]),
  )
  const stamp = `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`
  return `proposal-${stamp}-${toId(fileName).slice(0, 42)}`
}

function proposalUploadLabel(date = new Date()) {
  return getPakistanPrintTimestamp(date)
}

function getProposalColumnIndex(headers, field) {
  const aliases = PROPOSAL_HEADER_ALIASES[field] || [field]
  const normalized = headers.map(compactKey)
  return normalized.findIndex((header) => aliases.some((alias) => header === compactKey(alias)))
}

function findProposalHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const normalized = row.map(compactKey)
    return normalized.includes('description') && normalized.includes('district') && normalized.some((item) => item.includes('cost'))
  })
}

function cleanProposalRow(row = {}, fallbackIndex = 0, documentId = '') {
  const id = row.id || `${documentId || 'proposal'}-row-${String(fallbackIndex + 1).padStart(4, '0')}`
  const costMn = Number(row.costMn) || parseCostToMillions(row.costText || row.cost)
  return {
    id,
    serial: cleanCellText(row.serial) || String(fallbackIndex + 1),
    description: cleanCellText(row.description),
    district: cleanCellText(row.district),
    category: cleanCellText(row.category),
    phase: cleanCellText(row.phase) || 'Phase-3',
    costText: cleanCellText(row.costText || row.costMn || row.cost),
    costMn,
    executingAgency: cleanCellText(row.executingAgency),
    status: cleanCellText(row.status),
    submittedBy: cleanCellText(row.submittedBy),
    submittedAt: cleanCellText(row.submittedAt),
    piuForwardedBy: cleanCellText(row.piuForwardedBy),
    piuForwardedAt: cleanCellText(row.piuForwardedAt),
    pscReviewedBy: cleanCellText(row.pscReviewedBy),
    pscReviewedAt: cleanCellText(row.pscReviewedAt),
    rejectionReason: cleanCellText(row.rejectionReason),
    projectId: cleanCellText(row.projectId),
    sourceRemarks: cleanCellText(row.sourceRemarks),
    assessedByEngr: cleanCellText(row.assessedByEngr),
    recommendation: RECOMMENDATION_OPTIONS.includes(row.recommendation) ? row.recommendation : '',
    remarksComd: cleanCellText(row.remarksComd),
  }
}

function cleanProposalDocument(document = {}) {
  const id = document.id || proposalDocumentId(document.fileName || document.title || 'proposal')
  const rows = (document.rows || [])
    .map((row, index) => cleanProposalRow(row, index, id))
    .filter((row) => row.description || row.district || row.costMn)
  const totalCostMn = rows.reduce((sum, row) => sum + (Number(row.costMn) || 0), 0)
  const districts = unique(rows.map((row) => row.district))
  const categories = unique(rows.map((row) => row.category))
  return {
    id,
    title: cleanCellText(document.title) || cleanCellText(document.fileName) || 'Proposal document',
    fileName: cleanCellText(document.fileName),
    uploadedAt: document.uploadedAt || new Date().toISOString(),
    uploadedLabel: document.uploadedLabel || proposalUploadLabel(new Date(document.uploadedAt || Date.now())),
    sheetName: cleanCellText(document.sheetName) || 'Project Proposals',
    rowCount: rows.length,
    totalCostMn,
    totalCost: formatCostMillions(totalCostMn),
    districts,
    categories,
    rows,
  }
}

function cleanProposalDocuments(documents = []) {
  return [...documents]
    .map(cleanProposalDocument)
    .filter((document) => document.rows.length)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
}

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
}

function xmlAttr(attrs = '', name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = attrs.match(new RegExp(`${escaped}="([^"]*)"`))
  return match ? decodeXmlEntities(match[1]) : ''
}

function textFromXmlParts(xml = '') {
  const values = []
  xml.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, text) => {
    values.push(decodeXmlEntities(text))
    return ''
  })
  return values.join('')
}

function columnIndexFromCellRef(ref = '') {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A'
  return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1
}

function readWorkbookXmlFiles(buffer) {
  const decoder = new TextDecoder('utf-8')
  const files = unzipSync(new Uint8Array(buffer))
  return (name) => (files[name] ? decoder.decode(files[name]) : '')
}

function readSharedStringsXml(xml = '') {
  const sharedStrings = []
  xml.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, body) => {
    sharedStrings.push(textFromXmlParts(body))
    return ''
  })
  return sharedStrings
}

function readWorkbookSheets(readFile) {
  const workbookXml = readFile('xl/workbook.xml')
  const relsXml = readFile('xl/_rels/workbook.xml.rels')
  const relTargets = new Map()
  relsXml.replace(/<Relationship\b([^>]*)\/?>/g, (_, attrs) => {
    const id = xmlAttr(attrs, 'Id')
    const target = xmlAttr(attrs, 'Target')
    if (id && target) relTargets.set(id, target)
    return ''
  })

  const sheets = []
  workbookXml.replace(/<sheet\b([^>]*)\/?>/g, (_, attrs) => {
    const name = xmlAttr(attrs, 'name')
    const relationId = xmlAttr(attrs, 'r:id')
    const target = relTargets.get(relationId) || ''
    if (!target) return ''
    const normalizedTarget = target.startsWith('/') ? target.slice(1) : target
    sheets.push({
      name,
      path: normalizedTarget.startsWith('xl/') ? normalizedTarget : `xl/${normalizedTarget}`,
    })
    return ''
  })
  return sheets
}

function parseWorksheetRows(xml = '', sharedStrings = []) {
  const rows = []
  xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g, (_, rowAttrs, rowBody) => {
    const rowNumber = Number(xmlAttr(rowAttrs, 'r')) || rows.length + 1
    const row = []
    rowBody.replace(/<c\b([^>]*)(?:>([\s\S]*?)<\/c>|\/>)/g, (cellMatch, cellAttrs, cellBody = '') => {
      void cellMatch
      const cellRef = xmlAttr(cellAttrs, 'r')
      const colIndex = columnIndexFromCellRef(cellRef)
      const type = xmlAttr(cellAttrs, 't')
      const rawValue = cellBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || ''
      let value = ''

      if (type === 's') {
        value = sharedStrings[Number(rawValue)] || ''
      } else if (type === 'inlineStr') {
        value = textFromXmlParts(cellBody)
      } else if (rawValue) {
        value = decodeXmlEntities(rawValue)
      }

      row[colIndex] = value
      return ''
    })
    rows[rowNumber - 1] = row
    return ''
  })

  return rows
    .filter(Boolean)
    .map((row) => {
      const lastIndex = row.reduce((last, value, index) => (value == null ? last : index), 0)
      return Array.from({ length: lastIndex + 1 }, (_, index) => row[index] ?? '')
    })
}

async function readProposalWorkbookRows(file) {
  const buffer = await file.arrayBuffer()
  const readFile = readWorkbookXmlFiles(buffer)
  const sharedStrings = readSharedStringsXml(readFile('xl/sharedStrings.xml'))
  const sheets = readWorkbookSheets(readFile)
  const proposalSheet = sheets.find((sheet) => /proposal/i.test(sheet.name)) || sheets[0]
  if (!proposalSheet) throw new Error('No worksheet found in this Excel file.')
  const rows = parseWorksheetRows(readFile(proposalSheet.path), sharedStrings)
  return { rows, sheetName: proposalSheet.name || 'Project Proposals' }
}

async function parseProposalWorkbook(file) {
  const { rows, sheetName } = await readProposalWorkbookRows(file)
  const headerIndex = findProposalHeaderIndex(rows)
  if (headerIndex < 0) {
    throw new Error('Could not find proposal headers. The file must include Description, District, and Cost columns.')
  }
  const headers = rows[headerIndex].map(cleanCellText)
  const columnIndexes = Object.fromEntries(
    Object.keys(PROPOSAL_HEADER_ALIASES).map((field) => [field, getProposalColumnIndex(headers, field)]),
  )
  const required = ['description', 'district', 'costMn']
  const missing = required.filter((field) => columnIndexes[field] < 0)
  if (missing.length) throw new Error(`Missing required proposal column: ${missing.join(', ')}`)

  const uploadedAt = new Date()
  const id = proposalDocumentId(file.name)
  const proposalRows = rows
    .slice(headerIndex + 1)
    .map((row, index) => {
      const readField = (field) => {
        const col = columnIndexes[field]
        return col >= 0 ? row[col] : ''
      }
      return cleanProposalRow(
        {
          id: `${id}-row-${String(index + 1).padStart(4, '0')}`,
          serial: readField('serial'),
          description: readField('description'),
          district: readField('district'),
          category: readField('category'),
          phase: readField('phase'),
          costText: readField('costMn'),
          executingAgency: readField('executingAgency'),
          status: readField('status'),
          submittedBy: readField('submittedBy'),
          submittedAt: readField('submittedAt'),
          piuForwardedBy: readField('piuForwardedBy'),
          piuForwardedAt: readField('piuForwardedAt'),
          pscReviewedBy: readField('pscReviewedBy'),
          pscReviewedAt: readField('pscReviewedAt'),
          rejectionReason: readField('rejectionReason'),
          projectId: readField('projectId'),
          sourceRemarks: readField('sourceRemarks'),
          assessedByEngr: readField('assessedByEngr'),
          recommendation: readField('recommendation'),
          remarksComd: readField('remarksComd'),
        },
        index,
        id,
      )
    })
    .filter((row) => row.description || row.district || row.costMn)

  if (!proposalRows.length) throw new Error('No proposal rows found in this workbook.')

  return cleanProposalDocument({
    id,
    title: file.name.replace(/\.[^.]+$/, ''),
    fileName: file.name,
    sheetName,
    uploadedAt: uploadedAt.toISOString(),
    uploadedLabel: proposalUploadLabel(uploadedAt),
    rows: proposalRows,
  })
}

function mapKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const MAP_POINT_LOOKUP = Object.fromEntries(
  Object.entries(MAP_POINTS).map(([name, point]) => [mapKey(name), point]),
)

function getMapPoint(name) {
  return MAP_POINT_LOOKUP[mapKey(name)] || null
}

function getProjectMapPoint(projects = [], fallbackName = '') {
  const direct = getMapPoint(fallbackName)
  if (direct) return direct
  const points = projects
    .map((project) => getMapPoint(project.district))
    .filter(Boolean)
  if (!points.length) return null
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

function resolveSyncedMediaSrc(src) {
  if (!API_BASE_URL || !src || !src.startsWith('/synced-media/')) return src
  return `${API_BASE_URL}${src}`
}

function reportDownloadUrl() {
  const params = new URLSearchParams({
    phase: 'Total',
    district: DISTRICT_FILTER_ALL,
    download: '1',
    t: String(Date.now()),
  })
  return `${API_REPORT_ENDPOINT}?${params.toString()}`
}

function reportStatusUrl() {
  const params = new URLSearchParams({
    phase: 'Total',
    district: DISTRICT_FILTER_ALL,
    t: String(Date.now()),
  })
  return `${API_REPORT_STATUS_ENDPOINT}?${params.toString()}`
}

function cleanPhaseCatalog(phases = [], projects = []) {
  const byName = new Map()
  for (const phase of phases) {
    const name = typeof phase === 'string' ? phase : phase?.name
    if (!name || name === 'Total') continue
    byName.set(name, {
      id: phase?.id || toId(name),
      name,
      status: phase?.status || 'completed',
      projectCount: Number(phase?.projectCount) || 0,
      projectIds: Array.isArray(phase?.projectIds) ? phase.projectIds : [],
    })
  }
  for (const project of projects) {
    const name = project.phase || 'Phase 1'
    if (!name || name === 'Total') continue
    if (!byName.has(name)) {
      byName.set(name, { id: toId(name), name, status: 'completed', projectCount: 0, projectIds: [] })
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

function cleanDivisionCatalog(divisions = [], projects = []) {
  const byName = new Map()
  for (const division of divisions) {
    const name = typeof division === 'string' ? division : division?.name
    if (!name) continue
    byName.set(name, {
      id: division?.id || toId(name),
      name,
      districts: unique(Array.isArray(division?.districts) ? division.districts : []),
    })
  }
  for (const project of projects) {
    const divisionName = project.division || 'Unassigned'
    const districtName = project.district || ''
    const current = byName.get(divisionName) || { id: toId(divisionName), name: divisionName, districts: [] }
    current.districts = unique([...current.districts, districtName])
    byName.set(divisionName, current)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function countBy(items, key) {
  return Object.entries(
    items.reduce((acc, item) => {
      const value = item[key] || 'Unassigned'
      acc[value] = (acc[value] || 0) + 1
      return acc
    }, {}),
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function parseCostToMillions(value) {
  if (!value) return 0
  const normalized = String(value)
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\brs\.?\b|\bpkr\b|\bmillion\b|\bmn\b/g, ' ')
    .replace(/(\d)\.\s+(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim()

  if (/^\d+\s+\d+$/.test(normalized)) {
    return Number(normalized.replace(/\s+/g, '')) || 0
  }

  const number = normalized.match(/\d+(?:\.\d+)?/)
  return number ? Number(number[0]) : 0
}

function formatCostMillions(value) {
  const amount = Number(value) || 0
  if (!amount) return 'Cost not added'
  if (amount >= 1000) {
    return `Rs ${(amount / 1000).toLocaleString('en-US', {
      maximumFractionDigits: 2,
    })} Bn`
  }
  return `Rs ${amount.toLocaleString('en-US', {
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  })} Mn`
}

function summarizeBy(items, key) {
  return Object.values(
    items.reduce((acc, item) => {
      const value = item[key] || 'Unassigned'
      if (!acc[value]) acc[value] = { name: value, count: 0, costMn: 0 }
      acc[value].count += 1
      acc[value].costMn += parseCostToMillions(item.cost)
      return acc
    }, {}),
  ).sort((a, b) => b.count - a.count || b.costMn - a.costMn || a.name.localeCompare(b.name))
}

function mainCategoryName(value) {
  const text = String(value || '').toLowerCase()
  if (/education|college|\bedn\b|school/.test(text)) return 'Education'
  if (/phe|phed|wss|water|ro plant|pipeline/.test(text)) return 'Water Supply'
  if (/health|pphi|hospital|bhu|rhc|cd\b/.test(text)) return 'Health'
  if (/road|b&r|bridge|communication/.test(text)) return 'Roads & Bridges'
  if (/irrigation|protection|drain|agri|land levelling/.test(text)) return 'Irrigation & Drainage'
  if (/energy|solar|electrification|qesco/.test(text)) return 'Energy & Solar'
  if (/sport|social|women|minority|culture|tourism|media|library|it/.test(text)) {
    return 'Social & Community'
  }
  if (/building|c&w|xen|local govt|municipal|admin|police|security|levies|infrastructure|const/.test(text)) {
    return 'Buildings & Civic Works'
  }
  return 'Buildings & Civic Works'
}

function summarizeMainCategories(items) {
  return Object.values(
    items.reduce((acc, item) => {
      const value = mainCategoryName(item.category)
      if (!acc[value]) acc[value] = { name: value, count: 0, costMn: 0 }
      acc[value].count += 1
      acc[value].costMn += parseCostToMillions(item.cost)
      return acc
    }, {}),
  ).sort((a, b) => b.count - a.count || b.costMn - a.costMn || a.name.localeCompare(b.name))
}

function mediaFromText(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((src) => ({
      type: /\.(mp4|m4v|webm)$/i.test(src) ? 'video' : 'image',
      src,
      name: src.split('/').pop() || 'media',
      size: 0,
    }))
}

function mediaToText(media = []) {
  return media.map((item) => item.src).join('\n')
}

function cleanProject(project) {
  const cleanedBase = { ...project }
  delete cleanedBase.notes
  delete cleanedBase.sourcePath
  delete cleanedBase.videoDriveLink
  delete cleanedBase.beneficiaries
  const title = project.title?.trim() || 'Untitled project'
  const id = project.id?.trim() || `project-${Date.now()}`
  const media = Array.isArray(project.media)
    ? project.media.map((item, index) => ({
        ...item,
        id: item.id || `${id}-media-${String(index + 1).padStart(2, '0')}`,
        projectId: item.projectId || id,
        type: item.type || 'image',
        src: resolveSyncedMediaSrc(item.src || ''),
        name: item.name || item.originalName || `media-${index + 1}`,
        order: item.order || index + 1,
      }))
    : []
  const mediaIds = media.map((item) => item.id).filter(Boolean)
  const imageIds = media.filter((item) => item.type !== 'video').map((item) => item.id).filter(Boolean)
  const videoIds = media.filter((item) => item.type === 'video').map((item) => item.id).filter(Boolean)
  return {
    ...cleanedBase,
    id,
    slide: Number(project.slide) || '',
    title,
    phase: project.phase?.trim() || 'Phase 1',
    division: project.division?.trim() || 'Unassigned',
    district: project.district?.trim() || 'Unassigned',
    category: project.category?.trim() || 'Infrastructure',
    beneficiary: project.beneficiary?.trim() || project.beneficiaries?.trim() || '',
    driveLink: project.driveLink?.trim() || '',
    description: project.description?.trim() || '',
    media,
    mediaIds,
    imageIds,
    videoIds,
    searchText: [
      title,
      project.division,
      project.district,
      project.category,
      project.beneficiary,
      project.beneficiaries,
      project.description,
      project.contractor,
      project.scope,
      project.driveLink,
    ]
      .filter(Boolean)
      .join(' '),
  }
}

function normalizeDataset(raw) {
  if (raw?.schemaVersion && raw?.projects) {
    const projects = (raw.projects || []).map(cleanProject)
    return {
      meta: {
        title: 'BSDI Completed Projects',
        subtitle: 'Completed project database',
        sourceFile: raw.source?.file || '',
        sourceDate: raw.source?.date || '',
        totalSlides: raw.source?.totalSlides || 0,
        deckSummary: {
          districts: raw.totals?.districts || 0,
          totalProjects: raw.totals?.projects || 0,
          inProgress: 0,
          completed: raw.totals?.projects || 0,
          budgetBn: raw.totals?.budgetBn || 0,
        },
      },
      settings: {
        adminPassword: raw.settings?.adminPassword || raw.settings?.admin?.password || FALLBACK_ADMIN_PASSWORD,
        editable: {
          phases: true,
          divisions: true,
          districts: true,
          ...(raw.settings?.editable || {}),
        },
      },
      phases: cleanPhaseCatalog(raw.phases || [], projects),
      divisions: cleanDivisionCatalog(raw.divisions || [], projects),
      districts: raw.districts || [],
      projects,
      media: raw.media || [],
      proposalDocuments: cleanProposalDocuments(raw.proposalDocuments || raw.proposals || []),
      database: raw,
    }
  }

  return {
    ...raw,
    projects: (raw?.projects || []).map(cleanProject),
    proposalDocuments: cleanProposalDocuments(raw?.proposalDocuments || raw?.proposals || []),
  }
}

function openMediaDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('Local media storage is not available in this browser'))
      return
    }

    const request = window.indexedDB.open(MEDIA_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
        db.createObjectStore(MEDIA_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveMediaBlob(mediaId, file) {
  const db = await openMediaDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE_NAME, 'readwrite')
    transaction.objectStore(MEDIA_STORE_NAME).put({
      id: mediaId,
      blob: file,
      type: file.type,
      name: file.name,
      size: file.size,
      updatedAt: new Date().toISOString(),
    })
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

async function getMediaBlob(mediaId) {
  const db = await openMediaDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE_NAME, 'readonly')
    const request = transaction.objectStore(MEDIA_STORE_NAME).get(mediaId)
    request.onsuccess = () => resolve(request.result?.blob || null)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
  })
}

async function deleteMediaBlob(mediaId) {
  const db = await openMediaDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE_NAME, 'readwrite')
    transaction.objectStore(MEDIA_STORE_NAME).delete(mediaId)
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

async function hydrateProjectsWithLocalMedia(projects) {
  return Promise.all(
    projects.map(async (project) => {
      const media = await Promise.all(
        (project.media || []).map(async (item) => {
          if (!item.localBlob || !item.storageKey) return item
          try {
            const blob = await getMediaBlob(item.storageKey)
            return blob ? { ...item, src: URL.createObjectURL(blob) } : null
          } catch {
            return null
          }
        }),
      )

      return {
        ...project,
        media: media.filter(Boolean),
      }
    }),
  )
}

function serializeProjects(projects) {
  return projects.map((project) => ({
    ...project,
    // Object URLs are session-only; keep the IndexedDB key and recreate URLs on load.
    media: (project.media || []).map((item) =>
      item.localBlob ? { ...item, src: '' } : item,
    ),
  }))
}

function collectDistrictCatalog(divisions = [], projects = []) {
  const fromProjects = projects.map((project) => ({
    id: toId(`${project.division}-${project.district}`),
    name: project.district,
    division: project.division,
  }))
  const fromDivisions = divisions.flatMap((division) =>
    (division.districts || []).map((district) => ({
      id: toId(`${division.name}-${district}`),
      name: district,
      division: division.name,
    })),
  )
  const byKey = new Map()
  for (const district of [...fromDivisions, ...fromProjects]) {
    if (!district.name || !district.division) continue
    byKey.set(`${district.division}::${district.name}`, district)
  }
  return [...byKey.values()].sort(
    (a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name),
  )
}

function createDashboardSnapshot(projects, phases, divisions, baseData = {}, proposalDocuments = null) {
  // This snapshot is the single shape used for local cache and server sync.
  const cleanedProjects = serializeProjects(projects.map(cleanProject))
  const cleanedPhases = cleanPhaseCatalog(phases, cleanedProjects)
  const cleanedDivisions = cleanDivisionCatalog(divisions, cleanedProjects)
  const cleanedProposalDocuments = cleanProposalDocuments(
    proposalDocuments ??
      baseData.proposalDocuments ??
      baseData.database?.proposalDocuments ??
      [],
  )
  const media = cleanedProjects.flatMap((project) => project.media || [])
  const budgetMn = cleanedProjects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0)

  return {
    ...(baseData.database || {}),
    schemaVersion: Math.max(Number(baseData.database?.schemaVersion) || 0, 3),
    databaseName: baseData.database?.databaseName || 'bsdi-completed-projects',
    generatedAt: baseData.database?.generatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      ...(baseData.database?.source || {}),
      ...(baseData.source || {}),
    },
    totals: {
      ...(baseData.database?.totals || {}),
      projects: cleanedProjects.length,
      divisions: cleanedDivisions.length,
      districts: collectDistrictCatalog(cleanedDivisions, cleanedProjects).length,
      media: media.length,
      images: media.filter((item) => item.type !== 'video').length,
      videos: media.filter((item) => item.type === 'video').length,
      budgetBn: Number((budgetMn / 1000).toFixed(3)),
    },
    phases: cleanedPhases,
    divisions: cleanedDivisions,
    districts: collectDistrictCatalog(cleanedDivisions, cleanedProjects),
    projects: cleanedProjects,
    media,
    proposalDocuments: cleanedProposalDocuments,
    settings: {
      adminPassword:
        baseData.settings?.adminPassword ||
        baseData.database?.settings?.adminPassword ||
        FALLBACK_ADMIN_PASSWORD,
      editable: {
        phases: true,
        divisions: true,
        districts: true,
        ...(baseData.settings?.editable || {}),
        ...(baseData.database?.settings?.editable || {}),
      },
    },
  }
}

function serializeDashboardState(projects, phases, divisions, baseData = {}, proposalDocuments = null) {
  return createDashboardSnapshot(projects, phases, divisions, baseData, proposalDocuments)
}

function readSavedDashboardState(dataset, options = {}) {
  // Remote data wins unless there are unsynced local edits on this laptop.
  const shouldReadSaved = options.preferSaved !== false
  if (!shouldReadSaved) {
    return {
      projects: dataset.projects || [],
      phases: cleanPhaseCatalog(dataset.phases, dataset.projects),
      divisions: cleanDivisionCatalog(dataset.divisions, dataset.projects),
      proposalDocuments: cleanProposalDocuments(dataset.proposalDocuments || []),
    }
  }

  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    const parsed = JSON.parse(saved)
    if (Array.isArray(parsed)) {
      const projects = parsed.map(cleanProject)
      return {
        projects,
        phases: cleanPhaseCatalog(dataset.phases, projects),
        divisions: cleanDivisionCatalog(dataset.divisions, projects),
        proposalDocuments: cleanProposalDocuments(dataset.proposalDocuments || []),
      }
    }
    const projects = (parsed.projects || dataset.projects || []).map(cleanProject)
    return {
      projects,
      phases: cleanPhaseCatalog(parsed.phases || dataset.phases, projects),
      divisions: cleanDivisionCatalog(parsed.divisions || dataset.divisions, projects),
      proposalDocuments: cleanProposalDocuments(parsed.proposalDocuments || dataset.proposalDocuments || []),
    }
  }

  for (const key of LEGACY_PROJECT_KEYS) {
    const legacy = localStorage.getItem(key)
    if (!legacy) continue
    const projects = JSON.parse(legacy).map(cleanProject)
    return {
      projects,
      phases: cleanPhaseCatalog(dataset.phases, projects),
      divisions: cleanDivisionCatalog(dataset.divisions, projects),
      proposalDocuments: cleanProposalDocuments(dataset.proposalDocuments || []),
    }
  }

  return {
    projects: dataset.projects || [],
    phases: cleanPhaseCatalog(dataset.phases, dataset.projects),
    divisions: cleanDivisionCatalog(dataset.divisions, dataset.projects),
    proposalDocuments: cleanProposalDocuments(dataset.proposalDocuments || []),
  }
}

function createApiUnavailableError(message = API_UNAVAILABLE_MESSAGE, status = 0) {
  const error = new Error(message)
  error.code = 'API_UNAVAILABLE'
  error.status = status
  return error
}

function isApiUnavailableError(error) {
  // A 404 here usually means the app was deployed as static frontend only.
  return error?.code === 'API_UNAVAILABLE' || error?.status === 404
}

function isRevisionConflictError(error) {
  return error?.code === 'REVISION_CONFLICT' || error?.status === 409
}

function saveConflictBackup(snapshot) {
  if (!snapshot) return ''
  const key = `${CONFLICT_BACKUP_KEY_PREFIX}${Date.now()}`
  try {
    localStorage.setItem(key, JSON.stringify(snapshot))
    return key
  } catch {
    return ''
  }
}

function collectCacheableMediaUrls(projects = []) {
  if (typeof window === 'undefined') return []
  const urls = new Set()
  for (const project of projects) {
    for (const item of project.media || []) {
      const src = item?.src || ''
      if (!src || src.startsWith('blob:') || src.startsWith('data:')) continue
      try {
        const url = new URL(src, window.location.origin)
        if (!/^https?:$/.test(url.protocol)) continue
        urls.add(url.href)
      } catch {
        // Ignore hand-entered invalid links; project data still syncs.
      }
    }
  }
  return [...urls]
}

async function cacheDashboardMedia(projects = [], onProgress = () => {}) {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return { total: 0, ready: 0, failed: 0, unsupported: true }
  }

  const urls = collectCacheableMediaUrls(projects)
  if (!urls.length) return { total: 0, ready: 0, failed: 0, unsupported: false }

  try {
    await navigator.storage?.persist?.()
  } catch {
    // Best effort only; some browsers do not expose storage persistence.
  }

  const cache = await caches.open(MEDIA_CACHE_NAME)
  let ready = 0
  let failed = 0

  for (const [index, url] of urls.entries()) {
    try {
      const cached = await cache.match(url)
      if (!cached) {
        const parsed = new URL(url)
        const request = new Request(url, {
          credentials: parsed.origin === window.location.origin ? 'same-origin' : 'omit',
        })
        const response = await fetch(request)
        if (!response.ok && response.type !== 'opaque') throw new Error(`${response.status}`)
        await cache.put(request, response.clone())
      }
      ready += 1
    } catch {
      failed += 1
    }

    const done = index + 1
    if (done === 1 || done === urls.length || done % 10 === 0) {
      onProgress({ done, total: urls.length, ready, failed })
    }
  }

  return { total: urls.length, ready, failed, unsupported: false }
}

async function fetchJsonFromApi(url, options = {}) {
  let response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      ...options,
    })
  } catch (error) {
    const networkError = new Error(error.message || 'Network request failed')
    networkError.code = 'NETWORK_ERROR'
    throw networkError
  }

  const contentType = response.headers.get('content-type') || ''
  if (response.status === 404) {
    throw createApiUnavailableError(API_UNAVAILABLE_MESSAGE, response.status)
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    if (contentType.includes('application/json')) {
      const body = await response.json()
      message = body.error || message
      const error = new Error(message)
      error.status = response.status
      error.code = body.code || ''
      throw error
    }
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  if (!contentType.includes('application/json')) {
    throw createApiUnavailableError(API_UNAVAILABLE_MESSAGE, response.status)
  }
  return response.json()
}

async function checkSyncServerAvailable() {
  try {
    await fetchJsonFromApi(API_STATE_ENDPOINT)
    return true
  } catch (error) {
    if (isApiUnavailableError(error)) return false
    throw error
  }
}

async function loadRemoteDashboardDataset() {
  const remote = await fetchJsonFromApi(API_STATE_ENDPOINT)
  return normalizeDataset(remote)
}

async function loadDashboardDataset() {
  let apiError = null
  if (navigator.onLine) {
    try {
      const dataset = await loadRemoteDashboardDataset()
      return { dataset, source: 'remote', syncAvailable: true, apiError: null }
    } catch (error) {
      apiError = error
      // Static hosting still works without the API; the app will use cached/source data.
    }
  }

  // Fallback keeps demo/static/offline installs usable even without the API.
  const dbResponse = await fetch('/database/bsdi-db.json')
  if (dbResponse.ok) {
    return {
      dataset: normalizeDataset(await dbResponse.json()),
      source: 'bundled',
      syncAvailable: false,
      apiError,
    }
  }

  throw new Error('Unable to load BSDI database')
}

function DetailLine({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex min-w-0 gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
      <span className="icon-box h-8 w-8 shrink-0 rounded-lg">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="form-label">{label}</p>
        <p className="mt-0.5 break-words text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  )
}

function MediaViewer({ project }) {
  const media = project?.media || []
  const [activeState, setActiveState] = useState({ projectId: '', index: 0 })
  const [zoomImage, setZoomImage] = useState(null)
  const active =
    activeState.projectId === project?.id ? Math.min(activeState.index, media.length - 1) : 0
  const current = media[active]
  const hasMultipleMedia = media.length > 1

  function selectMedia(index) {
    if (!media.length) return
    const nextIndex = (index + media.length) % media.length
    setActiveState({ projectId: project.id, index: nextIndex })
  }

  function stepMedia(direction) {
    selectMedia(active + direction)
  }

  useEffect(() => {
    if (!zoomImage) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function closeOnEscape(event) {
      if (event.key === 'Escape') setZoomImage(null)
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [zoomImage])

  if (!current) {
    return (
      <div className="grid aspect-[16/9] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center">
        <div>
          <ImageIcon className="mx-auto text-slate-300" size={34} />
          <p className="mt-2 text-sm font-medium text-slate-400">No media linked</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        {current.type === 'video' ? (
          <video
            src={current.src}
            controls
            className="aspect-video w-full bg-slate-900 object-contain"
          />
        ) : (
          <button
            type="button"
            onClick={() => setZoomImage(current)}
            className="block w-full cursor-zoom-in bg-slate-50"
            title="Open full screen"
          >
            <img
              src={current.src}
              alt={project.title}
              className="aspect-video w-full object-contain"
              loading="lazy"
            />
          </button>
        )}
        {hasMultipleMedia ? (
          <>
            <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-10 flex items-center justify-between px-2 sm:px-3">
              <button
                type="button"
                onClick={() => stepMedia(-1)}
                className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-white/70 bg-white/90 text-slate-700 shadow-lg shadow-slate-900/15 backdrop-blur transition hover:bg-white hover:text-emerald-700 sm:h-11 sm:w-11"
                aria-label="Previous media"
                title="Previous media"
              >
                <ArrowLeft size={19} />
              </button>
              <button
                type="button"
                onClick={() => stepMedia(1)}
                className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-white/70 bg-white/90 text-slate-700 shadow-lg shadow-slate-900/15 backdrop-blur transition hover:bg-white hover:text-emerald-700 sm:h-11 sm:w-11"
                aria-label="Next media"
                title="Next media"
              >
                <ArrowRight size={19} />
              </button>
            </div>
            <div className="absolute right-3 top-3 z-10 rounded-full border border-white/50 bg-slate-950/65 px-2.5 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur">
              {active + 1} / {media.length}
            </div>
          </>
        ) : null}
      </div>
      {media.length > 1 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
          {media.map((item, index) => (
            <button
              key={`${item.src}-${index}`}
              type="button"
              onClick={() => {
                selectMedia(index)
                if (item.type !== 'video') setZoomImage(item)
              }}
              className={`grid aspect-video place-items-center overflow-hidden rounded-lg border bg-slate-50 transition ${
                active === index
                  ? 'border-emerald-500 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
              title={item.name}
            >
              {item.type === 'video' ? (
                <Video className="text-slate-400" size={18} />
              ) : (
                <img src={item.src} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}
            </button>
          ))}
        </div>
      ) : null}
      <AnimatePresence>
        {zoomImage ? (
          <motion.div
            className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/95 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setZoomImage(null)}
          >
            <button
              type="button"
              onClick={() => setZoomImage(null)}
              className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
              title="Close"
            >
              <X size={22} />
            </button>
            <motion.img
              src={zoomImage.src}
              alt={project.title}
              className="max-h-[92vh] max-w-[96vw] rounded-xl object-contain shadow-2xl"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              onClick={(event) => event.stopPropagation()}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function ShowcaseLightbox({ entry, onClose }) {
  useEffect(() => {
    if (!entry) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose?.()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [entry, onClose])

  if (!entry) return null

  const { project, media } = entry
  const isVideo = media.type === 'video'

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[85] grid place-items-center bg-slate-950/95 p-3 sm:p-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
          title="Close"
        >
          <X size={22} />
        </button>
        <motion.div
          className="w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="border-b border-white/10 bg-slate-950/80 px-4 py-3 text-white sm:px-5">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">{project.district}</p>
            <h3 className="mt-1 line-clamp-2 text-base font-bold sm:text-lg">{project.title}</h3>
          </div>
          <div className="grid max-h-[78vh] place-items-center bg-slate-950">
            {isVideo ? (
              <video
                src={media.src}
                controls
                autoPlay
                className="max-h-[78vh] w-full bg-slate-950 object-contain"
              />
            ) : (
              <img
                src={media.src}
                alt={media.name || project.title}
                className="max-h-[78vh] w-full object-contain"
              />
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function VisualsPanel({ projects, phaseSelection, onOpenProject }) {
  const [tick, setTick] = useState(0)
  const [lightboxEntry, setLightboxEntry] = useState(null)
  const showcaseProjects = useMemo(
    () =>
      projects
        .filter((project) => Array.isArray(project.media) && project.media.length)
        .map((project) => ({
          ...project,
          media: [...project.media].sort((a, b) => (a.order || 0) - (b.order || 0)),
        })),
    [projects],
  )
  const imageCount = useMemo(
    () =>
      showcaseProjects.reduce(
        (sum, project) => sum + project.media.filter((item) => item.type !== 'video').length,
        0,
      ),
    [showcaseProjects],
  )
  const videoCount = useMemo(
    () =>
      showcaseProjects.reduce(
        (sum, project) => sum + project.media.filter((item) => item.type === 'video').length,
        0,
      ),
    [showcaseProjects],
  )

  useEffect(() => {
    if (!showcaseProjects.length) return undefined
    const timer = window.setInterval(() => {
      setTick((current) => current + 1)
    }, 3800)
    return () => window.clearInterval(timer)
  }, [showcaseProjects.length])

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
              {phaseSelection}
            </span>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              Visual Showcase
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Project media gallery with auto-scrolling image and video cards.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[420px]">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
              <p className="form-label">Projects</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{showcaseProjects.length}</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white p-3">
              <p className="form-label">Images</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{imageCount}</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white p-3">
              <p className="form-label">Videos</p>
              <p className="mt-1 text-2xl font-black text-slate-950">{videoCount}</p>
            </div>
          </div>
        </div>
      </section>

      {showcaseProjects.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {showcaseProjects.map((project, index) => {
            const activeIndex = project.media.length
              ? (tick + index) % project.media.length
              : 0
            const activeMedia = project.media[activeIndex]
            const isVideo = activeMedia?.type === 'video'
            return (
              <motion.article
                key={project.id}
                layout
                className="group overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-card transition duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-2xl hover:shadow-emerald-950/10"
              >
                <div className="flex min-h-[92px] items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-br from-white via-emerald-50/70 to-white p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white">
                        {project.district}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                        {project.phase || 'Phase 1'}
                      </span>
                    </div>
                    <h3 className="mt-3 line-clamp-2 text-base font-extrabold leading-snug text-slate-950">
                      {project.title}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenProject?.(project.id)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-emerald-100 bg-white text-emerald-700 shadow-sm transition hover:bg-emerald-50"
                    title="Open project details"
                  >
                    <ExternalLink size={15} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setLightboxEntry({ project, media: activeMedia })}
                  className="relative block aspect-[16/10] w-full overflow-hidden bg-slate-950 text-left"
                  title="Open media"
                >
                  {isVideo ? (
                    <video
                      src={activeMedia.src}
                      muted
                      loop
                      autoPlay
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover opacity-95 transition duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <img
                      src={activeMedia.src}
                      alt={activeMedia.name || project.title}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                      loading="lazy"
                    />
                  )}
                  <span className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/80 to-transparent" />
                  <span className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-xs font-bold text-white backdrop-blur">
                    {isVideo ? <Video size={14} /> : <ImageIcon size={14} />}
                    {activeIndex + 1} / {project.media.length}
                  </span>
                  <span className="absolute bottom-3 right-3 rounded-full border border-white/20 bg-white/15 px-3 py-1 text-xs font-bold text-white backdrop-blur">
                    Open
                  </span>
                </button>

                <div className="flex items-center gap-1.5 overflow-hidden p-3">
                  {project.media.slice(0, 8).map((item, mediaIndex) => (
                    <button
                      key={item.id || `${project.id}-${mediaIndex}`}
                      type="button"
                      onClick={() => setLightboxEntry({ project, media: item })}
                      className={`h-1.5 flex-1 rounded-full transition ${
                        mediaIndex === activeIndex ? 'bg-emerald-600' : 'bg-slate-200 hover:bg-emerald-200'
                      }`}
                      title={item.name || `Media ${mediaIndex + 1}`}
                    />
                  ))}
                  {project.media.length > 8 ? (
                    <span className="ml-1 text-[10px] font-bold text-slate-400">+{project.media.length - 8}</span>
                  ) : null}
                </div>
              </motion.article>
            )
          })}
        </section>
      ) : (
        <section className="card grid min-h-[260px] place-items-center p-8 text-center">
          <div>
            <span className="icon-box mx-auto mb-3 h-12 w-12 rounded-xl">
              <ImageIcon size={22} />
            </span>
            <h3 className="text-lg font-bold text-slate-900">No media available</h3>
            <p className="mt-2 text-sm text-slate-500">Add images or videos to projects to populate this showcase.</p>
          </div>
        </section>
      )}

      <ShowcaseLightbox entry={lightboxEntry} onClose={() => setLightboxEntry(null)} />
    </div>
  )
}

function DriveFolderCard({ project }) {
  const link = project.driveLink || ''
  const isReady = Boolean(link)

  return (
    <button
      type="button"
      onClick={() => {
        if (isReady) window.open(link, '_blank', 'noopener,noreferrer')
      }}
      className={`mt-3 flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${
        isReady
          ? 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50'
          : 'border-dashed border-slate-200 bg-slate-50 opacity-60'
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="icon-box h-9 w-9 rounded-lg">
          <FolderOpen size={17} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800">Drive folder</span>
          <span className="block truncate text-xs text-slate-400">
            {isReady ? 'Open linked project folder' : 'Link pending'}
          </span>
        </span>
      </span>
      <ExternalLink className={isReady ? 'text-emerald-600' : 'text-slate-300'} size={16} />
    </button>
  )
}

function ProjectDetail({ project, onEditProject }) {
  if (!project) return null
  const printImages = (project.media || []).filter((item) => item.type !== 'video').slice(0, 4)
  return (
    <motion.section
      key={project.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card print-project-detail min-w-0 p-4 sm:p-5"
    >
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(300px,0.88fr)] xl:gap-6">
        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex max-w-full items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                <span className="truncate">{project.division}</span>
              </span>
              {project.progress ? (
                <span className="inline-flex max-w-full items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 ring-1 ring-blue-100">
                  <span className="truncate">{project.progress}</span>
                </span>
              ) : null}
            </div>
            {onEditProject ? (
              <button
                type="button"
                onClick={() => onEditProject(project.id)}
                className="btn-secondary no-print h-9 w-full text-xs sm:w-auto"
              >
                <Pencil size={14} />
                Edit project
              </button>
            ) : null}
          </div>
          <h2 className="mt-4 break-words text-lg font-bold leading-snug text-slate-900 sm:text-xl">
            {project.title}
          </h2>
          {project.description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{project.description}</p>
          ) : null}
          <div className="mt-4 grid gap-2.5 md:grid-cols-2">
            <DetailLine icon={FileJson} label="Serial" value={project.slide ? `#${project.slide}` : project.id} />
            <DetailLine icon={MapPin} label="District" value={project.district} />
            <DetailLine icon={Tags} label="Category" value={project.category} />
            <DetailLine icon={Users} label="Beneficiary" value={project.beneficiary} />
            <DetailLine icon={CircleDollarSign} label="Cost" value={project.cost} />
            <DetailLine icon={CalendarDays} label="Duration" value={project.duration} />
            <DetailLine icon={Building2} label="Contractor" value={project.contractor} />
            <DetailLine icon={ShieldCheck} label="Executing agency" value={project.focalOfficer} />
          </div>
          {project.scope ? (
            <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <p className="form-label">Scope</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{project.scope}</p>
            </div>
          ) : null}
          <div className="no-print">
            <DriveFolderCard project={project} />
          </div>
        </div>
        <div className="no-print">
          <MediaViewer project={project} />
        </div>
      </div>
      {printImages.length ? (
        <div className="print-project-gallery">
          <p className="print-gallery-title">Project Images</p>
          <div className="print-gallery-grid">
            {printImages.map((item, index) => (
              <figure key={item.id || `${project.id}-print-${index}`} className="print-gallery-item">
                <img src={item.src} alt={item.name || project.title} loading="eager" decoding="sync" />
                <figcaption>{item.name || `Image ${index + 1}`}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : null}
    </motion.section>
  )
}

function PrintLandmarkStrip({ dark = false }) {
  return (
    <div className={`print-landmark-strip${dark ? ' print-landmark-strip-dark' : ''}`}>
      {LANDMARK_CARDS.map((landmark) => (
        <img
          key={landmark.src}
          src={landmark.src}
          alt={landmark.alt}
          loading="eager"
          decoding="sync"
        />
      ))}
    </div>
  )
}

function PrintMapPanel({ title, subtitle, markerLabel, markerPoint }) {
  return (
    <div className="print-map-panel">
      <div className="print-map-text">
        <p>{title}</p>
        <span>{subtitle}</span>
      </div>
      <div className="print-map-frame">
        <div className="print-map-canvas">
          <img src={BALOCHISTAN_MAP} alt="Balochistan district map" loading="eager" decoding="sync" />
          {markerPoint ? (
            <span
              className="print-map-marker"
              style={{ left: `${markerPoint.x}%`, top: `${markerPoint.y}%` }}
            >
              <span>{markerLabel}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function PrintReportProjectPage({ project, index, divisionName, districtName }) {
  const images = (project.media || []).filter((item) => item.type !== 'video').slice(0, 4)
  const videoCount = (project.media || []).filter((item) => item.type === 'video').length
  const serial = project.slide ? `#${project.slide}` : String(index + 1).padStart(3, '0')
  const imageLayoutClass = `print-project-images-${Math.min(images.length, 4)}`

  return (
    <article className="print-project-page">
      <div className="print-project-page-head">
        <div>
          <p className="print-kicker">Project Page</p>
          <h2>{project.title}</h2>
        </div>
        <div className="print-project-serial">
          <span>Serial</span>
          <strong>{serial}</strong>
        </div>
      </div>
      <div className="print-project-meta">
        <span>Division <strong>{divisionName || project.division}</strong></span>
        <span>District <strong>{districtName || project.district}</strong></span>
        <span>Phase <strong>{project.phase || 'Phase 1'}</strong></span>
        <span>Cost <strong>{project.cost || 'Not added'}</strong></span>
        <span>Category <strong>{project.category || 'Unassigned'}</strong></span>
        <span>Beneficiary <strong>{project.beneficiary || 'Not added'}</strong></span>
        <span>Progress <strong>{project.progress || 'Completed'}</strong></span>
      </div>
      {project.scope || project.description ? (
        <div className="print-project-scope">
          <p>{project.description || project.scope}</p>
        </div>
      ) : null}
      {images.length ? (
        <>
          <p className="print-gallery-title">Project Images</p>
          <div className={`print-project-images ${imageLayoutClass}`}>
            {images.map((image, imageIndex) => (
              <img
                key={image.id || `${project.id}-print-image-${imageIndex}`}
                src={image.src}
                alt={image.name || project.title}
                loading="eager"
                decoding="sync"
              />
            ))}
          </div>
        </>
      ) : (
        <div className="print-project-placeholder">
          <ImageIcon size={18} />
          <span>No image added</span>
        </div>
      )}
      <div className="print-project-footer">
        <span>{(project.media || []).length} media file{(project.media || []).length === 1 ? '' : 's'}</span>
        {videoCount ? <span>{videoCount} video{videoCount === 1 ? '' : 's'} available in app</span> : null}
      </div>
    </article>
  )
}

function FullPrintReport({ projects, stats, phaseSelection, districtSelection, date }) {
  const reportDivisions = useMemo(
    () =>
      unique(projects.map((project) => project.division)).map((divisionName) => {
        const divisionProjects = projects.filter((project) => project.division === divisionName)
        const districts = unique(divisionProjects.map((project) => project.district)).map((districtName) => {
          const districtProjects = divisionProjects
            .filter((project) => project.district === districtName)
            .sort((a, b) => (Number(a.slide) || 9999) - (Number(b.slide) || 9999))
          return {
            name: districtName,
            projects: districtProjects,
            media: districtProjects.reduce((sum, project) => sum + (project.media || []).length, 0),
            costMn: districtProjects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0),
            categories: countBy(districtProjects, 'category').slice(0, 4),
          }
        })
        return {
          name: divisionName,
          projects: divisionProjects,
          districts,
          media: divisionProjects.reduce((sum, project) => sum + (project.media || []).length, 0),
          costMn: divisionProjects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0),
          categories: countBy(divisionProjects, 'category').slice(0, 6),
        }
      }),
    [projects],
  )

  return (
    <section className="print-only print-full-report">
      <section className="print-cover-page">
        <div className="print-cover-hero">
          <div className="print-cover-top">
            <img src={BRAND_LOGO} alt="BSDI logo" />
            <div>
              <p>Balochistan Special Development Initiative</p>
              <h1>Completed Projects BSDI</h1>
            </div>
          </div>
          <PrintLandmarkStrip dark />
        </div>
        <div className="print-cover-badges">
          <span>{phaseSelection}</span>
          <span>{districtSelection}</span>
          <span>{date}</span>
          <span>{reportDivisions.length} divisions</span>
        </div>
        <div className="print-cover-stats">
          <div>
            <p>Completed Projects</p>
            <strong>{stats.completed}</strong>
          </div>
          <div>
            <p>Districts</p>
            <strong>{stats.districts}</strong>
          </div>
          <div>
            <p>Total Media</p>
            <strong>{stats.media}</strong>
          </div>
          <div>
            <p>Budget</p>
            <strong>{stats.budget}</strong>
          </div>
        </div>
        <div className="print-cover-grid">
          {reportDivisions.map((division) => (
            <div key={division.name} className="print-cover-division-card">
              <p>{division.name}</p>
              <strong>{division.projects.length}</strong>
              <span>{division.districts.length} districts - {formatCostMillions(division.costMn)}</span>
            </div>
          ))}
        </div>
      </section>

      {reportDivisions.map((division) => (
        <section key={division.name} className="print-division-group">
          <section className="print-division-page">
            <div className="print-page-heading">
              <div>
                <p className="print-kicker">Division Main Page</p>
                <h2>{division.name}</h2>
              </div>
              <PrintLandmarkStrip />
            </div>
            <div className="print-section-stats">
              <div>
                <p>Projects</p>
                <strong>{division.projects.length}</strong>
              </div>
              <div>
                <p>Districts</p>
                <strong>{division.districts.length}</strong>
              </div>
              <div>
                <p>Media</p>
                <strong>{division.media}</strong>
              </div>
              <div>
                <p>Cost</p>
                <strong>{formatCostMillions(division.costMn)}</strong>
              </div>
            </div>
            <div className="print-info-grid">
              <div>
                <h3>District Coverage</h3>
                <div className="print-chip-list">
                  {division.districts.map((district) => (
                    <span key={district.name}>{district.name} ({district.projects.length})</span>
                  ))}
                </div>
              </div>
              <div>
                <h3>Top Categories</h3>
                <div className="print-chip-list">
                  {division.categories.map((category) => (
                    <span key={category.name}>{category.name} ({category.count})</span>
                  ))}
                </div>
              </div>
            </div>
            <PrintMapPanel
              title="Division Map"
              subtitle={`${division.name} highlighted by active district coverage`}
              markerLabel={division.name.replace(' Division', '')}
              markerPoint={getProjectMapPoint(division.projects, division.name)}
            />
          </section>

          {division.districts.map((district) => (
            <section key={`${division.name}-${district.name}`} className="print-district-group">
              <section className="print-district-page">
                <div className="print-district-head">
                  <div>
                    <p className="print-kicker">District Main Page</p>
                    <h2>{district.name}</h2>
                    <p>{division.name}</p>
                  </div>
                  <PrintLandmarkStrip />
                  <div className="print-district-stats">
                    <span>{district.projects.length} projects</span>
                    <span>{district.media} media</span>
                    <span>{formatCostMillions(district.costMn)}</span>
                  </div>
                </div>
                <div className="print-chip-list print-district-categories">
                  {district.categories.map((category) => (
                    <span key={category.name}>{category.name} ({category.count})</span>
                  ))}
                </div>
                <p className="print-district-note">
                  Project detail pages follow separately for clean printing and image visibility.
                </p>
                <PrintMapPanel
                  title="District Map"
                  subtitle={`${district.name} highlighted on Balochistan district map`}
                  markerLabel={district.name}
                  markerPoint={getProjectMapPoint(district.projects, district.name)}
                />
              </section>
              {district.projects.map((project, index) => (
                <PrintReportProjectPage
                  key={project.id}
                  project={project}
                  index={index}
                  divisionName={division.name}
                  districtName={district.name}
                />
              ))}
            </section>
          ))}
        </section>
      ))}
    </section>
  )
}

function MetricPill({ label, value }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/60 to-white px-3 py-2.5 shadow-sm shadow-emerald-950/5 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-950/10">
      <span className="pointer-events-none absolute -right-4 -top-4 h-12 w-12 rounded-full bg-white/80 blur-xl transition group-hover:bg-emerald-100" />
      <span className="pointer-events-none absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-emerald-500/70 via-emerald-300/50 to-transparent" />
      <p className="relative text-[11px] font-bold uppercase tracking-wide text-emerald-900/55">{label}</p>
      <p className="relative mt-1 text-xl font-black leading-none text-slate-950">{value}</p>
    </div>
  )
}

function DetailPhaseSelector({ options, value, onChange }) {
  return (
    <div className="no-print flex w-full flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-inner shadow-slate-900/5 sm:w-auto">
      {options.map((phase) => {
        const isActive = phase === value
        return (
          <button
            key={phase}
            type="button"
            onClick={() => onChange?.(phase)}
            className={`h-8 flex-1 rounded-xl px-3 text-xs font-bold transition sm:flex-none ${
              isActive
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-900/20'
                : 'text-slate-500 hover:bg-white hover:text-emerald-700'
            }`}
          >
            {phase}
          </button>
        )
      })}
    </div>
  )
}

function ToastStack({ notifications, onDismiss }) {
  return (
    <div className="fixed right-3 top-3 z-[70] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2 sm:right-5 sm:top-5">
      <AnimatePresence>
        {notifications.map((item) => {
          const isError = item.type === 'error'
          const isInfo = item.type === 'info'
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: 24, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.98 }}
              className={`flex items-start gap-3 rounded-2xl border bg-white p-3 shadow-2xl shadow-slate-950/12 ${
                isError
                  ? 'border-red-100'
                  : isInfo
                    ? 'border-sky-100'
                    : 'border-emerald-100'
              }`}
            >
              <span
                className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white ${
                  isError ? 'bg-red-500' : isInfo ? 'bg-sky-500' : 'bg-emerald-600'
                }`}
              >
                {isError ? <X size={15} /> : isInfo ? <Info size={15} /> : <Check size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900">{item.title}</p>
                {item.message ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{item.message}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

function ProjectFieldInput({ name, label, value, onChange, categoryOptions = [], phaseOptions: phaseChoices = projectPhaseOptions }) {
  if (name === 'phase') {
    const options = unique([...phaseChoices, value])
    return (
      <>
        <span className="form-label">{label}</span>
        <select value={value || 'Phase 1'} onChange={(event) => onChange(name, event.target.value)} className="form-input">
          {options.map((phase) => (
            <option key={phase} value={phase}>
              {phase}
            </option>
          ))}
        </select>
      </>
    )
  }

  if (name === 'category') {
    const options = unique([...categoryOptions, value])
    return (
      <>
        <span className="form-label">{label}</span>
        <select value={value || ''} onChange={(event) => onChange(name, event.target.value)} className="form-input">
          <option value="" disabled>
            Select category
          </option>
          {options.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </>
    )
  }

  return (
    <>
      <span className="form-label">{label}</span>
      <input value={value || ''} onChange={(event) => onChange(name, event.target.value)} className="form-input" />
    </>
  )
}

function RingMetricCard({ icon: Icon, label, value, detail, percent }) {
  const safePercent = Math.min(Math.max(Number(percent) || 0, 0), 100)
  const valueClass = String(value).length > 9 ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl'

  return (
    <div className="card group relative overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-bl-full bg-emerald-100/60 blur-2xl transition group-hover:bg-emerald-200/80" />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-600 text-white shadow-lg shadow-emerald-700/15 ring-4 ring-emerald-50">
          <Icon size={20} strokeWidth={2.2} />
        </span>
      </div>
      <p className={`relative mt-3 break-words font-bold leading-tight text-slate-900 ${valueClass}`}>{value}</p>
      <p className="relative mt-1 text-sm text-slate-500">{detail}</p>
      <div className="progress-track relative mt-4">
        <div className="progress-fill" style={{ width: `${safePercent}%` }} />
      </div>
      <p className="relative mt-1.5 text-xs font-medium text-slate-400">{Math.round(safePercent)}%</p>
    </div>
  )
}

const chartColors = ['#059669', '#0d9488', '#16a34a', '#65a30d', '#0891b2', '#2563eb', '#d97706', '#64748b']
const categoryOrbitPositions = [
  'lg:col-start-2 lg:row-start-1 lg:self-end',
  'lg:col-start-3 lg:row-start-1 lg:self-end',
  'lg:col-start-3 lg:row-start-2 lg:self-center',
  'lg:col-start-3 lg:row-start-3 lg:self-start',
  'lg:col-start-2 lg:row-start-3 lg:self-start',
  'lg:col-start-1 lg:row-start-3 lg:self-start',
  'lg:col-start-1 lg:row-start-2 lg:self-center',
  'lg:col-start-1 lg:row-start-1 lg:self-end',
]

function DivisionBarChart({ data }) {
  const [activeName, setActiveName] = useState(data[0]?.name || '')
  const maxValue = Math.max(...data.map((item) => item.count), 1)
  const activeItem = data.find((item) => item.name === activeName) || data[0]

  return (
    <div className="card overflow-hidden p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-100 text-emerald-700 shadow-lg shadow-emerald-900/10">
            <span className="absolute inset-x-2 bottom-2 h-1 rounded-full bg-emerald-200/80" />
            <ChartColumnIncreasing className="relative" size={22} strokeWidth={2.35} />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Division Overview</h2>
            <p className="mt-0.5 text-xs text-slate-400">Completed projects by division</p>
          </div>
        </div>
        {activeItem ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-right">
            <p className="text-xs font-semibold uppercase text-emerald-700">{activeItem.name}</p>
            <p className="mt-0.5 text-lg font-bold text-emerald-950">{activeItem.count}</p>
            <p className="text-xs font-semibold text-emerald-700">{formatCostMillions(activeItem.costMn)}</p>
          </div>
        ) : null}
      </div>

      <div
        className="mt-5 rounded-2xl border border-slate-100 bg-white p-3 shadow-inner sm:p-4"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.12) 1px, transparent 1px)',
          backgroundSize: '25% 100%',
        }}
      >
        <div className="space-y-3">
          {data.map((item, index) => {
            const width = Math.max((item.count / maxValue) * 100, 4)
            const isActive = activeItem?.name === item.name
            return (
              <button
                key={item.name}
                type="button"
                onMouseEnter={() => setActiveName(item.name)}
                onFocus={() => setActiveName(item.name)}
                onClick={() => setActiveName(item.name)}
                className={`w-full rounded-xl p-2 text-left transition ${
                  isActive ? 'bg-emerald-50/90 shadow-sm ring-1 ring-emerald-100' : 'hover:bg-slate-50'
                }`}
              >
                <div className="mb-1.5 flex items-start justify-between gap-3 text-sm">
                  <span className={`min-w-0 truncate font-semibold ${isActive ? 'text-emerald-950' : 'text-slate-700'}`}>
                    {item.name}
                  </span>
                  <span className="shrink-0 text-right tabular-nums text-slate-500">
                    <span className="block">{item.count}</span>
                    <span className="block text-xs font-semibold text-emerald-700">{formatCostMillions(item.costMn)}</span>
                  </span>
                </div>
                <div className="relative h-8 overflow-hidden rounded-full bg-slate-100">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full shadow-lg shadow-emerald-700/10"
                    style={{
                      background:
                        'linear-gradient(90deg, #34d399 0%, #10b981 48%, #047857 100%)',
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${width}%` }}
                    transition={{ duration: 0.7, delay: index * 0.035, ease: 'easeOut' }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-white/35 to-transparent" />
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CategoryDonutChart({ data }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const total = data.reduce((sum, item) => sum + item.count, 0)
  const safeActiveIndex = Math.min(activeIndex, Math.max(data.length - 1, 0))
  const activeItem = data[safeActiveIndex] || data[0]
  const radius = 74
  const circumference = 2 * Math.PI * radius

  if (!data.length || !total) {
    return (
      <div className="card grid min-h-[420px] place-items-center p-5 text-center">
        <div>
          <ChartPie className="mx-auto text-slate-300" size={34} />
          <p className="mt-2 text-sm font-medium text-slate-400">No category data</p>
        </div>
      </div>
    )
  }

  const donutSegments = data.map((item, index) => {
    const dash = (item.count / total) * circumference
    const offset = data
      .slice(0, index)
      .reduce((sum, segment) => sum + (segment.count / total) * circumference, 0)
    return { item, index, dash, offset }
  })

  return (
    <div className="card overflow-hidden p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 via-white to-emerald-100 text-teal-700 shadow-lg shadow-teal-900/10">
            <span className="absolute h-7 w-7 rounded-full border-[6px] border-emerald-200/70" />
            <ChartPie className="relative" size={22} strokeWidth={2.35} />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Category Mix</h2>
            <p className="mt-0.5 text-xs text-slate-400">Share of completed projects</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-right">
          <p className="text-xs font-semibold uppercase text-slate-500">Total</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">{total}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_360px_minmax(220px,1fr)] lg:grid-rows-[minmax(92px,auto)_360px_minmax(92px,auto)] lg:items-center lg:gap-4 xl:grid-cols-[minmax(260px,1fr)_380px_minmax(260px,1fr)]">
        <div className="relative mx-auto h-[280px] w-[280px] sm:h-[320px] sm:w-[320px] lg:col-start-2 lg:row-start-2">
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-emerald-50 via-white to-teal-50 shadow-inner" />
          <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90 drop-shadow-sm">
            <circle
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke="#ecfdf5"
              strokeWidth="24"
            />
            {donutSegments.map(({ item, index, dash, offset }) => (
                <circle
                  key={item.name}
                  cx="100"
                  cy="100"
                  r={radius}
                  fill="none"
                  stroke={chartColors[index % chartColors.length]}
                  strokeWidth={safeActiveIndex === index ? 29 : 22}
                  strokeLinecap="round"
                  strokeDasharray={`${Math.max(dash - 3, 1)} ${circumference}`}
                  strokeDashoffset={-offset}
                  className="cursor-pointer transition-all duration-200"
                  opacity={safeActiveIndex === index ? 1 : 0.72}
                  onMouseEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => setActiveIndex(index)}
                  tabIndex="0"
                  role="button"
                  aria-label={`${item.name}: ${item.count} projects`}
                />
            ))}
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div className="max-w-[155px] rounded-full bg-white/85 px-4 py-6 shadow-lg shadow-emerald-900/10 ring-1 ring-emerald-100">
              <p className="text-4xl font-bold leading-none text-slate-950">{activeItem.count}</p>
              <p className="mt-1 text-xs font-semibold uppercase text-emerald-700">
                {Math.round((activeItem.count / total) * 100)}%
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {formatCostMillions(activeItem.costMn)}
              </p>
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-700">{activeItem.name}</p>
            </div>
          </div>
        </div>

        {data.map((item, index) => {
          const isActive = safeActiveIndex === index
          const percent = Math.round((item.count / total) * 100)
          return (
            <button
              key={item.name}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => setActiveIndex(index)}
              className={`relative flex min-h-[92px] w-full items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left shadow-sm transition sm:max-w-none ${
                categoryOrbitPositions[index] || ''
              } ${
                isActive
                  ? 'border-emerald-300 bg-emerald-50 shadow-lg shadow-emerald-900/12 ring-1 ring-emerald-100'
                  : 'border-slate-200 bg-white shadow-slate-900/5 hover:border-emerald-200 hover:bg-emerald-50/40 hover:shadow-md hover:shadow-emerald-900/8'
              }`}
            >
              <span
                className="pointer-events-none absolute inset-y-0 left-0 w-1"
                style={{ backgroundColor: chartColors[index % chartColors.length] }}
              />
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white via-white to-emerald-50/45" />
              <span
                className="relative h-3.5 w-3.5 shrink-0 rounded-full shadow-sm ring-4 ring-white"
                style={{ backgroundColor: chartColors[index % chartColors.length] }}
              />
              <span className="relative min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">{item.name}</span>
                <span className="text-xs text-slate-400">{percent}% of projects</span>
                <span className="block text-xs font-semibold text-emerald-700">{formatCostMillions(item.costMn)}</span>
              </span>
              <span className="relative grid h-10 min-w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white px-2 text-sm font-bold tabular-nums text-slate-800 shadow-inner">
                {item.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ProjectDetailsFlow({
  projects,
  divisionCatalog = [],
  phaseSelection,
  availablePhases = phaseOptions,
  onPhaseChange,
  onSelectProject,
  focusProjectId,
  onEditProject,
}) {
  const focusedProject = focusProjectId ? projects.find((project) => project.id === focusProjectId) : null
  const focusedSiblings = focusedProject
    ? projects
        .filter(
          (project) =>
            project.division === focusedProject.division && project.district === focusedProject.district,
        )
        .sort((a, b) => (Number(a.slide) || 9999) - (Number(b.slide) || 9999))
    : []
  const focusedIndex = focusedProject
    ? Math.max(focusedSiblings.findIndex((project) => project.id === focusedProject.id), 0)
    : 0
  const [selectedDivision, setSelectedDivision] = useState(focusedProject?.division || '')
  const [selectedDistrict, setSelectedDistrict] = useState(focusedProject?.district || '')
  const [projectIndex, setProjectIndex] = useState(focusedIndex)

  const divisionCards = useMemo(
    () => {
      const names = projects.length
        ? unique(projects.map((project) => project.division))
        : unique([...divisionCatalog.map((division) => division.name), ...projects.map((project) => project.division)])
      return names
        .map((name) => {
        const item = {
          name,
          count: projects.filter((project) => project.division === name).length,
        }
        const divisionProjects = projects.filter((project) => project.division === item.name)
        return {
          ...item,
          districts: unique(divisionProjects.map((project) => project.district)).length,
          media: divisionProjects.reduce((sum, project) => sum + (project.media?.length || 0), 0),
          categories: countBy(divisionProjects, 'category').slice(0, 3),
        }
      })
    },
    [divisionCatalog, projects],
  )

  const divisionProjects = useMemo(
    () => projects.filter((project) => project.division === selectedDivision),
    [projects, selectedDivision],
  )

  const districtCards = useMemo(
    () => {
      const names = divisionProjects.length
        ? unique(divisionProjects.map((project) => project.district))
        : unique([
            ...(divisionCatalog.find((division) => division.name === selectedDivision)?.districts || []),
            ...divisionProjects.map((project) => project.district),
          ])
      return names.map((name) => {
        const item = {
          name,
          count: divisionProjects.filter((project) => project.district === name).length,
        }
        const districtProjects = divisionProjects.filter((project) => project.district === item.name)
        return {
          ...item,
          media: districtProjects.reduce((sum, project) => sum + (project.media?.length || 0), 0),
          categories: countBy(districtProjects, 'category').slice(0, 3),
        }
      })
    },
    [divisionCatalog, divisionProjects, selectedDivision],
  )

  const districtProjects = useMemo(
    () =>
      divisionProjects
        .filter((project) => project.district === selectedDistrict)
        .sort((a, b) => (Number(a.slide) || 9999) - (Number(b.slide) || 9999)),
    [divisionProjects, selectedDistrict],
  )

  const safeIndex = Math.min(projectIndex, Math.max(districtProjects.length - 1, 0))
  const currentProject = districtProjects[safeIndex]
  const pageTitle = selectedDistrict || selectedDivision || 'Divisions'
  const pageNote = selectedDistrict
    ? `${districtProjects.length} completed projects`
    : selectedDivision
      ? `${districtCards.length} districts`
      : `${divisionCards.length} divisions`
  const currentProjectLabel = districtProjects.length ? `${safeIndex + 1} / ${districtProjects.length}` : '0 / 0'

  function goBack() {
    if (selectedDistrict) {
      setSelectedDistrict('')
      setProjectIndex(0)
      return
    }
    setSelectedDivision('')
  }

  function chooseProject(index) {
    const next = districtProjects[index]
    setProjectIndex(index)
    if (next) onSelectProject(next.id)
  }

  function stepProject(direction) {
    if (!districtProjects.length) return
    const nextIndex = (safeIndex + direction + districtProjects.length) % districtProjects.length
    chooseProject(nextIndex)
  }

  const detailHeader = (
    <div className="card flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          {selectedDivision ? (
            <button
              type="button"
              onClick={goBack}
              className="group no-print inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50 px-4 text-sm font-bold text-slate-700 shadow-sm shadow-emerald-950/5 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:text-emerald-800 hover:shadow-lg hover:shadow-emerald-950/10 sm:w-auto"
            >
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-600 group-hover:text-white">
                <ArrowLeft size={16} />
              </span>
              <span>Back</span>
            </button>
          ) : null}
          <div className="min-w-0">
            <h2 className="break-words text-xl font-bold text-slate-900 sm:text-2xl">{pageTitle}</h2>
            <p className="mt-0.5 text-sm text-slate-400">{pageNote}</p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
          {selectedDistrict ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-3 py-2 shadow-sm shadow-emerald-900/5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700/70">Current project</p>
                <p className="mt-0.5 text-base font-black leading-none text-slate-900">{currentProjectLabel}</p>
              </div>
              <DetailPhaseSelector
                options={availablePhases}
                value={phaseSelection}
                onChange={onPhaseChange}
              />
            </div>
          ) : null}
          {selectedDistrict && districtProjects.length ? (
            <div className="no-print flex flex-wrap gap-2">
              <button type="button" onClick={() => stepProject(-1)} className="btn-secondary flex-1 sm:flex-none">
                <ArrowLeft size={16} />
                Previous
              </button>
              <button type="button" onClick={() => stepProject(1)} className="btn-primary flex-1 sm:flex-none">
                Next
                <ArrowRight size={16} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )

  if (!projects.length) {
    return (
      <section className="space-y-4">
        {detailHeader}
        <div className="card grid min-h-[320px] place-items-center p-5 text-center sm:min-h-[420px] sm:p-6">
          <div>
            <TableProperties className="mx-auto text-slate-300" size={36} />
            <h2 className="mt-3 text-xl font-bold text-slate-800">No projects</h2>
            <p className="mt-1 text-sm text-slate-400">This phase does not have data yet.</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {/* Breadcrumb header */}
      {detailHeader}

      {/* Division grid */}
      {!selectedDivision ? (
        <div className="print-card-grid grid gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-4">
          {divisionCards.map((divisionItem) => (
            <button
              key={divisionItem.name}
              type="button"
              onClick={() => {
                setSelectedDivision(divisionItem.name)
                setSelectedDistrict('')
                setProjectIndex(0)
              }}
              className="card-interactive group min-h-[180px] p-4 text-left sm:min-h-[210px] sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-white via-emerald-50 to-emerald-100 text-emerald-700 shadow-lg shadow-emerald-900/10 transition group-hover:-translate-y-0.5 group-hover:shadow-emerald-900/20">
                  <span className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-white/70" />
                  <MapPinned className="relative" size={21} strokeWidth={2.25} />
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm shadow-slate-900/5 transition group-hover:border-emerald-200 group-hover:bg-emerald-600 group-hover:text-white group-hover:shadow-lg group-hover:shadow-emerald-900/20">
                  <ChevronRight size={15} />
                </span>
              </div>
              <h3 className="mt-5 break-words text-lg font-black tracking-tight text-slate-950">{divisionItem.name}</h3>
              <div className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2">
                <MetricPill label="Projects" value={divisionItem.count} />
                <MetricPill label="Districts" value={divisionItem.districts} />
                <MetricPill label="Media" value={divisionItem.media} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {divisionItem.categories.map((categoryItem) => (
                  <span
                    key={categoryItem.name}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm shadow-slate-900/5 transition group-hover:border-emerald-100 group-hover:bg-emerald-50 group-hover:text-emerald-800"
                  >
                    {categoryItem.name}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {/* District grid */}
      {selectedDivision && !selectedDistrict ? (
        <div className="print-card-grid grid gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3">
          {districtCards.map((districtItem) => (
            <button
              key={districtItem.name}
              type="button"
              onClick={() => {
                setSelectedDistrict(districtItem.name)
                setProjectIndex(0)
                const firstProject = divisionProjects
                  .filter((project) => project.district === districtItem.name)
                  .sort((a, b) => (Number(a.slide) || 9999) - (Number(b.slide) || 9999))[0]
                if (firstProject) onSelectProject(firstProject.id)
              }}
              className="card-interactive group p-4 text-left sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-200 bg-gradient-to-br from-white via-emerald-50 to-emerald-100 text-emerald-700 shadow-lg shadow-emerald-900/10 transition group-hover:-translate-y-0.5 group-hover:shadow-emerald-900/20">
                  <MapPin size={20} />
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm shadow-slate-900/5 transition group-hover:border-emerald-200 group-hover:bg-emerald-600 group-hover:text-white group-hover:shadow-lg group-hover:shadow-emerald-900/20">
                  <ChevronRight size={15} />
                </span>
              </div>
              <h3 className="mt-5 break-words text-lg font-black tracking-tight text-slate-950">{districtItem.name}</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MetricPill label="Projects" value={districtItem.count} />
                <MetricPill label="Media" value={districtItem.media} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {districtItem.categories.map((categoryItem) => (
                  <span
                    key={categoryItem.name}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm shadow-slate-900/5 transition group-hover:border-emerald-100 group-hover:bg-emerald-50 group-hover:text-emerald-800"
                  >
                    {categoryItem.name}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {/* Project detail view */}
      {selectedDistrict && !districtProjects.length ? (
        <section className="card grid min-h-[260px] place-items-center p-6 text-center">
          <div>
            <MapPin className="mx-auto text-slate-300" size={34} />
            <h3 className="mt-3 text-lg font-bold text-slate-800">{selectedDistrict}</h3>
            <p className="mt-1 text-sm text-slate-400">
              This district is listed under {selectedDivision}, but no completed project is recorded yet.
            </p>
          </div>
        </section>
      ) : null}

      {selectedDistrict && districtProjects.length ? (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]">
          {/* Sidebar */}
          <aside className="card no-print h-fit max-h-[52vh] overflow-auto p-3 xl:max-h-[720px]">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Project Sequence</h3>
                <p className="text-xs text-slate-400">
                  {safeIndex + 1} of {districtProjects.length}
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                {selectedDistrict}
              </span>
            </div>
            <div className="space-y-1.5">
              {districtProjects.map((project, index) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => chooseProject(index)}
                  className={`project-item ${index === safeIndex ? 'project-item-active' : ''}`}
                >
                  <span className="flex items-start gap-2.5">
                    <span className="icon-box mt-0.5 h-6 w-6 shrink-0 rounded-md text-xs font-bold">
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">
                        {project.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">
                        {project.category}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {/* Main */}
          <div className="space-y-4">
            {currentProject ? (
              <ProjectDetail project={currentProject} onEditProject={onEditProject} />
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function AdminModal({
  open,
  authed,
  setAuthed,
  onClose,
  onUnlock,
  projects,
  selectedProject,
  divisions,
  phaseOptions: editorPhaseOptions = projectPhaseOptions,
  adminPassword = FALLBACK_ADMIN_PASSWORD,
  saveProjects,
  resetProjects,
  setSelectedId,
  notify,
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState(selectedProject || createBlankProject(divisions))
  const [mediaText, setMediaText] = useState(mediaToText(selectedProject?.media))
  const categoryOptions = useMemo(
    () => unique(['Infrastructure', ...projects.map((project) => project.category), form.category]),
    [form.category, projects],
  )

  function unlock(event) {
    event.preventDefault()
    if (password === adminPassword) {
      setAuthed(true)
      setError('')
      setPassword('')
      notify?.('Admin unlocked', 'Editor access is enabled.', 'success')
      onUnlock?.(password)
      return
    }
    setError('Password is incorrect')
    notify?.('Unlock failed', 'Password is incorrect.', 'error')
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function startNew() {
    const next = createBlankProject(divisions)
    setForm(next)
    setMediaText('')
  }

  function saveCurrent() {
    const cleaned = cleanProject({ ...form, media: mediaFromText(mediaText) })
    const exists = projects.some((project) => project.id === cleaned.id)
    const next = exists
      ? projects.map((project) => (project.id === cleaned.id ? cleaned : project))
      : [cleaned, ...projects]
    saveProjects(next)
    setSelectedId(cleaned.id)
    setForm(cleaned)
    notify?.('Project saved', cleaned.title, 'success')
  }

  function deleteCurrent() {
    if (!form.id) return
    const next = projects.filter((project) => project.id !== form.id)
    saveProjects(next)
    setSelectedId(next[0]?.id || '')
    notify?.('Project deleted', form.title || 'Project removed.', 'success')
    startNew()
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="icon-box h-9 w-9 rounded-lg">
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Admin</h2>
                  <p className="text-xs text-slate-400">Project records and media links</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-400 transition hover:text-slate-700"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            {!authed ? (
              <form onSubmit={unlock} className="mx-auto max-w-sm p-8">
                <div className="mb-6 text-center">
                  <span className="icon-box mx-auto mb-3 h-12 w-12 rounded-xl">
                    <LockKeyhole size={22} />
                  </span>
                  <h3 className="text-base font-bold text-slate-900">Enter admin password</h3>
                </div>
                <label className="block text-sm font-medium text-slate-700" htmlFor="admin-password">
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                  className="form-input"
                />
                {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}
                <button type="submit" className="btn-primary mt-4 w-full justify-center">
                  <Check size={16} />
                  Unlock
                </button>
              </form>
            ) : (
              <div className="grid max-h-[calc(92vh-66px)] grid-cols-1 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="overflow-auto border-b border-slate-100 bg-white p-3 lg:border-b-0 lg:border-r">
                  <div className="mb-3 flex gap-2">
                    <button type="button" onClick={startNew} className="btn-primary h-9 text-xs">
                      <Plus size={14} />
                      New
                    </button>
                  </div>
                  <div className="space-y-1">
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => {
                          setForm(project)
                          setMediaText(mediaToText(project.media))
                        }}
                        className={`w-full truncate rounded-lg border px-3 py-2 text-left text-sm transition ${
                          project.id === form.id
                            ? 'border-emerald-300 bg-emerald-50 font-semibold text-emerald-800'
                            : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {project.title}
                      </button>
                    ))}
                  </div>
                </aside>

                <main className="overflow-auto p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {fieldList.map(([name, label]) => (
                      <label key={name} className={name === 'title' ? 'block sm:col-span-2' : 'block'}>
                        <ProjectFieldInput
                          name={name}
                          label={label}
                          value={form[name] || ''}
                          onChange={updateField}
                          categoryOptions={categoryOptions}
                          phaseOptions={editorPhaseOptions}
                        />
                      </label>
                    ))}
                    <label className="block sm:col-span-2">
                      <span className="form-label">Scope</span>
                      <textarea
                        rows="3"
                        value={form.scope || ''}
                        onChange={(event) => updateField('scope', event.target.value)}
                        className="form-textarea"
                      />
                    </label>
                  </div>

                  {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}

                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" onClick={saveCurrent} className="btn-primary">
                      <Save size={15} />
                      Save
                    </button>
                    <button type="button" onClick={deleteCurrent} className="btn-danger">
                      <Trash2 size={15} />
                      Delete
                    </button>
                    <button type="button" onClick={resetProjects} className="btn-secondary">
                      <RotateCcw size={15} />
                      Reset
                    </button>
                  </div>
                </main>
              </div>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function AdminPanel({
  projects,
  selectedProject,
  divisions,
  phaseOptions: editorPhaseOptions = projectPhaseOptions,
  divisionCatalog = [],
  saveProjects,
  resetProjects,
  setSelectedId,
  onLock,
  onViewProject,
  onAddPhase,
  onAddDivision,
  onAddDistrict,
  onDeletePhase,
  onDeleteDivision,
  onDeleteDistrict,
  uploadProjectMedia,
  adminPassword = FALLBACK_ADMIN_PASSWORD,
  notify,
}) {
  function districtOptionsFor(divisionName) {
    if (!divisionName) return []
    const baseDistricts =
      divisionCatalog.find((division) => division.name === divisionName)?.districts || []
    const projectDistricts = projects
      .filter((project) => project.division === divisionName)
      .map((project) => project.district)
    return unique([...baseDistricts, ...projectDistricts])
  }

  function blankProjectFor(divisionName, districtName) {
    const next = createBlankProject(divisions)
    return {
      ...next,
      division: divisionName || next.division,
      district: districtName || '',
    }
  }

  const initialDivision = selectedProject?.division || divisions[0] || ''
  const initialDistrict =
    selectedProject?.district || districtOptionsFor(initialDivision)[0] || ''
  const [selectedDivision, setSelectedDivision] = useState(initialDivision)
  const [selectedDistrict, setSelectedDistrict] = useState(initialDistrict)
  const [selectedPhase, setSelectedPhase] = useState(selectedProject?.phase || 'Phase 1')
  const [form, setForm] = useState(
    selectedProject || blankProjectFor(initialDivision, initialDistrict),
  )
  const [error, setError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const divisionOptions = useMemo(
    () => unique([...divisions, ...projects.map((project) => project.division)]),
    [divisions, projects],
  )
  const categoryOptions = useMemo(
    () => unique(['Infrastructure', ...projects.map((project) => project.category), form.category]),
    [form.category, projects],
  )
  const districtOptions = districtOptionsFor(selectedDivision)
  const districtProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.division === selectedDivision && project.district === selectedDistrict,
      ),
    [projects, selectedDistrict, selectedDivision],
  )
  const phaseDistrictProjects = useMemo(
    () => districtProjects.filter((project) => (project.phase || 'Phase 1') === selectedPhase),
    [districtProjects, selectedPhase],
  )

  function pluralize(count, label) {
    return `${count} ${label}${count === 1 ? '' : 's'}`
  }

  function deleteDetail(kind, affectedProjects) {
    if (kind === 'Project') return 'This project record will be deleted.'
    if (affectedProjects) {
      return `${pluralize(affectedProjects, 'project')} under this ${kind.toLowerCase()} will also be deleted.`
    }
    return `Only the ${kind.toLowerCase()} catalog entry will be deleted.`
  }

  function requestDelete(kind, name, affectedProjects, onConfirm) {
    if (!adminPassword) {
      notify?.('Delete blocked', 'Admin password is missing from the active database.', 'error')
      return false
    }
    setDeleteConfirm({ kind, name, affectedProjects, onConfirm })
    setDeletePassword('')
    setDeleteError('')
    return true
  }

  function closeDeleteConfirm() {
    setDeleteConfirm(null)
    setDeletePassword('')
    setDeleteError('')
  }

  function submitDeleteConfirm(event) {
    event.preventDefault()
    if (!deleteConfirm) return
    if (deletePassword !== adminPassword) {
      setDeleteError('Password is incorrect')
      notify?.('Delete blocked', 'Password is incorrect. Nothing was deleted.', 'error')
      return
    }
    deleteConfirm.onConfirm?.()
    closeDeleteConfirm()
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
    if (name === 'phase') setSelectedPhase(value)
  }

  function addPhaseFromEditor() {
    const name = window.prompt('New phase name', `Phase ${editorPhaseOptions.length + 1}`)?.trim()
    if (!name) return
    if (onAddPhase?.(name)) changePhase(name)
  }

  function deleteSelectedPhase() {
    if (!selectedPhase) return
    if (editorPhaseOptions.length <= 1) {
      notify?.('Delete blocked', 'Create another phase before deleting the last one.', 'error')
      return
    }
    const affectedProjects = projects.filter((project) => (project.phase || 'Phase 1') === selectedPhase).length
    requestDelete('Phase', selectedPhase, affectedProjects, () => {
      const nextPhase = editorPhaseOptions.find((phase) => phase !== selectedPhase) || ''
      onDeletePhase?.(selectedPhase)
      setSelectedPhase(nextPhase)
      setForm({ ...blankProjectFor(selectedDivision, selectedDistrict), phase: nextPhase || 'Phase 1' })
      setSelectedId('')
      setError('')
    })
  }

  function addDivisionFromEditor() {
    const name = window.prompt('New division name', 'New Division')?.trim()
    if (!name) return
    if (onAddDivision?.(name)) {
      setSelectedDivision(name)
      setSelectedDistrict('')
      setForm({ ...blankProjectFor(name, ''), phase: selectedPhase })
      setSelectedId('')
      setError('')
    }
  }

  function deleteSelectedDivision() {
    if (!selectedDivision) return
    if (divisionOptions.length <= 1) {
      notify?.('Delete blocked', 'Create another division before deleting the last one.', 'error')
      return
    }
    const affectedProjects = projects.filter((project) => project.division === selectedDivision).length
    requestDelete('Division', selectedDivision, affectedProjects, () => {
      const nextDivision = divisionOptions.find((division) => division !== selectedDivision) || ''
      const nextDistrict = districtOptionsFor(nextDivision)[0] || ''
      onDeleteDivision?.(selectedDivision)
      setSelectedDivision(nextDivision)
      setSelectedDistrict(nextDistrict)
      setForm({ ...blankProjectFor(nextDivision, nextDistrict), phase: selectedPhase })
      setSelectedId('')
      setError('')
    })
  }

  function addDistrictFromEditor() {
    if (!selectedDivision) {
      setError('Select or create a division first')
      notify?.('Select division first', 'Create the division before adding its district.', 'error')
      return
    }
    const name = window.prompt(`New district in ${selectedDivision}`, 'New District')?.trim()
    if (!name) return
    if (onAddDistrict?.(selectedDivision, name)) {
      setSelectedDistrict(name)
      setForm({ ...blankProjectFor(selectedDivision, name), phase: selectedPhase })
      setSelectedId('')
      setError('')
    }
  }

  function deleteSelectedDistrict() {
    if (!selectedDivision || !selectedDistrict) return
    const affectedProjects = projects.filter(
      (project) => project.division === selectedDivision && project.district === selectedDistrict,
    ).length
    requestDelete('District', selectedDistrict, affectedProjects, () => {
      const nextDistrict = districtOptions.find((district) => district !== selectedDistrict) || ''
      onDeleteDistrict?.(selectedDivision, selectedDistrict)
      setSelectedDistrict(nextDistrict)
      setForm({ ...blankProjectFor(selectedDivision, nextDistrict), phase: selectedPhase })
      setSelectedId('')
      setError('')
    })
  }

  function selectProjectFor(divisionName, districtName) {
    const firstProject = projects.find(
      (project) =>
        project.division === divisionName &&
        project.district === districtName &&
        (project.phase || 'Phase 1') === selectedPhase,
    )
    setForm(firstProject || { ...blankProjectFor(divisionName, districtName), phase: selectedPhase })
    if (firstProject) setSelectedId(firstProject.id)
  }

  function changePhase(phase) {
    setSelectedPhase(phase)
    const firstProject = projects.find(
      (project) =>
        project.division === selectedDivision &&
        project.district === selectedDistrict &&
        (project.phase || 'Phase 1') === phase,
    )
    setForm(firstProject || { ...blankProjectFor(selectedDivision, selectedDistrict), phase })
    setSelectedId(firstProject?.id || '')
    setError('')
  }

  function changeDivision(divisionName) {
    const nextDistricts = districtOptionsFor(divisionName)
    const nextDistrict = nextDistricts.includes(selectedDistrict)
      ? selectedDistrict
      : nextDistricts[0] || ''
    setSelectedDivision(divisionName)
    setSelectedDistrict(nextDistrict)
    selectProjectFor(divisionName, nextDistrict)
    setError('')
  }

  function changeDistrict(districtName) {
    setSelectedDistrict(districtName)
    selectProjectFor(selectedDivision, districtName)
    setError('')
  }

  async function uploadMedia(event, mediaType) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return

    try {
      const projectId = form.id || `project-${Date.now()}`
      const existingMedia = Array.isArray(form.media) ? form.media : []
      const typeCount = existingMedia.filter((item) => item.type === mediaType).length
      const kind = mediaType === 'video' ? 'vid' : 'img'
      const timestamp = Date.now()
      let uploaded = []

      if (uploadProjectMedia && navigator.onLine) {
        try {
          uploaded = await uploadProjectMedia(
            projectId,
            files,
            mediaType,
            existingMedia.length,
            typeCount,
          )
        } catch (remoteError) {
          notify?.(
            'Online media upload skipped',
            `${remoteError.message || 'Server unavailable'} Saved on this laptop instead.`,
            'info',
          )
        }
      }

      if (!uploaded.length) {
        uploaded = await Promise.all(
          files.map(async (file, index) => {
            const order = existingMedia.length + index + 1
            const num = typeCount + index + 1
            const mediaId = `${projectId}-upload-${kind}-${String(num).padStart(2, '0')}-${timestamp}`
            await saveMediaBlob(mediaId, file)
            return {
              id: mediaId,
              projectId,
              type: mediaType,
              src: URL.createObjectURL(file),
              name: file.name,
              originalName: file.name,
              mimeType: file.type,
              size: file.size,
              order,
              uploaded: true,
              localBlob: true,
              storageKey: mediaId,
            }
          }),
        )
      }
      setForm((current) => ({
        ...current,
        id: projectId,
        media: [...existingMedia, ...uploaded],
      }))
      notify?.(
        uploaded.some((item) => item.synced)
          ? mediaType === 'video' ? 'Videos uploaded online' : 'Images uploaded online'
          : mediaType === 'video' ? 'Videos uploaded locally' : 'Images uploaded locally',
        `${uploaded.length} file${uploaded.length === 1 ? '' : 's'} added. Press Save to link it to the project.`,
        'success',
      )
      setError('')
    } catch (uploadError) {
      setError(uploadError.message || 'Upload failed')
      notify?.('Upload failed', uploadError.message || 'Please try again.', 'error')
    } finally {
      event.target.value = ''
    }
  }

  function uploadImages(event) { return uploadMedia(event, 'image') }
  function uploadVideos(event) { return uploadMedia(event, 'video') }

  async function removeMedia(mediaId) {
    const mediaItem = (form.media || []).find((item) => item.id === mediaId)
    setForm((current) => ({
      ...current,
      media: (current.media || []).filter((item) => item.id !== mediaId),
    }))
    if (mediaItem?.localBlob && mediaItem.storageKey) {
      try {
        await deleteMediaBlob(mediaItem.storageKey)
      } catch {
        // Keeping the UI responsive matters more than blocking on local cleanup.
      }
    }
    notify?.('Media removed', mediaItem?.name || 'File removed from this project.', 'success')
  }

  function startNew() {
    if (!selectedDivision || !selectedDistrict) {
      setError('Select a division and district first')
      return
    }
    const next = blankProjectFor(selectedDivision, selectedDistrict)
    setForm({ ...next, phase: selectedPhase })
    notify?.('New project ready', `${selectedPhase} / ${selectedDistrict}`, 'info')
    setError('')
  }

  function saveCurrent() {
    if (!selectedDivision || !selectedDistrict) {
      setError('Select a division and district before saving')
      return
    }
    const cleaned = cleanProject({
      ...form,
      division: selectedDivision,
      district: selectedDistrict,
      phase: selectedPhase,
      id: form.id || `project-${Date.now()}`,
    })
    const exists = projects.some((project) => project.id === cleaned.id)
    const next = exists
      ? projects.map((project) => (project.id === cleaned.id ? cleaned : project))
      : [cleaned, ...projects]
    saveProjects(next)
    setSelectedId(cleaned.id)
    setForm(cleaned)
    notify?.('Project saved', cleaned.title, 'success')
    setError('')
  }

  function deleteCurrent() {
    if (!form.id) return
    requestDelete('Project', form.title || 'Untitled project', 0, () => {
      const next = projects.filter((project) => project.id !== form.id)
      const nextDistrictProjects = next.filter(
        (project) =>
          project.division === selectedDivision &&
          project.district === selectedDistrict &&
          (project.phase || 'Phase 1') === selectedPhase,
      )
      const replacement = nextDistrictProjects[0]
      saveProjects(next)
      setSelectedId(replacement?.id || '')
      setForm(replacement || { ...blankProjectFor(selectedDivision, selectedDistrict), phase: selectedPhase })
      notify?.('Project deleted', form.title || 'Project removed.', 'success')
    })
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-100 bg-white px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">Data Insertion & Edition</h2>
        </div>
        <div className="flex w-full flex-wrap items-end gap-2 xl:w-auto xl:justify-end">
          <label className="min-w-[130px] flex-1 sm:flex-none">
            <span className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Phase
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={addPhaseFromEditor}
                  className="rounded-full px-1.5 py-0.5 text-[10px] text-emerald-700 transition hover:bg-emerald-50"
                  title="Add phase"
                >
                  + Add
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedPhase}
                  className="rounded-full px-1.5 py-0.5 text-[10px] text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Delete selected phase"
                  disabled={!selectedPhase}
                >
                  Delete
                </button>
              </span>
            </span>
            <select
              value={selectedPhase}
              onChange={(event) => changePhase(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition hover:border-emerald-200 focus:border-emerald-400 focus:bg-white focus:shadow-[0_0_0_3px_rgba(16,185,129,0.10)]"
            >
              {editorPhaseOptions.map((phase) => (
                <option key={phase} value={phase}>
                  {phase}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[180px] flex-1 sm:flex-none">
            <span className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Division
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={addDivisionFromEditor}
                  className="rounded-full px-1.5 py-0.5 text-[10px] text-emerald-700 transition hover:bg-emerald-50"
                  title="Add division"
                >
                  + Add
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedDivision}
                  className="rounded-full px-1.5 py-0.5 text-[10px] text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Delete selected division"
                  disabled={!selectedDivision}
                >
                  Delete
                </button>
              </span>
            </span>
            <select
              value={selectedDivision}
              onChange={(event) => changeDivision(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition hover:border-emerald-200 focus:border-emerald-400 focus:bg-white focus:shadow-[0_0_0_3px_rgba(16,185,129,0.10)]"
            >
              {divisionOptions.map((division) => (
                <option key={division} value={division}>
                  {division}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[150px] flex-1 sm:flex-none">
            <span className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              District
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={addDistrictFromEditor}
                  className="rounded-full px-1.5 py-0.5 text-[10px] text-emerald-700 transition hover:bg-emerald-50"
                  title="Add district"
                >
                  + Add
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedDistrict}
                  className="rounded-full px-1.5 py-0.5 text-[10px] text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Delete selected district"
                  disabled={!selectedDivision || !selectedDistrict}
                >
                  Delete
                </button>
              </span>
            </span>
            <select
              value={selectedDistrict}
              onChange={(event) => changeDistrict(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-800 outline-none transition hover:border-emerald-200 focus:border-emerald-400 focus:bg-white focus:shadow-[0_0_0_3px_rgba(16,185,129,0.10)]"
              disabled={!districtOptions.length}
            >
              {districtOptions.map((district) => (
                <option key={district} value={district}>
                  {district}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={startNew}
            className="btn-primary h-10 flex-1 self-end whitespace-nowrap px-4 text-sm sm:flex-none"
            disabled={!selectedDivision || !selectedDistrict}
          >
            <Plus size={15} />
            New project
          </button>
          <button type="button" onClick={onLock} className="btn-secondary h-10 flex-1 self-end sm:flex-none">
            <LockKeyhole size={15} />
            Lock
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 overflow-hidden lg:min-h-[620px] lg:grid-cols-[minmax(270px,340px)_minmax(0,1fr)]">
        <aside className="max-h-[420px] overflow-auto border-b border-slate-100 bg-slate-50 p-3 lg:max-h-[620px] lg:border-b-0 lg:border-r">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <p className="form-label">Existing projects</p>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                {phaseDistrictProjects.length}
              </span>
            </div>
            <div className="space-y-1">
              {phaseDistrictProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    setForm(project)
                    setSelectedPhase(project.phase || 'Phase 1')
                    setSelectedId(project.id)
                    setError('')
                  }}
                  className={`w-full truncate rounded-lg border px-3 py-2 text-left text-sm transition ${
                    project.id === form.id
                      ? 'border-emerald-300 bg-emerald-50 font-semibold text-emerald-800'
                      : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white'
                  }`}
                >
                  {project.title}
                </button>
              ))}
              {!phaseDistrictProjects.length ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-400">
                  No project is saved for this phase in this district yet. Use New project in district to add one.
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <main className="overflow-auto p-4 lg:max-h-[620px] lg:p-5">
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="form-label">Editing location</p>
              <p className="mt-1 text-sm font-semibold text-emerald-900">
                {selectedPhase} / {selectedDivision || 'Select division'} / {selectedDistrict || 'Select district'}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <p className="text-xs font-medium text-emerald-700">
                Project ID is created automatically.
              </p>
              <button
                type="button"
                onClick={() => onViewProject?.(form.id)}
                disabled={!form.id || !projects.some((project) => project.id === form.id)}
                className="btn-secondary h-9 w-full text-xs sm:w-auto"
              >
                <TableProperties size={14} />
                View details
              </button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {fieldList.map(([name, label]) => (
              <label key={name} className={name === 'title' ? 'block md:col-span-2' : 'block'}>
                <ProjectFieldInput
                  name={name}
                  label={label}
                  value={form[name] || ''}
                  onChange={updateField}
                  categoryOptions={categoryOptions}
                  phaseOptions={editorPhaseOptions}
                />
              </label>
            ))}
            <label className="block md:col-span-2">
              <span className="form-label">Short description</span>
              <textarea
                rows="2"
                value={form.description || ''}
                onChange={(event) => updateField('description', event.target.value)}
                className="form-textarea"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="form-label">Scope</span>
              <textarea
                rows="3"
                value={form.scope || ''}
                onChange={(event) => updateField('scope', event.target.value)}
                className="form-textarea"
              />
            </label>
            {/* Image upload */}
            <div className="md:col-span-2">
              <div className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="form-label">Project images</p>
                  <p className="mt-1 text-sm text-slate-500">Upload any number of images. No app limit.</p>
                </div>
                <label className="btn-secondary w-full cursor-pointer sm:w-fit">
                  <Upload size={15} />
                  Upload images
                  <input type="file" accept="image/*" multiple className="hidden" onChange={uploadImages} />
                </label>
              </div>
              {(form.media || []).filter((item) => item.type !== 'video').length ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(form.media || [])
                    .filter((item) => item.type !== 'video')
                    .map((item) => (
                      <div key={item.id || item.src} className="overflow-hidden rounded-xl border border-slate-100 bg-white">
                        <img
                          src={item.src}
                          alt={item.name || 'Project image'}
                          className="aspect-video w-full bg-slate-100 object-cover"
                          loading="lazy"
                        />
                        <div className="flex items-center justify-between gap-2 p-2">
                          <p className="min-w-0 truncate text-xs font-medium text-slate-500">{item.name || item.id}</p>
                          <button
                            type="button"
                            onClick={() => removeMedia(item.id)}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-red-100 text-red-500 transition hover:bg-red-50"
                            title="Remove"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>

            {/* Video upload */}
            <div className="md:col-span-2">
              <div className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="form-label">Project videos</p>
                  <p className="mt-1 text-sm text-slate-500">Upload any number of videos. No app limit.</p>
                </div>
                <label className="btn-secondary w-full cursor-pointer sm:w-fit">
                  <Video size={15} />
                  Upload videos
                  <input type="file" accept="video/*" multiple className="hidden" onChange={uploadVideos} />
                </label>
              </div>
              {(form.media || []).filter((item) => item.type === 'video').length ? (
                <div className="mt-3 space-y-2">
                  {(form.media || [])
                    .filter((item) => item.type === 'video')
                    .map((item) => (
                      <div key={item.id || item.src} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white p-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="icon-box h-8 w-8 shrink-0 rounded-lg">
                            <Video size={15} />
                          </span>
                          <p className="min-w-0 truncate text-sm font-medium text-slate-700">{item.name || item.id}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeMedia(item.id)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-red-100 text-red-500 transition hover:bg-red-50"
                          title="Remove"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
          </div>

          {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={saveCurrent} className="btn-primary">
              <Save size={15} />
              Save
            </button>
            <button type="button" onClick={deleteCurrent} className="btn-danger">
              <Trash2 size={15} />
              Delete
            </button>
            <button type="button" onClick={resetProjects} className="btn-secondary">
              <RotateCcw size={15} />
              Reset
            </button>
          </div>
        </main>
      </div>

      <AnimatePresence>
        {deleteConfirm ? (
          <motion.div
            className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.form
              onSubmit={submitDeleteConfirm}
              className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-5 shadow-2xl shadow-slate-950/20"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
            >
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600">
                  <Trash2 size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-950">
                    Delete {deleteConfirm.kind}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-slate-700">
                    {deleteConfirm.name}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm leading-6 text-red-800">
                <p className="font-bold">Warning</p>
                <p>{deleteDetail(deleteConfirm.kind, deleteConfirm.affectedProjects)}</p>
                <p>This cannot be undone from the editor.</p>
              </div>

              <label className="mt-4 block">
                <span className="form-label">Confirm admin password</span>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(event) => {
                    setDeletePassword(event.target.value)
                    setDeleteError('')
                  }}
                  autoFocus
                  className="form-input"
                />
              </label>
              {deleteError ? <p className="mt-2 text-sm font-medium text-red-600">{deleteError}</p> : null}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeDeleteConfirm} className="btn-secondary justify-center">
                  Cancel
                </button>
                <button type="submit" className="btn-danger justify-center">
                  <LockKeyhole size={15} />
                  Confirm delete
                </button>
              </div>
            </motion.form>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}

function ProposalReviewPanel({
  documents,
  selectedDocumentId,
  onSelectDocument,
  onUploadDocument,
  onSaveDocument,
  adminAuthed,
  onRequestAdmin,
  notify,
}) {
  const fileInputRef = useRef(null)
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) || documents[0] || null
  const [draftDocument, setDraftDocument] = useState(() =>
    selectedDocument ? cleanProposalDocument(selectedDocument) : null,
  )
  const [query, setQuery] = useState('')
  const [districtFilter, setDistrictFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [recommendationFilter, setRecommendationFilter] = useState('All')
  const [uploading, setUploading] = useState(false)

  const rows = useMemo(() => draftDocument?.rows || [], [draftDocument])
  const summary = useMemo(() => {
    const yes = rows.filter((row) => row.recommendation === 'Yes').length
    const no = rows.filter((row) => row.recommendation === 'No').length
    const assessed = rows.filter((row) => row.assessedByEngr || row.recommendation || row.remarksComd).length
    return {
      total: rows.length,
      costMn: rows.reduce((sum, row) => sum + (Number(row.costMn) || 0), 0),
      districts: unique(rows.map((row) => row.district)).length,
      categories: unique(rows.map((row) => row.category)).length,
      yes,
      no,
      pending: Math.max(rows.length - assessed, 0),
      assessed,
    }
  }, [rows])

  const districtOptions = useMemo(() => unique(rows.map((row) => row.district)), [rows])
  const categoryOptions = useMemo(() => unique(rows.map((row) => row.category)), [rows])
  const selectedSerialized = useMemo(
    () => JSON.stringify(cleanProposalDocument(selectedDocument || {}).rows || []),
    [selectedDocument],
  )
  const draftSerialized = useMemo(
    () => JSON.stringify(cleanProposalDocument(draftDocument || {}).rows || []),
    [draftDocument],
  )
  const hasUnsavedChanges = Boolean(selectedDocument && draftDocument && selectedSerialized !== draftSerialized)

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase()
    return rows.filter((row) => {
      const matchesSearch = !search || [
        row.description,
        row.district,
        row.category,
        row.executingAgency,
        row.submittedBy,
        row.sourceRemarks,
        row.assessedByEngr,
        row.remarksComd,
      ].some((value) => String(value || '').toLowerCase().includes(search))
      const matchesDistrict = districtFilter === 'All' || row.district === districtFilter
      const matchesCategory = categoryFilter === 'All' || row.category === categoryFilter
      const matchesRecommendation =
        recommendationFilter === 'All' ||
        (recommendationFilter === 'Unreviewed'
          ? !row.recommendation && !row.assessedByEngr && !row.remarksComd
          : row.recommendation === recommendationFilter)
      return matchesSearch && matchesDistrict && matchesCategory && matchesRecommendation
    })
  }, [categoryFilter, districtFilter, query, recommendationFilter, rows])

  async function handleUpload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!adminAuthed) {
      onRequestAdmin()
      notify('Unlock required', 'Unlock admin access before uploading proposal documents.', 'info')
      return
    }

    setUploading(true)
    try {
      const document = await parseProposalWorkbook(file)
      onUploadDocument(document)
    } catch (error) {
      notify('Proposal upload failed', error.message || 'The workbook could not be read.', 'error')
    } finally {
      setUploading(false)
    }
  }

  function updateRow(rowId, field, value) {
    if (!adminAuthed) {
      onRequestAdmin()
      return
    }
    setDraftDocument((current) => {
      if (!current) return current
      return cleanProposalDocument({
        ...current,
        rows: current.rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
      })
    })
  }

  function saveDraft() {
    if (!draftDocument || !adminAuthed) {
      onRequestAdmin()
      return
    }
    onSaveDocument(draftDocument)
  }

  const reviewPercent = summary.total ? Math.round((summary.assessed / summary.total) * 100) : 0
  const summaryCards = [
    {
      label: 'Proposals',
      value: summary.total,
      detail: `${filteredRows.length} visible`,
      icon: TableProperties,
      tone: 'from-blue-700 via-indigo-700 to-slate-900 shadow-blue-950/20',
      iconTone: 'bg-white/15 text-blue-50 ring-white/15',
    },
    {
      label: 'Estimated cost',
      value: formatCostMillions(summary.costMn),
      detail: 'Total proposal value',
      icon: CircleDollarSign,
      tone: 'from-emerald-700 via-teal-700 to-cyan-900 shadow-emerald-950/20',
      iconTone: 'bg-white/15 text-emerald-50 ring-white/15',
    },
    {
      label: 'Districts',
      value: summary.districts,
      detail: `${summary.categories} categories`,
      icon: MapPinned,
      tone: 'from-sky-700 via-cyan-700 to-blue-900 shadow-sky-950/20',
      iconTone: 'bg-white/15 text-cyan-50 ring-white/15',
    },
    {
      label: 'Recommended',
      value: summary.yes,
      detail: `${summary.no} marked no`,
      icon: Check,
      tone: 'from-lime-700 via-emerald-700 to-green-900 shadow-green-950/20',
      iconTone: 'bg-white/15 text-lime-50 ring-white/15',
    },
    {
      label: 'Pending review',
      value: summary.pending,
      detail: `${reviewPercent}% assessed`,
      icon: Info,
      tone: 'from-amber-600 via-orange-700 to-rose-900 shadow-orange-950/20',
      iconTone: 'bg-white/15 text-amber-50 ring-white/15',
    },
  ]

  return (
    <section className="relative space-y-5 overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-3 shadow-inner shadow-slate-200/70 sm:p-4">
      <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-blue-600 via-emerald-500 to-amber-400" />
      <div className="relative overflow-hidden rounded-[28px] border border-white/20 bg-gradient-to-br from-slate-950 via-blue-950 to-emerald-900 p-4 text-white shadow-2xl shadow-slate-950/25 sm:p-5">
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-emerald-400/15 to-transparent" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="relative min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full bg-white/12 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-50 ring-1 ring-white/15">
                E&E of P3 projs
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-300/15 px-3 py-1 text-xs font-bold text-emerald-50 ring-1 ring-emerald-200/25">
                <CalendarDays size={13} />
                {documents.length} document{documents.length === 1 ? '' : 's'}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ${
                hasUnsavedChanges
                  ? 'bg-amber-300/15 text-amber-50 ring-amber-200/25'
                  : 'bg-white/10 text-emerald-50 ring-white/15'
              }`}>
                <Save size={13} />
                {hasUnsavedChanges ? 'Unsaved review' : 'Saved'}
              </span>
            </div>
            <h2 className="mt-4 text-2xl font-black tracking-tight sm:text-4xl">
              Proposal evaluation desk
            </h2>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-emerald-50/80">
              Review uploaded P3 proposals by district, cost, assessment, recommendation, and command remarks.
            </p>
          </div>
          <div className="relative flex flex-wrap items-center gap-2 xl:justify-end">
            {!adminAuthed ? (
              <button type="button" onClick={onRequestAdmin} className="btn-secondary border-white/20 bg-white/10 text-white hover:bg-white/15">
                <LockKeyhole size={15} />
                Unlock to edit
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleUpload}
            />
            <button
              type="button"
              onClick={() => (adminAuthed ? fileInputRef.current?.click() : onRequestAdmin())}
              disabled={uploading}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-4 text-sm font-black text-blue-950 shadow-lg shadow-slate-950/25 transition hover:-translate-y-0.5 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {uploading ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading ? 'Reading file' : 'Upload proposal file'}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="min-w-0 space-y-4">
          {!draftDocument ? (
            <div className="grid min-h-[360px] place-items-center rounded-[28px] border border-dashed border-blue-200 bg-gradient-to-br from-white via-blue-50 to-emerald-50 p-8 text-center shadow-card">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-700 to-emerald-700 text-white shadow-lg shadow-blue-950/20">
                  <Upload size={22} />
                </span>
                <h3 className="mt-4 text-xl font-black text-slate-950">Upload the first proposal workbook</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                  The system will read the proposal rows, calculate the estimate, and add review columns for E&E tracking.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {summaryCards.map((card) => {
                  const Icon = card.icon
                  return (
                    <div key={card.label} className={`group relative overflow-hidden rounded-3xl bg-gradient-to-br ${card.tone} p-4 text-white shadow-xl transition hover:-translate-y-0.5 hover:shadow-2xl`}>
                      <div className="absolute inset-x-0 top-0 h-px bg-white/35" />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase tracking-wide text-white/70">{card.label}</p>
                          <p className="mt-2 truncate text-2xl font-black text-white">{card.value}</p>
                          <p className="mt-1 text-xs font-bold text-white/75">{card.detail}</p>
                        </div>
                        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ${card.iconTone}`}>
                          <Icon size={19} />
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="overflow-hidden rounded-[28px] border border-blue-100 bg-white shadow-xl shadow-slate-950/10">
                <div className="grid gap-4 border-b border-blue-100 bg-gradient-to-r from-blue-950 via-blue-900 to-emerald-900 p-4 text-white xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)_auto] xl:items-end">
                  <label className="min-w-0">
                    <span className="mb-2 block text-xs font-black uppercase tracking-wide text-blue-100/80">Proposal document</span>
                    <select
                      value={selectedDocument?.id || ''}
                      onChange={(event) => onSelectDocument(event.target.value)}
                      className="form-input h-11 border-white/15 bg-white/95 font-bold text-slate-950 shadow-none"
                      title="Select uploaded proposal document"
                    >
                      {documents.map((document) => (
                        <option key={document.id} value={document.id}>
                          {document.title} - {document.uploadedLabel}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="min-w-0 sm:col-span-2 xl:col-span-1">
                      <span className="mb-2 block text-xs font-black uppercase tracking-wide text-blue-100/80">Search</span>
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        className="form-input h-11 border-white/15 bg-white/95 text-slate-950 shadow-none"
                        placeholder="Search proposals"
                      />
                    </label>
                    <label>
                      <span className="mb-2 block text-xs font-black uppercase tracking-wide text-blue-100/80">District</span>
                      <select value={districtFilter} onChange={(event) => setDistrictFilter(event.target.value)} className="form-input h-11 border-white/15 bg-white/95 text-slate-950 shadow-none">
                        <option value="All">All districts</option>
                        {districtOptions.map((district) => <option key={district} value={district}>{district}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="mb-2 block text-xs font-black uppercase tracking-wide text-blue-100/80">Category</span>
                      <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="form-input h-11 border-white/15 bg-white/95 text-slate-950 shadow-none">
                        <option value="All">All categories</option>
                        {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="mb-2 block text-xs font-black uppercase tracking-wide text-blue-100/80">Recommendation</span>
                      <select
                        value={recommendationFilter}
                        onChange={(event) => setRecommendationFilter(event.target.value)}
                        className="form-input h-11 border-white/15 bg-white/95 text-slate-950 shadow-none"
                      >
                        <option value="All">All recommendations</option>
                        <option value="Unreviewed">Unreviewed</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    {hasUnsavedChanges ? (
                      <button type="button" onClick={() => setDraftDocument(cleanProposalDocument(selectedDocument))} className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 text-sm font-black text-white transition hover:bg-white/15">
                        <RotateCcw size={15} />
                        Discard
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={saveDraft}
                      disabled={!hasUnsavedChanges || !adminAuthed}
                      className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-4 text-sm font-black text-blue-950 shadow-lg shadow-slate-950/20 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                      title={!adminAuthed ? 'Unlock admin access to save' : 'Save proposal assessment'}
                    >
                      <Save size={15} />
                      {hasUnsavedChanges ? 'Save assessment' : 'Saved'}
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 bg-gradient-to-r from-white via-sky-50 to-emerald-50 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-xl font-black text-slate-950">{draftDocument.title}</h3>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800 ring-1 ring-blue-200">
                        {draftDocument.uploadedLabel}
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-600 via-emerald-500 to-amber-400" style={{ width: `${reviewPercent}%` }} />
                    </div>
                    <p className="mt-2 text-xs font-bold text-slate-400">
                      {filteredRows.length} of {rows.length} rows shown - {summary.assessed} assessed - {summary.pending} pending
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700 ring-1 ring-emerald-100">
                      {summary.yes} yes
                    </span>
                    <span className="rounded-full bg-rose-50 px-3 py-1.5 text-rose-700 ring-1 ring-rose-100">
                      {summary.no} no
                    </span>
                    <span className="rounded-full bg-slate-50 px-3 py-1.5 text-slate-500 ring-1 ring-slate-100">
                      {reviewPercent}% assessed
                    </span>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl shadow-slate-950/10">
                <div className="flex flex-col gap-2 border-b border-blue-900/20 bg-gradient-to-r from-blue-950 via-indigo-900 to-slate-950 p-4 text-white sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-blue-100/80">Proposal register</p>
                    <h3 className="mt-1 text-lg font-black text-white">
                      {filteredRows.length} proposal{filteredRows.length === 1 ? '' : 's'} in view
                    </h3>
                  </div>
                  <span className="w-fit rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-blue-50 ring-1 ring-white/15">
                    Sorted from uploaded workbook
                  </span>
                </div>

                <div className="space-y-4 bg-gradient-to-br from-slate-50 via-white to-blue-50/50 p-4">
                  {filteredRows.map((row) => {
                    const recommendationClass =
                      row.recommendation === 'Yes'
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                        : row.recommendation === 'No'
                          ? 'bg-rose-50 text-rose-700 ring-rose-100'
                          : 'bg-amber-50 text-amber-700 ring-amber-100'
                    return (
                      <article key={row.id} className="overflow-hidden rounded-[26px] border border-blue-100 bg-white shadow-lg shadow-slate-950/10 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-2xl hover:shadow-blue-950/10">
                        <div className="h-1.5 bg-gradient-to-r from-blue-600 via-emerald-500 to-amber-400" />
                        <div className="p-4 sm:p-5">
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
                          <div className="min-w-0">
                            <div className="flex items-start gap-3">
                              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-700 to-emerald-700 text-sm font-black text-white shadow-lg shadow-blue-950/20">
                                {row.serial}
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-base font-black leading-6 text-slate-950 sm:text-lg">
                                    {row.description || '-'}
                                  </h4>
                                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ring-1 ${recommendationClass}`}>
                                    {row.recommendation || 'Pending'}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs font-bold text-slate-400">
                                  {row.submittedBy || 'Not submitted'} - {row.phase}
                                </p>
                                {row.sourceRemarks ? (
                                  <p className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-sm font-medium leading-6 text-slate-700">
                                    {row.sourceRemarks}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                            {[
                              { label: 'District', value: row.district || '-', icon: MapPin },
                              { label: 'Category', value: row.category || 'Other', icon: Tags },
                              { label: 'Cost', value: formatCostMillions(row.costMn), icon: CircleDollarSign },
                              { label: 'Agency', value: row.executingAgency || '-', icon: Building2 },
                              { label: 'Status', value: row.status || 'Draft', icon: ShieldCheck },
                            ].map((item) => {
                              const Icon = item.icon
                              return (
                                <div
                                  key={item.label}
                                  className="min-w-0 rounded-2xl border border-blue-300/30 bg-gradient-to-br from-sky-950 via-blue-800 to-indigo-800 p-3 text-white shadow-lg shadow-blue-950/15 ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-950/20"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/15 text-blue-50">
                                      <Icon size={14} />
                                    </span>
                                    <span className="text-[10px] font-black uppercase tracking-wide text-blue-100/80">{item.label}</span>
                                  </div>
                                  <p className="mt-2 truncate text-sm font-black text-white">{item.value}</p>
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        <div className="mt-4 rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-3 shadow-sm shadow-amber-950/5">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-black uppercase tracking-wide text-amber-700">Review decision</p>
                              <p className="mt-1 text-xs font-semibold text-slate-600">Engineering assessment, recommendation, and command remarks</p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-100">
                              Row #{row.serial}
                            </span>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-[minmax(240px,0.9fr)_180px_minmax(280px,1.3fr)]">
                            <label className="min-w-0">
                              <span className="form-label mb-1.5 block">Asst by Engr</span>
                              <select
                                value={row.assessedByEngr}
                                onChange={(event) => updateRow(row.id, 'assessedByEngr', event.target.value)}
                                disabled={!adminAuthed}
                                className="form-input h-11 text-sm"
                              >
                                <option value="">Select assessment</option>
                                {ENGINEER_ASSESSMENT_OPTIONS.map((option) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span className="form-label mb-1.5 block">Recommendation</span>
                              <select
                                value={row.recommendation}
                                onChange={(event) => updateRow(row.id, 'recommendation', event.target.value)}
                                disabled={!adminAuthed}
                                className="form-input h-11 text-sm"
                              >
                                <option value="">Pending</option>
                                {RECOMMENDATION_OPTIONS.map((option) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            </label>
                            <label className="min-w-0">
                              <span className="form-label mb-1.5 block">Remarks Comd</span>
                              <textarea
                                value={row.remarksComd}
                                onChange={(event) => updateRow(row.id, 'remarksComd', event.target.value)}
                                disabled={!adminAuthed}
                                className="form-input min-h-[84px] resize-y text-sm leading-6"
                                placeholder="Remarks"
                              />
                            </label>
                          </div>
                        </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
                {!filteredRows.length ? (
                  <div className="grid min-h-[180px] place-items-center border-t border-slate-100 p-8 text-center">
                    <p className="text-sm font-semibold text-slate-400">No proposals match the current filters.</p>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function InsightsPanel({ projects, stats, phaseSelection }) {
  const divisionCounts = summarizeBy(projects, 'division')
  const districtCounts = summarizeBy(projects, 'district')
  const categoryCounts = summarizeMainCategories(projects)
  const videos = projects.reduce(
    (sum, project) => sum + (project.media || []).filter((item) => item.type === 'video').length,
    0,
  )
  const images = projects.reduce(
    (sum, project) => sum + (project.media || []).filter((item) => item.type !== 'video').length,
    0,
  )
  const topDivision = divisionCounts[0]
  const topDistrict = districtCounts[0]
  const topDistrictPhaseCounts = topDistrict
    ? ['Phase 1', 'Phase 2'].map((phase) => ({
        phase,
        count: projects.filter(
          (project) => project.district === topDistrict.name && (project.phase || 'Phase 1') === phase,
        ).length,
      }))
    : []
  const topDistrictMaxPhaseCount = Math.max(...topDistrictPhaseCounts.map((item) => item.count), 1)
  const completedPercent = stats.completed ? 100 : 0
  const mediaPercent = stats.media ? Math.min((stats.media / 1200) * 100, 100) : 0
  const budgetValueMn = Number(stats.budgetMn) || 0
  const budgetPercent = budgetValueMn ? Math.min((budgetValueMn / 15000) * 100, 100) : 0

  return (
    <div className="space-y-4">
      {/* KPI metric cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RingMetricCard
          icon={Check}
          label="Completed"
          value={stats.completed}
          detail={`${phaseSelection} completed projects`}
          percent={completedPercent}
        />
        <RingMetricCard
          icon={ImageIcon}
          label="Total media available"
          value={stats.media}
          detail={`${images} images / ${videos} videos`}
          percent={mediaPercent}
        />
        <RingMetricCard
          icon={CircleDollarSign}
          label="Budget"
          value={stats.budget}
          detail="Completed-project allocation"
          percent={budgetPercent}
        />
      </section>

      {/* Summary row */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="form-label">Top division</p>
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-700 shadow-sm shadow-emerald-900/10">
              <MapPinned size={15} strokeWidth={2.25} />
            </span>
          </div>
          <p className="mt-3 truncate text-xl font-bold text-slate-900">{topDivision?.name || '-'}</p>
          <p className="mt-1 text-sm font-semibold text-emerald-700">
            {topDivision ? `${topDivision.count} projects` : ''}
          </p>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="form-label">Top district</p>
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-100 text-teal-700 shadow-sm shadow-teal-900/10">
              <MapPin size={15} strokeWidth={2.25} />
            </span>
          </div>
          <p className="mt-3 truncate text-xl font-bold text-slate-900">{topDistrict?.name || '-'}</p>
          <p className="mt-1 text-sm font-semibold text-emerald-700">
            {topDistrict ? `${topDistrict.count} projects` : ''}
          </p>
          {topDistrict ? (
            <div className="mt-3 space-y-2">
              {topDistrictPhaseCounts.map((item) => (
                <div key={item.phase} className="grid grid-cols-[72px_minmax(0,1fr)_32px] items-center gap-2">
                  <span className="text-xs font-bold text-emerald-800">{item.phase}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-emerald-50">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700"
                      style={{ width: `${Math.max((item.count / topDistrictMaxPhaseCount) * 100, item.count ? 8 : 0)}%` }}
                    />
                  </span>
                  <span className="text-right text-xs font-black text-emerald-800">{item.count}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* Charts */}
      <section className="grid gap-4">
        <DivisionBarChart data={divisionCounts} />
        <CategoryDonutChart data={categoryCounts} />
      </section>
    </div>
  )
}

export default function App() {
  const printReportRef = useRef(null)
  const [baseData, setBaseData] = useState(null)
  const [projects, setProjects] = useState([])
  const [phaseCatalog, setPhaseCatalog] = useState([])
  const [divisionCatalog, setDivisionCatalog] = useState([])
  const [proposalDocuments, setProposalDocuments] = useState([])
  const [selectedProposalDocumentId, setSelectedProposalDocumentId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [phaseSelection, setPhaseSelection] = useState('Total')
  const [districtSelection, setDistrictSelection] = useState(DISTRICT_FILTER_ALL)
  const [activeTab, setActiveTab] = useState('insights')
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminAuthed, setAdminAuthed] = useState(false)
  const [adminSessionPassword, setAdminSessionPassword] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [loadError, setLoadError] = useState('')
  const [detailsFocusProjectId, setDetailsFocusProjectId] = useState('')
  const [notifications, setNotifications] = useState([])
  const [syncState, setSyncState] = useState({
    mode: 'checking',
    message: 'Checking shared data',
    lastSyncedAt: localStorage.getItem(LAST_SYNC_KEY) || '',
    pending: localStorage.getItem(PENDING_SYNC_KEY) === 'true',
  })
  const [syncAvailable, setSyncAvailable] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [pakistanDisplayDate, setPakistanDisplayDate] = useState(() => getPakistanDisplayDate())
  const [pakistanPrintTimestamp, setPakistanPrintTimestamp] = useState(() => getPakistanPrintTimestamp())
  const [printReportReady, setPrintReportReady] = useState(false)
  const [printRequested, setPrintRequested] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const [latestSavedReportStamp, setLatestSavedReportStamp] = useState('')
  const [adminReturnTab, setAdminReturnTab] = useState('admin')

  const notify = useCallback((title, message = '', type = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setNotifications((current) => [...current, { id, title, message, type }].slice(-4))
    window.setTimeout(() => {
      setNotifications((current) => current.filter((item) => item.id !== id))
    }, 4200)
    return id
  }, [])

  const dismissNotification = useCallback((id) => {
    setNotifications((current) => current.filter((item) => item.id !== id))
  }, [])

  const refreshReportStatus = useCallback(async () => {
    try {
      const status = await fetchJsonFromApi(reportStatusUrl())
      setLatestSavedReportStamp(status.readyStamp || status.readyTime || '')
    } catch {
      setLatestSavedReportStamp('')
    }
  }, [])

  useEffect(() => {
    const refreshPakistanTime = () => {
      setPakistanDisplayDate(getPakistanDisplayDate())
      setPakistanPrintTimestamp(getPakistanPrintTimestamp())
    }
    refreshPakistanTime()
    const timer = window.setInterval(refreshPakistanTime, 30 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    refreshReportStatus()
    const timer = window.setInterval(refreshReportStatus, 15 * 1000)
    return () => window.clearInterval(timer)
  }, [refreshReportStatus])

  useEffect(() => {
    if (!printReportReady) return undefined

    const cleanupPrintReport = () => {
      setPrintRequested(false)
      setPrintReportReady(false)
      setPrintBusy(false)
    }

    window.addEventListener('afterprint', cleanupPrintReport)
    return () => window.removeEventListener('afterprint', cleanupPrintReport)
  }, [printReportReady])

  useEffect(() => {
    if (!printRequested || !printReportReady) return undefined

    let cancelled = false
    const waitForFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve))

    async function prepareAndPrint() {
      await waitForFrame()
      await waitForFrame()

      const reportNode = printReportRef.current
      if (!reportNode || cancelled) return

      // Do not wait for every project image here. Large district reports can
      // contain hundreds of images, and Chrome will otherwise look frozen
      // before the print preview appears.
      const fontFallback = new Promise((resolve) => window.setTimeout(resolve, 600))
      if (document.fonts?.ready) await Promise.race([document.fonts.ready, fontFallback])
      if (cancelled) return

      window.print()
      setPrintRequested(false)
      setPrintBusy(false)
    }

    prepareAndPrint()
    return () => {
      cancelled = true
    }
  }, [printReportReady, printRequested])

  const openAdminEditor = useCallback((projectId, returnTab = 'admin') => {
    if (projectId) setSelectedId(projectId)
    setAdminReturnTab(returnTab)
    if (adminAuthed) {
      setActiveTab(returnTab)
      return
    }
    setAdminOpen(true)
  }, [adminAuthed])

  const openProjectDetails = useCallback((projectId) => {
    if (projectId) {
      const target = projects.find((project) => project.id === projectId)
      if (target && phaseSelection !== 'Total' && target.phase !== phaseSelection) {
        setPhaseSelection(target.phase || 'Phase 1')
      }
      setSelectedId(projectId)
      setDetailsFocusProjectId(projectId)
    }
    setActiveTab('details')
  }, [phaseSelection, projects])

  useEffect(() => {
    async function load() {
      try {
        const { dataset, source, syncAvailable: canSync, apiError } = await loadDashboardDataset()
        const hasPendingLocalEdits = localStorage.getItem(PENDING_SYNC_KEY) === 'true'
        const savedState = readSavedDashboardState(dataset, {
          preferSaved: source !== 'remote' || hasPendingLocalEdits,
        })
        const loadedProjects = savedState.projects.map(cleanProject)
        const hydratedProjects = await hydrateProjectsWithLocalMedia(loadedProjects)
        setBaseData(dataset)
        setProjects(hydratedProjects)
        setPhaseCatalog(savedState.phases)
        setDivisionCatalog(savedState.divisions)
        setProposalDocuments(savedState.proposalDocuments)
        setSelectedProposalDocumentId(savedState.proposalDocuments[0]?.id || '')
        setSelectedId(hydratedProjects[0]?.id || '')
        setSyncAvailable(canSync)
        setSyncState((current) => ({
          ...current,
          mode:
            source === 'remote' && !hasPendingLocalEdits
              ? 'live'
              : canSync && hasPendingLocalEdits
                ? 'pending'
                : isApiUnavailableError(apiError)
                  ? 'viewOnly'
                  : 'local',
          message:
            source === 'remote' && !hasPendingLocalEdits
              ? 'Shared database loaded'
              : hasPendingLocalEdits
                ? canSync
                  ? 'Local edits waiting to sync'
                  : 'Local edits saved here; shared sync needs the Node deployment'
                : isApiUnavailableError(apiError)
                  ? 'This deployment is serving the frontend only. Deploy as a Node Web Service to enable sync.'
                  : 'Local offline database loaded',
          pending: hasPendingLocalEdits,
          lastSyncedAt:
            source === 'remote' ? new Date().toISOString() : current.lastSyncedAt,
        }))
        if (source === 'remote' && !hasPendingLocalEdits) {
          localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString())
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(serializeDashboardState(
              hydratedProjects,
              savedState.phases,
              savedState.divisions,
              dataset,
              savedState.proposalDocuments,
            )),
          )
        }
      } catch (error) {
        setLoadError(error.message)
      }
    }
    load()
  }, [])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.altKey && !event.ctrlKey && !event.shiftKey) {
        if (event.key === '1') {
          event.preventDefault()
          setActiveTab('insights')
          return
        }
        if (event.key === '2') {
          event.preventDefault()
          setActiveTab('visuals')
          return
        }
        if (event.key === '3') {
          event.preventDefault()
          setDetailsFocusProjectId('')
          setActiveTab('details')
          return
        }
        if (event.key === '4') {
          event.preventDefault()
          openAdminEditor()
          return
        }
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        openAdminEditor()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openAdminEditor])

  useEffect(() => {
    function updateStatus() {
      const isOnline = navigator.onLine
      setOnline(isOnline)
      setSyncState((current) => ({
        ...current,
        mode: isOnline
          ? current.mode === 'viewOnly'
            ? 'viewOnly'
            : current.pending
              ? 'pending'
              : current.mode === 'offline'
                ? 'local'
                : current.mode
          : 'offline',
        message: isOnline
          ? current.mode === 'viewOnly'
            ? current.message
            : current.pending
            ? 'Local edits waiting to sync'
            : current.message
          : 'Offline meeting mode',
      }))
    }
    window.addEventListener('online', updateStatus)
    window.addEventListener('offline', updateStatus)
    return () => {
      window.removeEventListener('online', updateStatus)
      window.removeEventListener('offline', updateStatus)
    }
  }, [])

  const districtFilterOptions = useMemo(
    () =>
      unique([
        ...divisionCatalog.flatMap((division) => division.districts || []),
        ...projects.map((project) => project.district),
      ]),
    [divisionCatalog, projects],
  )

  const phaseProjects = useMemo(() => {
    const phaseFiltered =
      phaseSelection === 'Total'
        ? projects
        : projects.filter((project) => (project.phase || 'Phase 1') === phaseSelection)

    return districtSelection === DISTRICT_FILTER_ALL
      ? phaseFiltered
      : phaseFiltered.filter((project) => project.district === districtSelection)
  }, [districtSelection, phaseSelection, projects])

  const availableProjectPhases = useMemo(
    () => unique([...phaseCatalog.map((phase) => phase.name), ...projects.map((project) => project.phase)]),
    [phaseCatalog, projects],
  )

  const availablePhaseOptions = useMemo(
    () => ['Total', ...availableProjectPhases],
    [availableProjectPhases],
  )

  useEffect(() => {
    if (
      districtSelection !== DISTRICT_FILTER_ALL &&
      !districtFilterOptions.includes(districtSelection)
    ) {
      setDistrictSelection(DISTRICT_FILTER_ALL)
      setSelectedId('')
    }
  }, [districtFilterOptions, districtSelection])

  const divisions = useMemo(
    () =>
      unique([
        ...divisionCatalog.map((item) => item.name),
        ...projects.map((item) => item.division),
      ]),
    [divisionCatalog, projects],
  )
  const districts = useMemo(() => unique(phaseProjects.map((item) => item.district)), [phaseProjects])

  const selectedProject =
    projects.find((project) => project.id === selectedId) || phaseProjects[0] || projects[0]

  const stats = useMemo(() => {
    const mediaCount = phaseProjects.reduce((sum, project) => sum + (project.media?.length || 0), 0)
    const budgetMn = phaseProjects.reduce((sum, project) => sum + parseCostToMillions(project.cost), 0)
    return {
      records: phaseProjects.length,
      completed: phaseProjects.length,
      districts: districts.length,
      media: mediaCount,
      budget: budgetMn ? formatCostMillions(budgetMn) : '-',
      budgetMn,
    }
  }, [districts.length, phaseProjects])

  function persistState(
    nextProjects = projects,
    nextPhases = phaseCatalog,
    nextDivisions = divisionCatalog,
    dataContext = baseData,
    nextProposalDocuments = proposalDocuments,
  ) {
    // Local storage is the offline meeting cache and also holds pending edits.
    const snapshot = serializeDashboardState(
      nextProjects,
      nextPhases,
      nextDivisions,
      dataContext || {},
      nextProposalDocuments,
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    return snapshot
  }

  function markPendingSync(message = 'Saved on this laptop. Sync when internet/server is available.') {
    localStorage.setItem(PENDING_SYNC_KEY, 'true')
    setSyncState((current) => ({
      ...current,
      mode: online ? (syncAvailable ? 'pending' : 'viewOnly') : 'offline',
      message,
      pending: true,
    }))
  }

  async function pushSnapshotToServer(snapshot, password = adminSessionPassword, options = {}) {
    if (!navigator.onLine) throw new Error('No internet connection')
    if (!password) throw new Error('Unlock admin again before syncing online')

    const revision =
      snapshot?._serverRevision ||
      baseData?.database?._serverRevision ||
      baseData?._serverRevision ||
      ''

    const result = await fetchJsonFromApi(API_STATE_ENDPOINT, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-BSDI-Admin-Password': password,
        ...(revision ? { 'X-BSDI-Revision': String(revision) } : {}),
      },
      body: JSON.stringify({ data: snapshot, baseRevision: revision || undefined }),
    })
    const syncedAt = result.updatedAt || new Date().toISOString()
    localStorage.removeItem(PENDING_SYNC_KEY)
    localStorage.setItem(LAST_SYNC_KEY, syncedAt)
    setSyncState({
      mode: 'live',
      message: options.message || 'Shared database synced',
      lastSyncedAt: syncedAt,
      pending: false,
    })
    if (result.data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result.data))
      const normalized = normalizeDataset(result.data)
      setBaseData(normalized)
      setProposalDocuments(normalized.proposalDocuments || [])
    }
    return result.data
  }

  function queueSnapshotSync(snapshot, successTitle = 'Synced online') {
    // Save is never blocked by connectivity: failed sync becomes a pending local edit.
    if (!navigator.onLine) {
      markPendingSync('Offline changes waiting to sync')
      notify('Saved offline', 'This laptop has the latest edit. Use Sync when internet is available.', 'info')
      return
    }

    if (!syncAvailable) {
      markPendingSync('Saved locally. Shared sync needs the Node Web Service deployment.')
      notify('Saved locally', 'This deployment is frontend-only, so shared sync is not active yet.', 'info')
      return
    }

    pushSnapshotToServer(snapshot)
      .then(() => {
        notify(successTitle, 'Other online laptops can now sync this update.', 'success')
      })
      .catch((error) => {
        if (isApiUnavailableError(error)) {
          setSyncAvailable(false)
          markPendingSync('Saved locally. Shared sync needs the Node Web Service deployment.')
          notify('Saved locally', 'Shared sync is not enabled on this deployment yet.', 'info')
          return
        }
        if (isRevisionConflictError(error)) {
          saveConflictBackup(snapshot)
          markPendingSync('Shared database changed before this save. Sync latest, review, then save again.')
          notify(
            'Sync conflict',
            'Another admin saved first. Your edit is still kept on this laptop and was not overwritten.',
            'error',
          )
          return
        }
        markPendingSync(error.message || 'Online sync failed')
        notify('Saved locally', error.message || 'Online sync failed. Try Sync latest again.', 'info')
      })
  }

  async function syncLatest(options = {}) {
    if (syncBusy) return
    setPrintRequested(false)
    setPrintReportReady(false)
    setSyncBusy(true)
    let pendingSnapshot = null
    try {
      // Static deployments can still show the dashboard, but shared sync needs /api/state.
      if (!syncAvailable) {
        const canSync = await checkSyncServerAvailable()
        if (!canSync) {
          setSyncState((current) => ({
            ...current,
            mode: 'viewOnly',
            message: 'This deployment is serving the frontend only. Deploy as a Node Web Service to enable sync.',
          }))
          if (!options.quiet) {
            notify(
              'Sync server not enabled',
              'This deployment is serving only the frontend. Deploy/run the Node Web Service to use shared sync.',
              'info',
            )
          }
          return
        }
        setSyncAvailable(true)
      }

      const localSnapshot = persistState(projects, phaseCatalog, divisionCatalog)
      pendingSnapshot = localSnapshot
      const hasPending = localStorage.getItem(PENDING_SYNC_KEY) === 'true'
      if (hasPending && !adminSessionPassword && !options.forcePull) {
        setSyncState((current) => ({
          ...current,
          mode: 'pending',
          message: 'Unlock admin before syncing local pending edits.',
          pending: true,
        }))
        if (!options.quiet) {
          notify(
            'Unlock admin first',
            'This laptop has pending edits. Unlock admin so they can upload safely before pulling remote data.',
            'info',
          )
        }
        return
      }
      if (hasPending && adminSessionPassword && !options.forcePull) {
        await pushSnapshotToServer(localSnapshot, adminSessionPassword, {
          message: 'Local pending edits uploaded',
        })
      }

      const remoteDataset = await loadRemoteDashboardDataset()
      const remoteProjects = remoteDataset.projects.map(cleanProject)
      const hydratedProjects = await hydrateProjectsWithLocalMedia(remoteProjects)
      setBaseData(remoteDataset)
      setProjects(hydratedProjects)
      setPhaseCatalog(remoteDataset.phases)
      setDivisionCatalog(remoteDataset.divisions)
      setProposalDocuments(remoteDataset.proposalDocuments || [])
      setSelectedProposalDocumentId(remoteDataset.proposalDocuments?.[0]?.id || '')
      setSelectedId(hydratedProjects[0]?.id || '')
      persistState(
        hydratedProjects,
        remoteDataset.phases,
        remoteDataset.divisions,
        remoteDataset,
        remoteDataset.proposalDocuments || [],
      )

      setSyncState((current) => ({
        ...current,
        mode: 'live',
        message: 'Latest data loaded. Caching project media for offline use...',
        pending: false,
      }))
      const mediaCache = await cacheDashboardMedia(hydratedProjects, ({ done, total, ready, failed }) => {
        setSyncState((current) => ({
          ...current,
          mode: 'live',
          message: `Caching offline media ${done}/${total} (${ready} ready${failed ? `, ${failed} skipped` : ''})`,
          pending: false,
        }))
      })

      const syncedAt = new Date().toISOString()
      localStorage.removeItem(PENDING_SYNC_KEY)
      localStorage.setItem(LAST_SYNC_KEY, syncedAt)
      const syncMessage = mediaCache.unsupported
        ? 'Latest data loaded. This browser does not support offline media caching.'
        : mediaCache.total
          ? `${mediaCache.ready}/${mediaCache.total} media files ready offline${mediaCache.failed ? `; ${mediaCache.failed} skipped` : ''}.`
          : 'Latest data loaded. No media files found to cache.'
      setSyncState({
        mode: 'live',
        message: syncMessage,
        lastSyncedAt: syncedAt,
        pending: false,
      })
      if (!options.quiet) {
        notify('Sync complete', syncMessage, mediaCache.failed || mediaCache.unsupported ? 'info' : 'success')
      }
    } catch (error) {
      if (isApiUnavailableError(error)) {
        setSyncAvailable(false)
        setSyncState((current) => ({
          ...current,
          mode: 'viewOnly',
          message: 'This deployment is serving the frontend only. Deploy as a Node Web Service to enable sync.',
        }))
        if (!options.quiet) {
          notify(
            'Sync server not enabled',
            'This deployment is serving only the frontend. Deploy/run the Node Web Service to use shared sync.',
            'info',
          )
        }
        return
      }
      if (isRevisionConflictError(error)) {
        saveConflictBackup(pendingSnapshot)
        setSyncState((current) => ({
          ...current,
          mode: 'pending',
          message: 'Shared database changed. Local pending edits were kept on this laptop.',
          pending: true,
        }))
        localStorage.setItem(PENDING_SYNC_KEY, 'true')
        if (!options.quiet) {
          notify(
            'Sync conflict',
            'Another admin saved first. Your pending edit was not uploaded; review latest data before saving again.',
            'error',
          )
        }
        return
      }
      setSyncState((current) => ({
        ...current,
        mode: navigator.onLine ? 'local' : 'offline',
        message: error.message || 'Sync failed',
      }))
      if (!options.quiet) notify('Sync failed', error.message || 'Shared server is not reachable.', 'error')
    } finally {
      setSyncBusy(false)
    }
  }

  async function uploadProjectMedia(projectId, files, mediaType, startingOrder = 0, startingTypeCount = 0) {
    if (!navigator.onLine) throw new Error('Media upload needs internet')
    if (!syncAvailable) throw new Error('Shared media upload needs the Node Web Service deployment')
    if (!adminSessionPassword) throw new Error('Unlock admin again before online media upload')

    const body = new FormData()
    body.append('projectId', projectId)
    body.append('mediaType', mediaType)
    body.append('startingOrder', String(startingOrder))
    body.append('startingTypeCount', String(startingTypeCount))
    for (const file of files) body.append('files', file)

    const result = await fetchJsonFromApi(API_MEDIA_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-BSDI-Admin-Password': adminSessionPassword,
      },
      body,
    })

    return (result.media || []).map((item) => ({
      ...item,
      src: resolveSyncedMediaSrc(item.src || ''),
    }))
  }

  function saveProjects(next) {
    const cleanedProjects = next.map(cleanProject)
    const nextPhases = cleanPhaseCatalog(phaseCatalog, cleanedProjects)
    const nextDivisions = cleanDivisionCatalog(divisionCatalog, cleanedProjects)
    setProjects(cleanedProjects)
    setPhaseCatalog(nextPhases)
    setDivisionCatalog(nextDivisions)
    const snapshot = persistState(cleanedProjects, nextPhases, nextDivisions)
    queueSnapshotSync(snapshot, 'Project data synced')
  }

  function saveProposalDocuments(nextDocuments, successTitle = 'Proposal data synced') {
    const cleanedDocuments = cleanProposalDocuments(nextDocuments)
    setProposalDocuments(cleanedDocuments)
    if (!cleanedDocuments.some((document) => document.id === selectedProposalDocumentId)) {
      setSelectedProposalDocumentId(cleanedDocuments[0]?.id || '')
    }
    const snapshot = persistState(projects, phaseCatalog, divisionCatalog, baseData, cleanedDocuments)
    queueSnapshotSync(snapshot, successTitle)
  }

  function addProposalDocument(document) {
    const cleanedDocument = cleanProposalDocument(document)
    const nextDocuments = cleanProposalDocuments([
      cleanedDocument,
      ...proposalDocuments.filter((item) => item.id !== cleanedDocument.id),
    ])
    setSelectedProposalDocumentId(cleanedDocument.id)
    saveProposalDocuments(nextDocuments, 'Proposal document synced')
    notify(
      'Proposal document uploaded',
      `${cleanedDocument.rowCount} proposals and ${formatCostMillions(cleanedDocument.totalCostMn)} captured.`,
      'success',
    )
  }

  function updateProposalDocument(document) {
    const cleanedDocument = cleanProposalDocument(document)
    const nextDocuments = proposalDocuments.map((item) =>
      item.id === cleanedDocument.id ? cleanedDocument : item,
    )
    saveProposalDocuments(nextDocuments, 'Proposal assessment synced')
    notify('Assessment saved', `${cleanedDocument.title} updated.`, 'success')
  }

  function resetProjects() {
    const original = (baseData?.projects || []).map(cleanProject)
    const nextPhases = cleanPhaseCatalog(baseData?.phases || [], original)
    const nextDivisions = cleanDivisionCatalog(baseData?.divisions || [], original)
    setProjects(original)
    setPhaseCatalog(nextPhases)
    setDivisionCatalog(nextDivisions)
    localStorage.removeItem(STORAGE_KEY)
    for (const key of LEGACY_PROJECT_KEYS) localStorage.removeItem(key)
    setSelectedId(original[0]?.id || '')
    notify('Database reset', 'Local edits were cleared and source data was restored.', 'info')
    const snapshot = persistState(original, nextPhases, nextDivisions)
    queueSnapshotSync(snapshot, 'Reset synced')
  }

  function addPhase(name) {
    const cleanName = name.trim()
    if (!cleanName) return false
    if (availableProjectPhases.includes(cleanName)) {
      notify('Phase already exists', cleanName, 'info')
      return false
    }
    const nextPhases = cleanPhaseCatalog([...phaseCatalog, { id: toId(cleanName), name: cleanName, status: 'completed' }], projects)
    setPhaseCatalog(nextPhases)
    const snapshot = persistState(projects, nextPhases, divisionCatalog)
    queueSnapshotSync(snapshot, 'Phase synced')
    notify('Phase added', cleanName, 'success')
    return true
  }

  function deletePhase(name) {
    const cleanName = name.trim()
    if (!cleanName) return false
    const nextProjects = projects.filter((project) => (project.phase || 'Phase 1') !== cleanName)
    const removedCount = projects.length - nextProjects.length
    const nextPhases = cleanPhaseCatalog(
      phaseCatalog.filter((phase) => phase.name !== cleanName),
      nextProjects,
    )
    const nextDivisions = cleanDivisionCatalog(divisionCatalog, nextProjects)
    setProjects(nextProjects)
    setPhaseCatalog(nextPhases)
    setDivisionCatalog(nextDivisions)
    if (phaseSelection === cleanName) setPhaseSelection('Total')
    setSelectedId(nextProjects[0]?.id || '')
    const snapshot = persistState(nextProjects, nextPhases, nextDivisions)
    queueSnapshotSync(snapshot, 'Phase deletion synced')
    notify('Phase deleted', `${cleanName} removed with ${removedCount} project${removedCount === 1 ? '' : 's'}.`, 'success')
    return true
  }

  function addDivision(name) {
    const cleanName = name.trim()
    if (!cleanName) return false
    if (divisionCatalog.some((division) => division.name === cleanName)) {
      notify('Division already exists', cleanName, 'info')
      return false
    }
    const nextDivisions = cleanDivisionCatalog([...divisionCatalog, { id: toId(cleanName), name: cleanName, districts: [] }], projects)
    setDivisionCatalog(nextDivisions)
    const snapshot = persistState(projects, phaseCatalog, nextDivisions)
    queueSnapshotSync(snapshot, 'Division synced')
    notify('Division added', cleanName, 'success')
    return true
  }

  function deleteDivision(name) {
    const cleanName = name.trim()
    if (!cleanName) return false
    const nextProjects = projects.filter((project) => project.division !== cleanName)
    const removedCount = projects.length - nextProjects.length
    const nextDivisions = cleanDivisionCatalog(
      divisionCatalog.filter((division) => division.name !== cleanName),
      nextProjects,
    )
    const nextPhases = cleanPhaseCatalog(phaseCatalog, nextProjects)
    setProjects(nextProjects)
    setPhaseCatalog(nextPhases)
    setDivisionCatalog(nextDivisions)
    setSelectedId(nextProjects[0]?.id || '')
    const snapshot = persistState(nextProjects, nextPhases, nextDivisions)
    queueSnapshotSync(snapshot, 'Division deletion synced')
    notify('Division deleted', `${cleanName} removed with ${removedCount} project${removedCount === 1 ? '' : 's'}.`, 'success')
    return true
  }

  function addDistrict(divisionName, districtName) {
    const cleanDistrict = districtName.trim()
    if (!divisionName || !cleanDistrict) return false
    const currentDivision =
      divisionCatalog.find((division) => division.name === divisionName) ||
      { id: toId(divisionName), name: divisionName, districts: [] }
    if (currentDivision.districts.includes(cleanDistrict)) {
      notify('District already exists', `${cleanDistrict} is already under ${divisionName}.`, 'info')
      return false
    }
    const nextDivision = {
      ...currentDivision,
      districts: unique([...currentDivision.districts, cleanDistrict]),
    }
    const nextDivisions = cleanDivisionCatalog(
      [...divisionCatalog.filter((division) => division.name !== divisionName), nextDivision],
      projects,
    )
    setDivisionCatalog(nextDivisions)
    const snapshot = persistState(projects, phaseCatalog, nextDivisions)
    queueSnapshotSync(snapshot, 'District synced')
    notify('District added', `${cleanDistrict} added to ${divisionName}.`, 'success')
    return true
  }

  function deleteDistrict(divisionName, districtName) {
    const cleanDistrict = districtName.trim()
    if (!divisionName || !cleanDistrict) return false
    const nextProjects = projects.filter(
      (project) => !(project.division === divisionName && project.district === cleanDistrict),
    )
    const removedCount = projects.length - nextProjects.length
    const nextDivisions = cleanDivisionCatalog(
      divisionCatalog.map((division) =>
        division.name === divisionName
          ? { ...division, districts: (division.districts || []).filter((district) => district !== cleanDistrict) }
          : division,
      ),
      nextProjects,
    )
    const nextPhases = cleanPhaseCatalog(phaseCatalog, nextProjects)
    setProjects(nextProjects)
    setPhaseCatalog(nextPhases)
    setDivisionCatalog(nextDivisions)
    setSelectedId(nextProjects[0]?.id || '')
    const snapshot = persistState(nextProjects, nextPhases, nextDivisions)
    queueSnapshotSync(snapshot, 'District deletion synced')
    notify(
      'District deleted',
      `${cleanDistrict} removed from ${divisionName} with ${removedCount} project${removedCount === 1 ? '' : 's'}.`,
      'success',
    )
    return true
  }

  const tabs = [
    { id: 'insights', label: 'Insights', icon: BarChart3 },
    { id: 'visuals', label: 'Visuals', icon: ImageIcon },
    { id: 'details', label: 'Project Details', icon: TableProperties },
    adminAuthed ? { id: 'admin', label: 'Data Editor', icon: ShieldCheck } : null,
  ].filter(Boolean)
  const visibleActiveTab = activeTab === 'admin' && !adminAuthed ? 'insights' : activeTab
  const SyncIcon = syncState.mode === 'offline' ? CloudOff : Cloud
  const syncLabel = syncState.pending
    ? 'Pending sync'
    : syncState.mode === 'live'
      ? 'Synced'
      : syncBusy
        ? 'Syncing'
        : ''
  const syncButtonText = syncBusy ? 'Syncing' : 'Sync'
  const syncButtonTitle = syncAvailable
    ? 'Upload pending edits, then load the latest shared database'
    : 'Sync with the shared database when the Node server is available'

  function printAllProjects() {
    if (printBusy) return
    const downloadTime = new Date()
    setPakistanPrintTimestamp(getPakistanPrintTimestamp(downloadTime))
    setPrintBusy(true)

    const link = document.createElement('a')
    link.href = reportDownloadUrl()
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()

    notify('PDF download started', 'The file name uses the saved PDF time.', 'success')
    window.setTimeout(() => setPrintBusy(false), 1200)
  }

  if (loadError) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="card max-w-lg p-8 text-center">
          <span className="icon-box mx-auto mb-4 h-12 w-12 rounded-xl">
            <FileJson size={22} />
          </span>
          <h1 className="text-xl font-bold text-slate-900">Data could not load</h1>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
        </div>
      </main>
    )
  }

  if (!baseData) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="card p-8 text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-xl bg-slate-200" />
          <p className="mt-4 text-sm font-medium text-slate-400">Loading BSDI records...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="app-shell mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 lg:px-6">

        {/* Header */}
        <header className="no-print relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 shadow-header sm:p-5 lg:p-6">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse at 15% 60%, rgba(16,185,129,0.12) 0%, transparent 60%), radial-gradient(ellipse at 85% 20%, rgba(52,211,153,0.06) 0%, transparent 50%)',
            }}
          />
          <div className="relative grid gap-4 xl:grid-cols-[minmax(280px,0.95fr)_minmax(300px,0.9fr)_auto] xl:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative">
                  <select
                    aria-label="Phase"
                    value={phaseSelection}
                    onChange={(event) => {
                      setPhaseSelection(event.target.value)
                      setSelectedId('')
                    }}
                    className="h-7 appearance-none rounded-full border border-white/20 bg-white/10 pl-3 pr-7 text-xs font-semibold text-white outline-none backdrop-blur-sm transition hover:bg-white/15"
                  >
                    {availablePhaseOptions.map((phase) => (
                      <option key={phase} value={phase} className="bg-slate-800 text-white">
                        {phase}
                      </option>
                    ))}
                  </select>
                  <ChevronRight
                    className="pointer-events-none absolute right-2 top-1 rotate-90 text-white/60"
                    size={13}
                  />
                </label>
                <label className="relative">
                  <select
                    aria-label="District"
                    value={districtSelection}
                    onChange={(event) => {
                      setDistrictSelection(event.target.value)
                      setSelectedId('')
                      setDetailsFocusProjectId('')
                    }}
                    className="h-7 max-w-[170px] appearance-none rounded-full border border-white/20 bg-white/10 pl-3 pr-7 text-xs font-semibold text-white outline-none backdrop-blur-sm transition hover:bg-white/15"
                  >
                    <option value={DISTRICT_FILTER_ALL} className="bg-slate-800 text-white">
                      {DISTRICT_FILTER_ALL}
                    </option>
                    {districtFilterOptions.map((district) => (
                      <option key={district} value={district} className="bg-slate-800 text-white">
                        {district}
                      </option>
                    ))}
                  </select>
                  <ChevronRight
                    className="pointer-events-none absolute right-2 top-1 rotate-90 text-white/60"
                    size={13}
                  />
                </label>
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/8 px-2.5 py-0.5 text-xs font-medium text-white/70">
                  {pakistanDisplayDate}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                    online
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                      : 'border-white/10 bg-white/8 text-white/50'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-white/30'}`} />
                  {online ? 'Online' : 'Offline'}
                </span>
                {syncLabel ? (
                  <span
                    className={`inline-flex min-w-0 max-w-[180px] items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      syncState.pending
                        ? 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                        : syncState.mode === 'live'
                          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                          : 'border-white/10 bg-white/8 text-white/60'
                    }`}
                    title={syncState.message}
                  >
                    <SyncIcon size={12} />
                    <span className="truncate">{syncLabel}</span>
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => syncLatest()}
                  disabled={!online || syncBusy}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 text-xs font-semibold text-white/80 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45"
                  title={syncButtonTitle}
                >
                  <RefreshCw size={12} className={syncBusy ? 'animate-spin' : ''} />
                  {syncButtonText}
                </button>
              </div>
              <div className="mt-3 flex min-w-0 items-center gap-3">
                <img
                  src={BRAND_LOGO}
                  alt="BSDI logo"
                  className="h-12 w-12 shrink-0 object-contain drop-shadow-lg sm:h-14 sm:w-14"
                />
                <h1 className="min-w-0 break-words text-xl font-bold leading-tight text-white sm:text-2xl lg:text-3xl">
                  BSDI Completed Projects
                </h1>
              </div>
            </div>

            <div className="relative min-w-0 overflow-hidden rounded-2xl border border-emerald-300/20 bg-white/5 px-2.5 py-2 shadow-lg shadow-black/10 backdrop-blur-sm">
              <div className="pointer-events-none absolute inset-0 bg-emerald-400/5" />
              <div className="relative grid grid-cols-4 gap-1.5 sm:gap-2">
                {LANDMARK_CARDS.map((landmark) => (
                  <div
                    key={landmark.src}
                    className="overflow-hidden rounded-xl border border-amber-200/50 bg-slate-950/35 shadow-md shadow-black/20"
                  >
                    <img
                      src={landmark.src}
                      alt={landmark.alt}
                      className="h-14 w-full object-cover sm:h-20 xl:h-24"
                      loading="eager"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid shrink-0 gap-2 sm:min-w-[150px] sm:gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('ee-p3')}
                className="rounded-xl border border-white/10 bg-white/8 p-3 text-left backdrop-blur-sm transition hover:border-emerald-300/40 hover:bg-white/12 focus:outline-none focus:ring-2 focus:ring-emerald-300/60 sm:p-4"
                title="Open E&E of P3 projects"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Open page</p>
                <p className="mt-1.5 text-lg font-bold leading-tight text-white sm:text-xl">E&E of P3 projs</p>
              </button>
            </div>
          </div>
        </header>

        {/* Navigation */}
        <div className="no-print flex flex-col gap-2 rounded-xl bg-white p-1.5 shadow-card lg:flex-row lg:items-center lg:justify-between">
          <nav
            className="flex flex-1 flex-wrap items-center gap-1"
            aria-label="Main sections"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = visibleActiveTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (tab.id === 'details') setDetailsFocusProjectId('')
                    setActiveTab(tab.id)
                  }}
                  className={`inline-flex h-9 min-w-[120px] flex-[1_1_130px] items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition sm:flex-none sm:px-3.5 ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}
                >
                  <Icon size={15} />
                  {tab.label}
                </button>
              )
            })}
          </nav>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={printAllProjects}
              disabled={printBusy}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 text-sm font-bold text-white shadow-sm transition hover:from-emerald-700 hover:to-teal-700 disabled:cursor-not-allowed disabled:opacity-70"
              title="Open the print-ready completed-project report"
            >
              {printBusy ? <RefreshCw size={15} className="animate-spin" /> : <Printer size={15} />}
              {printBusy ? 'Preparing' : 'Print'}
            </button>
            {latestSavedReportStamp ? (
              <span
                className="text-right text-xs font-bold tabular-nums text-slate-400"
                title="Latest saved PDF date and time"
              >
                {latestSavedReportStamp}
              </span>
            ) : null}
          </div>
        </div>

        {/* Tab content */}
        {visibleActiveTab === 'insights' ? (
          <InsightsPanel
            projects={phaseProjects}
            stats={stats}
            phaseSelection={phaseSelection}
          />
        ) : null}

        {visibleActiveTab === 'visuals' ? (
          <VisualsPanel
            projects={phaseProjects}
            phaseSelection={phaseSelection}
            onOpenProject={openProjectDetails}
          />
        ) : null}

        {visibleActiveTab === 'details' ? (
          <ProjectDetailsFlow
            key={detailsFocusProjectId || 'browse'}
            projects={phaseProjects}
            divisionCatalog={divisionCatalog}
            phaseSelection={phaseSelection}
            availablePhases={availablePhaseOptions}
            onPhaseChange={(phase) => {
              setPhaseSelection(phase)
              setSelectedId('')
            }}
            onSelectProject={setSelectedId}
            focusProjectId={detailsFocusProjectId}
            onEditProject={adminAuthed ? openAdminEditor : null}
          />
        ) : null}

        {visibleActiveTab === 'ee-p3' ? (
          <ProposalReviewPanel
            key={selectedProposalDocumentId || 'proposal-review'}
            documents={proposalDocuments}
            selectedDocumentId={selectedProposalDocumentId}
            onSelectDocument={setSelectedProposalDocumentId}
            onUploadDocument={addProposalDocument}
            onSaveDocument={updateProposalDocument}
            adminAuthed={adminAuthed}
            onRequestAdmin={() => openAdminEditor('', 'ee-p3')}
            notify={notify}
          />
        ) : null}

        {visibleActiveTab === 'admin' && adminAuthed ? (
          <AdminPanel
            key={selectedProject?.id || 'admin-panel'}
            projects={projects}
            selectedProject={selectedProject}
            divisions={divisions}
            phaseOptions={availableProjectPhases}
            divisionCatalog={divisionCatalog}
            saveProjects={saveProjects}
            resetProjects={resetProjects}
            setSelectedId={setSelectedId}
            onViewProject={openProjectDetails}
            onAddPhase={addPhase}
            onAddDivision={addDivision}
            onAddDistrict={addDistrict}
            onDeletePhase={deletePhase}
            onDeleteDivision={deleteDivision}
            onDeleteDistrict={deleteDistrict}
            uploadProjectMedia={uploadProjectMedia}
            adminPassword={baseData.settings?.adminPassword || FALLBACK_ADMIN_PASSWORD}
            notify={notify}
            onLock={() => {
              setAdminAuthed(false)
              setAdminSessionPassword('')
              setAdminReturnTab('admin')
              setActiveTab('insights')
              notify('Editor locked', 'Admin editing is disabled.', 'info')
            }}
          />
        ) : null}
      </div>

      {printReportReady ? (
        <div ref={printReportRef} className="print-report-host" aria-hidden="true">
          <FullPrintReport
            projects={phaseProjects}
            stats={stats}
            phaseSelection={phaseSelection}
            districtSelection={districtSelection}
            date={pakistanPrintTimestamp}
          />
        </div>
      ) : null}

      <AdminModal
        key={selectedProject?.id || 'admin'}
        open={adminOpen}
        authed={adminAuthed}
        setAuthed={setAdminAuthed}
        onClose={() => setAdminOpen(false)}
        onUnlock={(password) => {
          setAdminSessionPassword(password)
          setAdminOpen(false)
          setActiveTab(adminReturnTab || 'admin')
        }}
        projects={projects}
        selectedProject={selectedProject}
        divisions={divisions}
        phaseOptions={availableProjectPhases}
        adminPassword={baseData.settings?.adminPassword || FALLBACK_ADMIN_PASSWORD}
        saveProjects={saveProjects}
        resetProjects={resetProjects}
        setSelectedId={setSelectedId}
        notify={notify}
      />
      <ToastStack notifications={notifications} onDismiss={dismissNotification} />
    </main>
  )
}
