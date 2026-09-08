import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  FileSliders,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RotateCcw,
} from "lucide-react";
import "./viewer.css";

const metaId =
  document.querySelector('meta[name="presentation-id"]')?.content || "";
const PRESENTATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    metaId,
  ) && window.self !== window.top
    ? metaId
    : null;
const API_PATH = PRESENTATION_ID
  ? `/api/presentations/${PRESENTATION_ID}`
  : null;

function slideName(index) {
  return `slide-${String(index + 1).padStart(4, "0")}.jpg`;
}

export default function PresentationViewer() {
  const stageRef = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [presentation, setPresentation] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Opening presentation…");
  const [warning, setWarning] = useState("");
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideLoaded, setSlideLoaded] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [retryable, setRetryable] = useState(true);

  useEffect(() => {
    const stage = stageRef.current;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateFullscreen = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    async function openPresentation() {
      if (!API_PATH) throw new Error("This presentation link is invalid.");
      const response = await fetch(API_PATH, {
        signal: controller.signal,
        credentials: "omit",
        mode: "cors",
        cache: "no-store",
      });
      if (!response.ok) {
        const error = new Error(
          response.status === 404
            ? "This presentation is no longer available."
            : "The presentation could not be opened. Please try again.",
        );
        error.retryable = response.status !== 404;
        throw error;
      }
      const metadata = await response.json();
      const file = metadata.presentation;
      const preview = file?.preview;
      if (
        !file ||
        file.id !== PRESENTATION_ID ||
        file.available !== true ||
        preview?.version !== 1 ||
        preview?.format !== "jpg" ||
        preview?.slideCount !== file.slideCount ||
        !Number.isSafeInteger(preview.width) ||
        !Number.isSafeInteger(preview.height) ||
        typeof preview.cacheKey !== "string" ||
        typeof preview.baseUrl !== "string"
      ) {
        const error = new Error(
          "The slide preview is not ready. The administrator needs to publish it again.",
        );
        error.retryable = false;
        throw error;
      }
      if (disposed) return;
      setPresentation(file);
      document.title = `${file.title || "Presentation"} · Completed Projects`;
      setStatus("ready");
    }

    openPresentation().catch((error) => {
      if (disposed || error.name === "AbortError") return;
      setMessage(error.message || "This presentation could not be displayed.");
      setRetryable(error.retryable !== false);
      setStatus("error");
    });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [attempt]);

  const slideCount = presentation?.preview?.slideCount || 0;
  const slideRatio = presentation
    ? presentation.preview.width / presentation.preview.height
    : 16 / 9;
  const slideUrl = useCallback(
    (index) =>
      presentation
        ? `${presentation.preview.baseUrl}/${slideName(index)}?v=${encodeURIComponent(presentation.preview.cacheKey)}`
        : "",
    [presentation],
  );
  const currentUrl = useMemo(
    () => slideUrl(currentSlide),
    [currentSlide, slideUrl],
  );

  useEffect(() => {
    if (!presentation) return undefined;
    const nearby = [currentSlide + 1, currentSlide + 2, currentSlide - 1].filter(
      (index) => index >= 0 && index < slideCount,
    );
    const images = nearby.map((index) => {
      const image = new Image();
      image.decoding = "async";
      image.src = slideUrl(index);
      return image;
    });
    return () => {
      for (const image of images) image.src = "";
    };
  }, [currentSlide, presentation, slideCount, slideUrl]);

  const navigate = useCallback(
    (direction) => {
      if (!presentation) return;
      setSlideLoaded(false);
      setWarning("");
      setCurrentSlide((index) =>
        Math.max(0, Math.min(slideCount - 1, index + direction)),
      );
    },
    [presentation, slideCount],
  );

  useEffect(() => {
    const handleKeys = (event) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"]',
        )
      )
        return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(event.key === "ArrowRight" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", handleKeys);
    return () => document.removeEventListener("keydown", handleKeys);
  }, [navigate]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setWarning(
        "Full screen is unavailable in this browser. You can still view every slide here.",
      );
    }
  }

  const fittedWidth =
    stageSize.width && stageSize.height
      ? Math.max(1, Math.min(stageSize.width, stageSize.height * slideRatio))
      : undefined;

  return (
    <div className="presentation-viewer">
      <header className="viewer-toolbar">
        <nav className="viewer-controls" aria-label="Presentation controls">
          <div className="viewer-pagination">
            <button
              type="button"
              className="viewer-icon-button"
              onClick={() => navigate(-1)}
              disabled={status !== "ready" || currentSlide === 0}
              aria-label="Previous slide"
              title="Previous slide (left arrow)"
            >
              <ArrowLeft size={17} />
            </button>
            <span
              className="viewer-page-count"
              aria-live="polite"
              aria-atomic="true"
            >
              {slideCount ? `${currentSlide + 1} / ${slideCount}` : "— / —"}
            </span>
            <button
              type="button"
              className="viewer-icon-button"
              onClick={() => navigate(1)}
              disabled={status !== "ready" || currentSlide === slideCount - 1}
              aria-label="Next slide"
              title="Next slide (right arrow)"
            >
              <ArrowRight size={17} />
            </button>
          </div>
          <span className="viewer-control-divider" aria-hidden="true" />
          {document.fullscreenEnabled && (
            <button
              type="button"
              className="viewer-icon-button viewer-fullscreen"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}
              title={fullscreen ? "Exit full screen" : "Full screen"}
            >
              {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          )}
        </nav>
      </header>

      {warning && (
        <div className="viewer-warning" role="status">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{warning}</span>
        </div>
      )}

      <main className="viewer-main" aria-label="Slide preview">
        <div className="viewer-stage" ref={stageRef}>
          {presentation && (
            <div
              className={`viewer-slide-surface ${slideLoaded ? "is-ready" : ""}`}
              style={{
                width: fittedWidth ? `${fittedWidth}px` : "100%",
                aspectRatio: slideRatio,
              }}
            >
              <img
                key={currentUrl}
                className="viewer-slide-image"
                src={currentUrl}
                width={presentation.preview.width}
                height={presentation.preview.height}
                alt={`Slide ${currentSlide + 1} of ${slideCount}`}
                decoding="async"
                draggable="false"
                onLoad={() => setSlideLoaded(true)}
                onError={() => {
                  setSlideLoaded(false);
                  setWarning(
                    `Slide ${currentSlide + 1} could not be loaded. Please try again.`,
                  );
                }}
              />
              {!slideLoaded && status === "ready" && (
                <div className="viewer-slide-loading" role="status">
                  <LoaderCircle className="viewer-spinner" size={24} />
                  Loading slide…
                </div>
              )}
            </div>
          )}
          {status === "loading" && (
            <div className="viewer-state">
              <span className="viewer-state-icon">
                <LoaderCircle
                  className="viewer-spinner"
                  size={26}
                  aria-hidden="true"
                />
              </span>
              <h1 role="status">{message}</h1>
            </div>
          )}
          {status === "error" && (
            <div className="viewer-state viewer-error" role="alert">
              <span className="viewer-state-icon">
                <FileSliders size={28} aria-hidden="true" />
              </span>
              <h1>Preview unavailable</h1>
              <p>{message}</p>
              {retryable && (
                <div className="viewer-state-actions">
                  <button
                    className="viewer-retry"
                    type="button"
                    onClick={() => {
                      setStatus("loading");
                      setMessage("Opening presentation…");
                      setWarning("");
                      setPresentation(null);
                      setCurrentSlide(0);
                      setSlideLoaded(false);
                      setRetryable(true);
                      setAttempt((value) => value + 1);
                    }}
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("viewer-root")).render(
  <PresentationViewer />,
);
