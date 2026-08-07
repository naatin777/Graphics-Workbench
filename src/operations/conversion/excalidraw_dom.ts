import { JSDOM } from 'jsdom';

import { HeavyProcessLimiter } from '../external_tools/heavy_process_limiter.js';

type ExcalidrawExportToSvg = (options: {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  exportPadding: number;
}) => Promise<unknown>;

export interface ExcalidrawDomContext {
  exportToSvg: ExcalidrawExportToSvg;
  serializeSvg: (svgElement: unknown) => string;
}

export interface ExcalidrawDomOptions {
  bundleUrl: string;
  loadExportToSvg?: (bundleUrl: string) => Promise<{ exportToSvg: ExcalidrawExportToSvg }>;
}

/** Runs `run` with a minimal browser DOM for @excalidraw/excalidraw and restores the globals afterwards. */
export async function withExcalidrawDom<T>(
  options: ExcalidrawDomOptions,
  run: (context: ExcalidrawDomContext) => Promise<T>,
): Promise<T> {
  // The DOM install is not reentrant (it temporarily replaces globals), so all
  // exports share a single-slot queue. ponytail: process-wide lock; per-worker
  // isolation if multiple concurrent exports ever become a bottleneck.
  return domLock.run(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://graphics-workbench.local/' });
    const bundleBaseUrl = new URL('.', options.bundleUrl).href;
    const restoreGlobals = installDomGlobals(dom, bundleBaseUrl);
    try {
      const { exportToSvg } = await (options.loadExportToSvg ?? importExcalidrawBundle)(options.bundleUrl);
      const serializer = new dom.window.XMLSerializer();
      return await run({
        exportToSvg,
        serializeSvg: (svgElement) => serializer.serializeToString(svgElement),
      });
    } finally {
      restoreGlobals();
      dom.window.close();
    }
  });
}

const domLock = new HeavyProcessLimiter(1);

function isExcalidrawBundle(value: unknown): value is { exportToSvg: ExcalidrawExportToSvg } {
  return (
    typeof value === 'object' && value !== null && 'exportToSvg' in value && typeof value.exportToSvg === 'function'
  );
}

async function importExcalidrawBundle(bundleUrl: string): Promise<{ exportToSvg: ExcalidrawExportToSvg }> {
  const imported: unknown = await import(bundleUrl);
  if (!isExcalidrawBundle(imported)) {
    throw new Error(`Excalidraw bundle ${bundleUrl} does not export exportToSvg.`);
  }
  return { exportToSvg: imported.exportToSvg };
}

type RestoreGlobals = () => void;

function installDomGlobals(dom: JSDOM, bundleBaseUrl: string): RestoreGlobals {
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  const defineGlobal = (key: string, value: unknown): void => {
    if (!originalDescriptors.has(key)) {
      originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    }
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };

  defineGlobal('window', dom.window);
  defineGlobal('document', dom.window.document);
  defineGlobal('navigator', dom.window.navigator);
  defineGlobal('devicePixelRatio', dom.window.devicePixelRatio);
  defineGlobal('FontFace', ExcalidrawFontFaceStub);

  const fontFetch = createFontFetch(bundleBaseUrl);
  defineGlobal('fetch', fontFetch);
  Object.defineProperty(dom.window, 'fetch', { value: fontFetch, configurable: true });

  installCanvasContextStub(dom);

  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) {
      continue;
    }
    if (!originalDescriptors.has(key)) {
      originalDescriptors.set(key, undefined);
    }
    try {
      Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
    } catch {
      // A few window members cannot be redefined as globals; exportToSvg does not need them.
    }
  }

  return () => {
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor === undefined) {
        delete (globalThis as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  };
}

/** jsdom does not implement canvas 2D contexts; exportToSvg only needs text metrics. */
function installCanvasContextStub(dom: JSDOM): void {
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: (): Record<string, unknown> => createCanvas2DContext(),
  });
}

function noop(): void {
  // The canvas 2D context stub ignores drawing calls; it only needs measureText.
  return;
}

function createCanvas2DContext(): Record<string, unknown> {
  const context: Record<string, unknown> = { filter: 'none', font: '10px sans-serif' };
  for (const property of [
    'fillStyle',
    'strokeStyle',
    'textAlign',
    'textBaseline',
    'globalAlpha',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'miterLimit',
    'shadowBlur',
    'shadowColor',
    'shadowOffsetX',
    'shadowOffsetY',
    'letterSpacing',
    'fontKerning',
  ]) {
    Object.defineProperty(context, property, { get: () => '', set: noop, configurable: true });
  }
  context.measureText = (
    text: unknown,
  ): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number } => {
    const textValue = typeof text === 'string' ? text : '';
    const fontValue = typeof context.font === 'string' ? context.font : '10px';
    const fontSize = Number.parseFloat(fontValue) || 10;
    return {
      width: textValue.length * fontSize * 0.6,
      actualBoundingBoxAscent: fontSize * 0.8,
      actualBoundingBoxDescent: fontSize * 0.2,
    };
  };
  for (const method of [
    'save',
    'restore',
    'scale',
    'rotate',
    'translate',
    'transform',
    'setTransform',
    'resetTransform',
    'beginPath',
    'closePath',
    'moveTo',
    'lineTo',
    'bezierCurveTo',
    'quadraticCurveTo',
    'arc',
    'arcTo',
    'rect',
    'fillRect',
    'strokeRect',
    'clearRect',
    'fillText',
    'strokeText',
    'fill',
    'stroke',
    'clip',
    'drawImage',
    'createImageData',
    'getImageData',
    'putImageData',
    'createLinearGradient',
    'createRadialGradient',
    'createPattern',
    'ellipse',
    'roundRect',
    'setLineDash',
    'getLineDash',
    'reset',
  ]) {
    context[method] = noop;
  }
  return context;
}

/** FontFace is unavailable in jsdom; the export path only reads family/unicodeRange descriptors. */
class ExcalidrawFontFaceStub {
  family: string;
  status: 'loaded' | 'error';

  constructor(family: string, _source: string, descriptors?: Record<string, string>) {
    this.family = family;
    this.status = 'loaded';
    Object.assign(this, { display: 'auto', unicodeRange: 'U+0-10FFFF', style: 'normal', weight: '400' }, descriptors);
  }

  async load(): Promise<ExcalidrawFontFaceStub> {
    return this;
  }
}

/** Excalidraw's bundled fonts are referenced with `./fonts/...` relative to the bundle. */
function createFontFetch(bundleBaseUrl: string): typeof fetch {
  const nodeFetch = globalThis.fetch;
  return async (input, init) => {
    if (typeof input === 'string' && input.startsWith('./')) {
      return nodeFetch(new URL(input, bundleBaseUrl).href, init);
    }
    return nodeFetch(input, init);
  };
}
