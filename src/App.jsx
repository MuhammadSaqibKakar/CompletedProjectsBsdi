import { AnimatePresence, motion } from 'framer-motion'
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
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Tags,
  TableProperties,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

const FALLBACK_ADMIN_PASSWORD = ''
const STORAGE_KEY = 'bsdi-dashboard-state-v1'
const PENDING_SYNC_KEY = 'bsdi-dashboard-pending-sync-v1'
const LAST_SYNC_KEY = 'bsdi-dashboard-last-sync-v1'
const LEGACY_PROJECT_KEYS = ['bsdi-dashboard-projects-v6', 'bsdi-dashboard-projects-v5']
const MEDIA_DB_NAME = 'bsdi-dashboard-media'
const MEDIA_STORE_NAME = 'files'
const API_STATE_ENDPOINT = '/api/state'
const API_MEDIA_ENDPOINT = '/api/media'
const API_UNAVAILABLE_MESSAGE = 'Shared sync server is not enabled on this deployment'
const BRAND_LOGO = '/brand/bsdi-logo.png'
const LANDMARK_CARDS = [
  { src: '/brand/landmark-gate.png', alt: 'Balochistan gateway landmark' },
  { src: '/brand/landmark-princess-of-hope.png', alt: 'Princess of Hope' },
  { src: '/brand/landmark-residency.png', alt: 'Quaid-e-Azam Residency' },
  { src: '/brand/landmark-fort.png', alt: 'Balochistan fort landmark' },
]
const phaseOptions = ['Total', 'Phase 1', 'Phase 2', 'Phase 3']
const projectPhaseOptions = phaseOptions.filter((phase) => phase !== 'Total')

