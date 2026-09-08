const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_PREVIEW_ARCHIVE_BYTES = 200 * 1024 * 1024;
const TARGET_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.9;

function abortError() {
  return new DOMException("Preview preparation was cancelled.", "AbortError");
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function nextFrame() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

async function waitForImages(root, signal) {
  await Promise.all(
    [...root.querySelectorAll("img")].map(async (image) => {
      checkAbort(signal);
      if (!image.complete) {
        await new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }
      await image.decode?.().catch(() => {});
    }),
  );
}

async function dataUrlBytes(dataUrl) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("A slide preview could not be encoded.");
  return new Uint8Array(await response.arrayBuffer());
}

export async function preparePresentationPreviews(
  file,
  { signal, onProgress = () => {} } = {},
) {
  if (!(file instanceof File) || !/\.pptx$/i.test(file.name)) {
    throw new Error("Choose a PowerPoint .pptx file.");
  }
  if (file.size < 1 || file.size > MAX_FILE_BYTES) {
    throw new Error("Choose a presentation of 200 MB or smaller.");
  }
  checkAbort(signal);
  onProgress({ phase: "tools", label: "Loading preview tools…", value: 0 });
  const [{ PptxViewer, RECOMMENDED_ZIP_LIMITS }, { default: JSZip }, imageTools] =
    await Promise.all([
      import("@aiden0z/pptx-renderer"),
      import("jszip"),
      import("html-to-image"),
    ]);
  checkAbort(signal);

  const parseHost = document.createElement("div");
  const captureHost = document.createElement("div");
  const offscreen = document.createElement("div");
  offscreen.setAttribute("aria-hidden", "true");
  Object.assign(offscreen.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: "2000px",
    height: "2200px",
    overflow: "hidden",
    pointerEvents: "none",
    opacity: "1",
    zIndex: "-1",
  });
  for (const host of [parseHost, captureHost]) {
    Object.assign(host.style, {
      width: "1600px",
      height: "900px",
      overflow: "hidden",
    });
  }
  offscreen.append(parseHost, captureHost);
  document.body.appendChild(offscreen);

  let viewer;
  try {
    onProgress({ phase: "open", label: "Opening PowerPoint…", value: 0 });
    const buffer = await file.arrayBuffer();
    checkAbort(signal);
    viewer = new PptxViewer(parseHost, {
      fitMode: "contain",
      lazySlides: true,
      lazyMedia: true,
      pdfjs: false,
      zipLimits: {
        ...RECOMMENDED_ZIP_LIMITS,
        maxEntries: 12000,
        maxEntryUncompressedBytes: 200 * 1024 * 1024,
        maxTotalUncompressedBytes: 1024 * 1024 * 1024,
        maxMediaBytes: 1024 * 1024 * 1024,
      },
    });
    await viewer.open(buffer, { renderMode: "slide", signal });
    checkAbort(signal);
    if (!Number.isSafeInteger(viewer.slideCount) || viewer.slideCount < 1 || viewer.slideCount > 500) {
      throw new Error("This PowerPoint does not contain a supported slide set.");
    }
    const nativeWidth = Math.max(1, Math.round(viewer.slideWidth));
    const nativeHeight = Math.max(1, Math.round(viewer.slideHeight));
    captureHost.style.width = `${nativeWidth}px`;
    captureHost.style.height = `${nativeHeight}px`;
    const scale = TARGET_LONG_EDGE / Math.max(nativeWidth, nativeHeight);
    const width = Math.max(240, Math.round(nativeWidth * scale));
    const height = Math.max(240, Math.round(nativeHeight * scale));
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      `${JSON.stringify({
        version: 1,
        slideCount: viewer.slideCount,
        width,
        height,
        format: "jpg",
      })}\n`,
    );

    await document.fonts?.ready;
    for (let index = 0; index < viewer.slideCount; index += 1) {
      checkAbort(signal);
      captureHost.replaceChildren();
      const handle = await viewer.renderSlideToContainer(index, captureHost, 1);
      if (!handle?.element) throw new Error(`Slide ${index + 1} could not be prepared.`);
      try {
        await handle.ready;
        await waitForImages(handle.element, signal);
        await nextFrame();
        checkAbort(signal);
        const dataUrl = await imageTools.toJpeg(handle.element, {
          backgroundColor: "#ffffff",
          width: nativeWidth,
          height: nativeHeight,
          canvasWidth: width,
          canvasHeight: height,
          pixelRatio: 1,
          quality: JPEG_QUALITY,
          cacheBust: false,
          skipAutoScale: true,
        });
        const bytes = await dataUrlBytes(dataUrl);
        zip.file(`slides/slide-${String(index + 1).padStart(4, "0")}.jpg`, bytes, {
          binary: true,
          compression: "STORE",
        });
      } finally {
        handle.dispose?.();
        captureHost.replaceChildren();
      }
      onProgress({
        phase: "render",
        label: `Preparing slide ${index + 1} of ${viewer.slideCount}…`,
        value: Math.round(((index + 1) / viewer.slideCount) * 100),
        current: index + 1,
        total: viewer.slideCount,
      });
    }

    checkAbort(signal);
    onProgress({ phase: "package", label: "Packaging slide previews…", value: 100 });
    const archive = await zip.generateAsync({
      type: "blob",
      mimeType: "application/zip",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      platform: "DOS",
    });
    if (archive.size < 1 || archive.size > MAX_PREVIEW_ARCHIVE_BYTES) {
      throw new Error("The generated slide previews exceed the 200 MB upload limit.");
    }
    return {
      archive: new File([archive], `${file.name.replace(/\.pptx$/i, "")}.previews.zip`, {
        type: "application/zip",
      }),
      slideCount: viewer.slideCount,
      width,
      height,
    };
  } catch (error) {
    if (signal?.aborted && error?.name !== "AbortError") throw abortError();
    throw error;
  } finally {
    viewer?.destroy();
    offscreen.remove();
  }
}
