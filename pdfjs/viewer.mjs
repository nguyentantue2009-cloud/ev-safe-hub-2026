/*
 * EV SAFE HUB custom PDF viewer
 * Uses PDF.js 6.1.200 from the official pdfjs-dist package via jsDelivr.
 * This custom interface intentionally omits a download button.
 */

const PDFJS_VERSION = "6.1.200";
const PDFJS_CDNS = [
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`,
  `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/`,
];

let getDocument;
let GlobalWorkerOptions;
let PDFJS_BASE = PDFJS_CDNS[0];

async function loadPdfJsLibrary() {
  let lastError;

  for (const base of PDFJS_CDNS) {
    try {
      const module = await import(`${base}build/pdf.min.mjs`);
      getDocument = module.getDocument;
      GlobalWorkerOptions = module.GlobalWorkerOptions;
      PDFJS_BASE = base;
      GlobalWorkerOptions.workerSrc = `${base}build/pdf.worker.min.mjs`;
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Không tải được PDF.js từ ${base}`, error);
    }
  }

  throw new Error(
    `Không tải được thư viện PDF.js. Hãy kiểm tra kết nối Internet. ${lastError?.message || ""}`
  );
}

const DEFAULT_PDF = "../EV_SAFE_HUB_BAI_THUYET_TRINH_2026.pdf";
const MIN_SCALE = 0.35;
const MAX_SCALE = 4;
const SCALE_STEP = 1.18;

const ui = {
  app: document.getElementById("app"),
  container: document.getElementById("viewerContainer"),
  stage: document.getElementById("pageStage"),
  canvasFrame: document.getElementById("canvasFrame"),
  canvas: document.getElementById("pdfCanvas"),
  loading: document.getElementById("loading"),
  errorPanel: document.getElementById("errorPanel"),
  errorMessage: document.getElementById("errorMessage"),
  retry: document.getElementById("retry"),
  prev: document.getElementById("prevPage"),
  next: document.getElementById("nextPage"),
  pageNumber: document.getElementById("pageNumber"),
  pageCount: document.getElementById("pageCount"),
  zoomOut: document.getElementById("zoomOut"),
  zoomIn: document.getElementById("zoomIn"),
  fitWidth: document.getElementById("fitWidth"),
  zoomValue: document.getElementById("zoomValue"),
  rotate: document.getElementById("rotatePage"),
  fullscreen: document.getElementById("fullscreen"),
};

const state = {
  document: null,
  pageNumber: 1,
  scale: 1,
  rotation: 0,
  fitMode: true,
  renderTask: null,
  requestId: 0,
  resizeTimer: null,
  touchStartX: null,
};

function getPdfUrl() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("file") || DEFAULT_PDF;

  try {
    return new URL(requested, window.location.href).href;
  } catch {
    return new URL(DEFAULT_PDF, window.location.href).href;
  }
}

function setBusy(isBusy) {
  ui.loading.hidden = !isBusy;
  ui.stage.hidden = isBusy;
  if (isBusy) ui.errorPanel.hidden = true;
}

function showError(error) {
  console.error(error);
  ui.loading.hidden = true;
  ui.stage.hidden = true;
  ui.errorPanel.hidden = false;

  const message = String(error?.message || error || "Lỗi không xác định");
  const pdfUrl = getPdfUrl();
  ui.errorMessage.textContent =
    `Không tải được: ${decodeURIComponent(pdfUrl.split("/").pop() || pdfUrl)}. ` +
    `Hãy kiểm tra tệp PDF đã được tải lên GitHub đúng vị trí, đúng chữ hoa/chữ thường và GitHub Pages đã cập nhật.`;

  ui.errorPanel.title = message;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updateToolbar() {
  const total = state.document?.numPages || 0;
  ui.pageCount.textContent = total || "–";
  ui.pageNumber.max = total || 1;
  ui.pageNumber.value = state.pageNumber;
  ui.prev.disabled = state.pageNumber <= 1;
  ui.next.disabled = !total || state.pageNumber >= total;
  ui.zoomOut.disabled = state.scale <= MIN_SCALE + 0.001;
  ui.zoomIn.disabled = state.scale >= MAX_SCALE - 0.001;
  ui.zoomValue.textContent = state.fitMode ? "Vừa rộng" : `${Math.round(state.scale * 100)}%`;
}

async function calculateFitWidth(page) {
  const unscaled = page.getViewport({ scale: 1, rotation: state.rotation });
  const style = getComputedStyle(ui.container);
  const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const safeWidth = Math.max(240, ui.container.clientWidth - horizontalPadding - 4);
  return clamp(safeWidth / unscaled.width, MIN_SCALE, MAX_SCALE);
}

async function renderPage() {
  if (!state.document) return;

  const requestId = ++state.requestId;
  const page = await state.document.getPage(state.pageNumber);
  if (requestId !== state.requestId) return;

  if (state.fitMode) {
    state.scale = await calculateFitWidth(page);
  }

  const viewport = page.getViewport({ scale: state.scale, rotation: state.rotation });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  const context = ui.canvas.getContext("2d", { alpha: false });

  if (state.renderTask) {
    try { state.renderTask.cancel(); } catch { /* already complete */ }
  }

  ui.canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  ui.canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  ui.canvas.style.width = `${Math.floor(viewport.width)}px`;
  ui.canvas.style.height = `${Math.floor(viewport.height)}px`;

  const transform = outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0];
  state.renderTask = page.render({
    canvasContext: context,
    viewport,
    transform,
    background: "rgb(255,255,255)",
  });

  try {
    await state.renderTask.promise;
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") throw error;
    return;
  }

  if (requestId !== state.requestId) return;
  state.renderTask = null;
  ui.stage.hidden = false;
  ui.loading.hidden = true;
  ui.errorPanel.hidden = true;
  updateToolbar();
}

