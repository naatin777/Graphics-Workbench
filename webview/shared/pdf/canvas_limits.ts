export interface PdfCanvasPreviewSettings {
  maxCanvasPixels?: number;
  maxDevicePixelRatio?: number;
}

export interface PdfCanvasDimensions {
  cssWidth: number;
  cssHeight: number;
  width: number;
  height: number;
  outputScale: number;
}

export function calculatePdfCanvasDimensions(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number | undefined,
  settings?: PdfCanvasPreviewSettings,
): PdfCanvasDimensions {
  const cssWidth = safeCssDimension(viewportWidth);
  const cssHeight = safeCssDimension(viewportHeight);
  const maxCanvasPixels = safeMaxCanvasPixels(settings?.maxCanvasPixels);
  const configuredDpr = safeMaxDevicePixelRatio(settings?.maxDevicePixelRatio);
  const effectiveDevicePixelRatio = safeDevicePixelRatio(devicePixelRatio);
  const requestedScale = Math.max(1, Math.min(effectiveDevicePixelRatio, configuredDpr));
  const area = cssWidth > maxCanvasPixels / cssHeight ? Number.POSITIVE_INFINITY : cssWidth * cssHeight;
  const outputScale =
    area <= 0 || !Number.isFinite(area)
      ? Math.max(Number.MIN_VALUE, Math.min(requestedScale, Math.sqrt(maxCanvasPixels / cssWidth / cssHeight)))
      : Math.max(Number.MIN_VALUE, Math.min(requestedScale, Math.sqrt(maxCanvasPixels / area)));
  const dimensions = canvasDimensions(cssWidth, cssHeight, outputScale, maxCanvasPixels);
  return { cssWidth, cssHeight, ...dimensions, outputScale };
}

function safeCssDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function safeMaxCanvasPixels(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 1_000_000 ? value : 40_000_000;
}

function safeMaxDevicePixelRatio(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value >= 1 && value <= 8 ? value : 2;
}

function safeDevicePixelRatio(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : 1;
}

function canvasDimensions(
  width: number,
  height: number,
  scale: number,
  maxCanvasPixels: number,
): { width: number; height: number } {
  let canvasWidth = Math.max(1, Math.floor(width * scale));
  let canvasHeight = Math.max(1, Math.floor(height * scale));
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) {
    canvasWidth = 1;
    canvasHeight = 1;
  }
  canvasWidth = Math.min(canvasWidth, maxCanvasPixels);
  canvasHeight = Math.min(canvasHeight, Math.max(1, Math.floor(maxCanvasPixels / canvasWidth)));
  return { width: Math.max(1, canvasWidth), height: Math.max(1, canvasHeight) };
}
