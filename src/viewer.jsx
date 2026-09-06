import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, ArrowLeft, ArrowRight, Download, FileSliders, LoaderCircle, Maximize2, Minimize2, RotateCcw } from 'lucide-react'
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer'
import './viewer.css'

const metaId = document.querySelector('meta[name="presentation-id"]')?.content || ''
const PRESENTATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(metaId) && window.self !== window.top ? metaId : null
const MAX_FILE_BYTES = 200 * 1024 * 1024
const ZIP_LIMITS = {
  ...RECOMMENDED_ZIP_LIMITS,
  maxEntries: 12000,
  maxEntryUncompressedBytes: 200 * 1024 * 1024,
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxMediaBytes: 1024 * 1024 * 1024,
}
const API_PATH = PRESENTATION_ID ? `/api/presentations/${PRESENTATION_ID}` : null
const DOWNLOAD_PATH = API_PATH ? `${API_PATH}/download` : null

export default function PresentationViewer() {
  const surfaceRef = useRef(null)
  const stageRef = useRef(null)
  const rendererRef = useRef(null)
  const navigationRef = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [presentation, setPresentation] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Opening presentation…')
  const [warning, setWarning] = useState('')
  const [currentSlide, setCurrentSlide] = useState(0)
  const [slideCount, setSlideCount] = useState(0)
  const [slideRatio, setSlideRatio] = useState(16 / 9)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const [navigating, setNavigating] = useState(false)

  useEffect(() => {
    const stage = stageRef.current
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    // Only the viewer's original-file download link may navigate out of this page.
    const stopPresentationLinks = (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null
      if (!anchor) return
      const approved = anchor.dataset.viewerDownload === 'true'
        && anchor.getAttribute('href') === DOWNLOAD_PATH
        && !surfaceRef.current?.contains(anchor)
      if (!approved) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('click', stopPresentationLinks, true)
    document.addEventListener('auxclick', stopPresentationLinks, true)
    document.addEventListener('fullscreenchange', updateFullscreen)
    return () => {
      document.removeEventListener('click', stopPresentationLinks, true)
      document.removeEventListener('auxclick', stopPresentationLinks, true)
      document.removeEventListener('fullscreenchange', updateFullscreen)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const surface = surfaceRef.current
    let renderer = null
    let disposed = false
    let timedOut = false
    const timer = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 120000)

    async function openPresentation() {
      setStatus('loading')
      setMessage('Opening presentation…')
      setWarning('')
      setPresentation(null)
      setCurrentSlide(0)
      setSlideCount(0)
      if (!API_PATH) throw new Error('This presentation link is invalid.')

      const metadataResponse = await fetch(API_PATH, { signal: controller.signal, credentials: 'omit', mode: 'cors', cache: 'no-store' })
      if (!metadataResponse.ok) {
        throw new Error(metadataResponse.status === 404
          ? 'This presentation is no longer available.'
          : 'The presentation could not be loaded. Please try again.')
      }
      const metadata = await metadataResponse.json()
      const file = metadata.presentation
      if (!file || file.id !== PRESENTATION_ID) throw new Error('This presentation could not be found.')
      if (disposed) return
      setPresentation(file)
      document.title = `${file.title || 'Presentation'} · Completed Projects`
      setMessage('Loading slides…')

      const response = await fetch(`${API_PATH}/file`, { signal: controller.signal, credentials: 'omit', mode: 'cors', cache: 'no-store' })
      if (!response.ok) throw new Error('The presentation file is unavailable. Please try again.')
      if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) {
        throw new Error('This file is too large for the browser preview. Download the original to view it.')
      }
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > MAX_FILE_BYTES) {
        throw new Error('This file is too large for the browser preview. Download the original to view it.')
      }
      if (disposed) return

      // Keep ownership before parsing starts so failures and cancelled loads can be disposed.
      renderer = new PptxViewer(surface, {
        fitMode: 'contain',
        zipLimits: ZIP_LIMITS,
        lazySlides: true,
        lazyMedia: true,
        pdfjs: false,
        onSlideChange: (index) => {
          if (!disposed) setCurrentSlide(index)
        },
        onSlideError: () => {
          if (!disposed) setWarning('This slide could not be fully displayed. Download the original for the complete presentation.')
        },
        onNodeError: () => {
          if (!disposed) setWarning('Some slide elements could not be displayed. The complete presentation is available in the original download.')
        },
        onSlideRendered: (_index, element) => {
          // Preserve internal slide navigation, but disable external document anchors.
          for (const anchor of element.querySelectorAll('a')) {
            anchor.removeAttribute('href')
            anchor.removeAttribute('target')
            anchor.setAttribute('aria-disabled', 'true')
            anchor.setAttribute('tabindex', '-1')
          }
        },
      })
      try {
        await renderer.open(buffer, { renderMode: 'slide', signal: controller.signal })
      } catch {
        throw new Error('This PowerPoint could not be previewed. Download the original to view the complete presentation.')
      }
      if (disposed) {
        renderer.destroy()
        return
      }
      if (!renderer.slideCount) throw new Error('This file does not contain any slides to preview.')
      rendererRef.current = renderer
      setSlideCount(renderer.slideCount)
      setCurrentSlide(renderer.currentSlideIndex)
      const ratio = renderer.slideWidth / renderer.slideHeight
      setSlideRatio(Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9)
      setStatus('ready')
    }

    openPresentation().catch((error) => {
      if (disposed) return
      renderer?.destroy()
      rendererRef.current = null
      surface.replaceChildren()
      setMessage(timedOut ? 'The connection took too long. Please try again.' : error.message || 'This presentation could not be displayed.')
      setStatus('error')
    }).finally(() => window.clearTimeout(timer))

    return () => {
      disposed = true
      controller.abort()
      window.clearTimeout(timer)
      renderer?.destroy()
      rendererRef.current = null
      navigationRef.current = false
    }
  }, [attempt])

  const navigate = useCallback(async (direction) => {
    const renderer = rendererRef.current
    if (!renderer || navigationRef.current) return
    const index = Math.max(0, Math.min(renderer.slideCount - 1, renderer.currentSlideIndex + direction))
    if (index === renderer.currentSlideIndex) return
    navigationRef.current = true
    setNavigating(true)
    setWarning('')
    try {
      await renderer.goToSlide(index)
      setCurrentSlide(renderer.currentSlideIndex)
    } catch {
      setWarning('This slide could not be displayed. You can try another slide or download the original.')
    } finally {
      navigationRef.current = false
      setNavigating(false)
    }
  }, [])

  useEffect(() => {
    const handleKeys = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        navigate(event.key === 'ArrowRight' ? 1 : -1)
      }
    }
    document.addEventListener('keydown', handleKeys)
    return () => document.removeEventListener('keydown', handleKeys)
  }, [navigate])

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      setWarning('Full screen is unavailable in this browser. You can still view every slide here.')
    }
  }

  const fittedWidth = stageSize.width && stageSize.height
    ? Math.max(1, Math.min(stageSize.width, stageSize.height * slideRatio))
    : undefined

  return (
    <div className="presentation-viewer">
      <header className="viewer-toolbar">
        <div className="viewer-file">
          <span className="viewer-file-icon"><FileSliders size={19} aria-hidden="true" /></span>
          <div className="viewer-file-copy">
            <p className="viewer-title" title={presentation?.title || 'Presentation'}>{presentation?.title || 'Presentation'}</p>
            <p className="viewer-subtitle">{slideCount ? `${slideCount} slides · PowerPoint presentation` : 'Completed Projects'}</p>
          </div>
        </div>
        <nav className="viewer-controls" aria-label="Presentation controls">
          <div className="viewer-pagination">
            <button type="button" className="viewer-icon-button" onClick={() => navigate(-1)} disabled={status !== 'ready' || currentSlide === 0 || navigating} aria-label="Previous slide" title="Previous slide (left arrow)"><ArrowLeft size={17} /></button>
            <span className="viewer-page-count" aria-live="polite" aria-atomic="true">{slideCount ? `${currentSlide + 1} / ${slideCount}` : '— / —'}</span>
            <button type="button" className="viewer-icon-button" onClick={() => navigate(1)} disabled={status !== 'ready' || currentSlide === slideCount - 1 || navigating} aria-label="Next slide" title="Next slide (right arrow)"><ArrowRight size={17} /></button>
          </div>
          <span className="viewer-control-divider" aria-hidden="true" />
          {document.fullscreenEnabled && <button type="button" className="viewer-icon-button viewer-fullscreen" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} title={fullscreen ? 'Exit full screen' : 'Full screen'}>{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}
          {presentation && <a className="viewer-download" href={DOWNLOAD_PATH} download data-viewer-download="true" title="Download original PowerPoint"><Download size={17} aria-hidden="true" /><span>Download</span></a>}
        </nav>
      </header>

      {warning && <div className="viewer-warning" role="status"><AlertCircle size={16} aria-hidden="true" /><span>{warning}</span></div>}

      <main className="viewer-main" aria-label="Slide preview">
        <div className="viewer-stage" ref={stageRef}>
          <div
            className={`viewer-slide-surface ${status === 'ready' ? 'is-ready' : ''}`}
            ref={surfaceRef}
            style={{ width: fittedWidth ? `${fittedWidth}px` : '100%', aspectRatio: slideRatio }}
            aria-hidden={status !== 'ready'}
          />
          {status === 'loading' && <div className="viewer-state" role="status"><span className="viewer-state-icon"><LoaderCircle className="viewer-spinner" size={26} aria-hidden="true" /></span><h1>{message}</h1><p>Your presentation will appear here.</p></div>}
          {status === 'error' && <div className="viewer-state viewer-error" role="alert"><span className="viewer-state-icon"><FileSliders size={28} aria-hidden="true" /></span><h1>Preview unavailable</h1><p>{message}</p><div className="viewer-state-actions"><button className="viewer-retry" type="button" onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={16} aria-hidden="true" />Try again</button>{presentation && <a className="viewer-download" href={DOWNLOAD_PATH} download data-viewer-download="true"><Download size={16} aria-hidden="true" />Download original</a>}</div></div>}
        </div>
      </main>
      <footer className="viewer-footer"><span>{status === 'ready' ? 'Use the arrows to move through the slides' : 'PowerPoint preview'}</span><span>Download for the original formatting & effects</span></footer>
    </div>
  )
}

createRoot(document.getElementById('viewer-root')).render(<PresentationViewer />)