const fieldList = [
  ['title', 'Project title', 'text'],
  ['phase', 'Phase', 'text'],
  ['category', 'Category', 'text'],
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

function toId(value) {
  return String(value || 'item')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `item-${Date.now()}`
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
  for (const phase of projectPhaseOptions) {
    if (!byName.has(phase)) {
      byName.set(phase, { id: toId(phase), name: phase, status: 'completed', projectCount: 0, projectIds: [] })
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
  const title = project.title?.trim() || 'Untitled project'
  const id = project.id?.trim() || `project-${Date.now()}`
  const media = Array.isArray(project.media)
    ? project.media.map((item, index) => ({
        ...item,
        id: item.id || `${id}-media-${String(index + 1).padStart(2, '0')}`,
        projectId: item.projectId || id,
        type: item.type || 'image',
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
      database: raw,
    }
  }

  return {
    ...raw,
    projects: (raw?.projects || []).map(cleanProject),
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

function createDashboardSnapshot(projects, phases, divisions, baseData = {}) {
  // This snapshot is the single shape used for local cache and server sync.
  const cleanedProjects = serializeProjects(projects.map(cleanProject))
  const cleanedPhases = cleanPhaseCatalog(phases, cleanedProjects)
  const cleanedDivisions = cleanDivisionCatalog(divisions, cleanedProjects)
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

function serializeDashboardState(projects, phases, divisions, baseData = {}) {
  return createDashboardSnapshot(projects, phases, divisions, baseData)
}

function readSavedDashboardState(dataset, options = {}) {
  // Remote data wins unless there are unsynced local edits on this laptop.
  const shouldReadSaved = options.preferSaved !== false
  if (!shouldReadSaved) {
    return {
      projects: dataset.projects || [],
      phases: cleanPhaseCatalog(dataset.phases, dataset.projects),
      divisions: cleanDivisionCatalog(dataset.divisions, dataset.projects),
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
      }
    }
    const projects = (parsed.projects || dataset.projects || []).map(cleanProject)
    return {
      projects,
      phases: cleanPhaseCatalog(parsed.phases || dataset.phases, projects),
      divisions: cleanDivisionCatalog(parsed.divisions || dataset.divisions, projects),
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
    }
  }

  return {
    projects: dataset.projects || [],
    phases: cleanPhaseCatalog(dataset.phases, dataset.projects),
    divisions: cleanDivisionCatalog(dataset.divisions, dataset.projects),
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
  return (
    <motion.section
      key={project.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card min-w-0 p-4 sm:p-5"
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
                className="btn-secondary h-9 w-full text-xs sm:w-auto"
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
            <DetailLine icon={MapPin} label="District" value={project.district} />
            <DetailLine icon={Tags} label="Category" value={project.category} />
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
          <DriveFolderCard project={project} />
        </div>
        <MediaViewer project={project} />
      </div>
    </motion.section>
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
    <div className="flex w-full flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-inner shadow-slate-900/5 sm:w-auto">
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
    () =>
      unique([...divisionCatalog.map((division) => division.name), ...projects.map((project) => project.division)])
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
      }),
    [divisionCatalog, projects],
  )

  const divisionProjects = useMemo(
    () => projects.filter((project) => project.division === selectedDivision),
    [projects, selectedDivision],
  )

  const districtCards = useMemo(
    () =>
      unique([
        ...(divisionCatalog.find((division) => division.name === selectedDivision)?.districts || []),
        ...divisionProjects.map((project) => project.district),
      ]).map((name) => {
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
      }),
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
              className="group inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50 px-4 text-sm font-bold text-slate-700 shadow-sm shadow-emerald-950/5 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:text-emerald-800 hover:shadow-lg hover:shadow-emerald-950/10 sm:w-auto"
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
            <div className="flex flex-wrap gap-2">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-4">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3">
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
          <aside className="card h-fit max-h-[52vh] overflow-auto p-3 xl:max-h-[720px]">
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
  uploadProjectMedia,
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

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
    if (name === 'phase') setSelectedPhase(value)
  }

  function addPhaseFromEditor() {
    const name = window.prompt('New phase name', `Phase ${editorPhaseOptions.length + 1}`)?.trim()
    if (!name) return
    if (onAddPhase?.(name)) changePhase(name)
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
              <button
                type="button"
                onClick={addPhaseFromEditor}
                className="rounded-full px-1.5 py-0.5 text-[10px] text-emerald-700 transition hover:bg-emerald-50"
                title="Add phase"
              >
                + Add
              </button>
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
              <button
                type="button"
                onClick={addDivisionFromEditor}
                className="rounded-full px-1.5 py-0.5 text-[10px] text-emerald-700 transition hover:bg-emerald-50"
                title="Add division"
              >
                + Add
              </button>
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
              <button
                type="button"
                onClick={addDistrictFromEditor}
                className="rounded-full px-1.5 py-0.5 text-[10px] text-emerald-700 transition hover:bg-emerald-50"
                title="Add district"
              >
                + Add
              </button>
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
  const [baseData, setBaseData] = useState(null)
  const [projects, setProjects] = useState([])
  const [phaseCatalog, setPhaseCatalog] = useState([])
  const [divisionCatalog, setDivisionCatalog] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [phaseSelection, setPhaseSelection] = useState('Total')
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

  const openAdminEditor = useCallback((projectId) => {
    if (projectId) setSelectedId(projectId)
    if (adminAuthed) {
      setActiveTab('admin')
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
            JSON.stringify(serializeDashboardState(hydratedProjects, savedState.phases, savedState.divisions, dataset)),
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
          setDetailsFocusProjectId('')
          setActiveTab('details')
          return
        }
        if (event.key === '3') {
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

  const phaseProjects = useMemo(
    () =>
      phaseSelection === 'Total'
        ? projects
        : projects.filter((project) => (project.phase || 'Phase 1') === phaseSelection),
    [phaseSelection, projects],
  )

  const availableProjectPhases = useMemo(
    () => unique([...phaseCatalog.map((phase) => phase.name), ...projects.map((project) => project.phase)]),
    [phaseCatalog, projects],
  )

  const availablePhaseOptions = useMemo(
    () => ['Total', ...availableProjectPhases],
    [availableProjectPhases],
  )

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
  ) {
    // Local storage is the offline meeting cache and also holds pending edits.
    const snapshot = serializeDashboardState(nextProjects, nextPhases, nextDivisions, dataContext || {})
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

    const result = await fetchJsonFromApi(API_STATE_ENDPOINT, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-BSDI-Admin-Password': password,
      },
      body: JSON.stringify({ data: snapshot }),
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
    if (result.data) setBaseData(normalizeDataset(result.data))
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
        markPendingSync(error.message || 'Online sync failed')
        notify('Saved locally', error.message || 'Online sync failed. Try Sync latest again.', 'info')
      })
  }

  async function syncLatest(options = {}) {
    if (syncBusy) return
    setSyncBusy(true)
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
      const hasPending = localStorage.getItem(PENDING_SYNC_KEY) === 'true'
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
      setSelectedId(hydratedProjects[0]?.id || '')
      persistState(hydratedProjects, remoteDataset.phases, remoteDataset.divisions, remoteDataset)

      const syncedAt = new Date().toISOString()
      localStorage.removeItem(PENDING_SYNC_KEY)
      localStorage.setItem(LAST_SYNC_KEY, syncedAt)
      setSyncState({
        mode: 'live',
        message: 'Latest shared data loaded',
        lastSyncedAt: syncedAt,
        pending: false,
      })
      if (!options.quiet) notify('Sync complete', 'This laptop now has the latest shared data.', 'success')
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

    return result.media || []
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

  const headerCompleted = phaseProjects.length
  const tabs = [
    { id: 'insights', label: 'Insights', icon: BarChart3 },
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
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 lg:px-6">

        {/* Header */}
        <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 shadow-header sm:p-5 lg:p-6">
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
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/8 px-2.5 py-0.5 text-xs font-medium text-white/70">
                  {baseData.meta.sourceDate}
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
              <div className="rounded-xl border border-white/10 bg-white/8 p-3 backdrop-blur-sm sm:p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Completed</p>
                <p className="mt-1.5 text-2xl font-bold text-white">{headerCompleted}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Navigation */}
        <nav
          className="flex flex-wrap items-center gap-1 rounded-xl bg-white p-1.5 shadow-card"
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

        {/* Tab content */}
        {visibleActiveTab === 'insights' ? (
          <InsightsPanel
            projects={phaseProjects}
            stats={stats}
            phaseSelection={phaseSelection}
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
            uploadProjectMedia={uploadProjectMedia}
            notify={notify}
            onLock={() => {
              setAdminAuthed(false)
              setAdminSessionPassword('')
              setActiveTab('insights')
              notify('Editor locked', 'Admin editing is disabled.', 'info')
            }}
          />
        ) : null}
      </div>

      <AdminModal
        key={selectedProject?.id || 'admin'}
        open={adminOpen}
        authed={adminAuthed}
        setAuthed={setAdminAuthed}
        onClose={() => setAdminOpen(false)}
        onUnlock={(password) => {
          setAdminSessionPassword(password)
          setAdminOpen(false)
          setActiveTab('admin')
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