async function openDocument() {
  setBusy(true);
  state.document = null;
  state.pageNumber = 1;
  state.scale = 1;
  state.rotation = 0;
  state.fitMode = true;
  updateToolbar();

  const loadingTask = getDocument({
    url: getPdfUrl(),
    cMapUrl: `${PDFJS_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_BASE}wasm/`,
    iccUrl: `${PDFJS_BASE}iccs/`,
    enableXfa: true,
    useWorkerFetch: true,
  });

  try {
    state.document = await loadingTask.promise;
    await renderPage();
    ui.container.focus({ preventScroll: true });
  } catch (error) {
    showError(error);
  }
}

async function goToPage(pageNumber) {
  if (!state.document) return;
  const target = clamp(Math.trunc(Number(pageNumber) || 1), 1, state.document.numPages);
  if (target === state.pageNumber) {
    updateToolbar();
    return;
  }
  state.pageNumber = target;
  updateToolbar();
  ui.container.scrollTo({ top: 0, left: 0 });
  await renderPage();
}

async function changeZoom(multiplier) {
  if (!state.document) return;
  state.fitMode = false;
  state.scale = clamp(state.scale * multiplier, MIN_SCALE, MAX_SCALE);
  updateToolbar();
  await renderPage();
}

async function fitWidth() {
  if (!state.document) return;
  state.fitMode = true;
  await renderPage();
}

async function rotatePage() {
  if (!state.document) return;
  state.rotation = (state.rotation + 90) % 360;
  await renderPage();
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await ui.app.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.warn("Không thể chuyển toàn màn hình", error);
  }
}

ui.prev.addEventListener("click", () => goToPage(state.pageNumber - 1));
ui.next.addEventListener("click", () => goToPage(state.pageNumber + 1));
ui.pageNumber.addEventListener("change", () => goToPage(ui.pageNumber.value));
ui.pageNumber.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    goToPage(ui.pageNumber.value);
    ui.container.focus({ preventScroll: true });
  }
});
ui.zoomOut.addEventListener("click", () => changeZoom(1 / SCALE_STEP));
ui.zoomIn.addEventListener("click", () => changeZoom(SCALE_STEP));
ui.fitWidth.addEventListener("click", fitWidth);
ui.rotate.addEventListener("click", rotatePage);
ui.fullscreen.addEventListener("click", toggleFullscreen);
ui.retry.addEventListener("click", openDocument);

document.addEventListener("fullscreenchange", () => {
  ui.fullscreen.firstChild.textContent = document.fullscreenElement ? "⤢" : "⛶";
  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(() => {
    if (state.fitMode) renderPage();
  }, 120);
});

document.addEventListener("keydown", (event) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (["ArrowLeft", "PageUp"].includes(event.key)) {
    event.preventDefault();
    goToPage(state.pageNumber - 1);
  } else if (["ArrowRight", "PageDown", " "].includes(event.key)) {
    event.preventDefault();
    goToPage(state.pageNumber + 1);
  } else if (["+", "="].includes(event.key)) {
    event.preventDefault();
    changeZoom(SCALE_STEP);
  } else if (event.key === "-") {
    event.preventDefault();
    changeZoom(1 / SCALE_STEP);
  } else if (event.key === "0") {
    event.preventDefault();
    fitWidth();
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    toggleFullscreen();
  }
});

ui.container.addEventListener("touchstart", (event) => {
  if (event.touches.length === 1) state.touchStartX = event.touches[0].clientX;
}, { passive: true });

ui.container.addEventListener("touchend", (event) => {
  if (state.touchStartX === null || event.changedTouches.length !== 1) return;
  const delta = event.changedTouches[0].clientX - state.touchStartX;
  state.touchStartX = null;
  if (Math.abs(delta) < 70) return;
  if (delta < 0) goToPage(state.pageNumber + 1);
  else goToPage(state.pageNumber - 1);
}, { passive: true });

const resizeObserver = new ResizeObserver(() => {
  if (!state.document || !state.fitMode) return;
  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(renderPage, 150);
});
resizeObserver.observe(ui.container);

async function initializeViewer() {
  try {
    await loadPdfJsLibrary();
    await openDocument();
  } catch (error) {
    showError(error);
  }
}

initializeViewer();
