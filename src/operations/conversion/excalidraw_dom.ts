import type { JSDOM } from 'jsdom';

import { HeavyProcessLimiter } from '../external_tools/heavy_process_limiter.js';
import { ExcalidrawDomPool } from './excalidraw_dom_pool.js';

type ExcalidrawExportToSvg = (options: {
  // oxlint-disable-next-line typescript/no-restricted-types -- excalidrawバンドルAPIの境界: 要素配列はバンドル固有の型を持つ。
  elements: unknown[];
  // oxlint-disable-next-line typescript/no-restricted-types -- excalidrawバンドルAPIの境界: appStateはバンドル固有の任意dict。
  appState: Record<string, unknown>;
  // oxlint-disable-next-line typescript/no-restricted-types -- excalidrawバンドルAPIの境界: filesはバンドル固有の任意dict。
  files: Record<string, unknown>;
  exportPadding: number;
  // oxlint-disable-next-line typescript/no-restricted-types -- excalidrawバンドルAPIの境界: 返り値はバンドルが生成するDOM SVG要素。
}) => Promise<unknown>;

export interface ExcalidrawDomContext {
  exportToSvg: ExcalidrawExportToSvg;
  // oxlint-disable-next-line typescript/no-restricted-types -- exportToSvgの返り値であるDOM SVG要素を受け取る境界。
  serializeSvg: (svgElement: unknown) => string;
}

export interface ExcalidrawDomOptions {
  bundleUrl: string;
  loadExportToSvg?: (bundleUrl: string) => Promise<{ exportToSvg: ExcalidrawExportToSvg }>;
}

/** The globals are process-wide, so exports share a single-slot queue; the pool reuses the windows. */
const domLock = new HeavyProcessLimiter(1);
const domPool = new ExcalidrawDomPool(3);

/**
 * Runs `run` with a minimal browser DOM for @excalidraw/excalidraw.
 *
 * A pooled jsdom window is used, browser globals are installed for the
 * duration of the input, and the original global state is restored
 * afterwards. The window itself stays alive in the pool for reuse.
 */
export async function withExcalidrawDom<T>(
  options: ExcalidrawDomOptions,
  run: (context: ExcalidrawDomContext) => Promise<T>,
): Promise<T> {
  return domLock.run(async () => {
    const instance = domPool.acquire();
    const bundleBaseUrl = new URL('.', options.bundleUrl).href;
    const restoreGlobals = installDomGlobals(instance.dom, bundleBaseUrl);
    try {
      const { exportToSvg } = await (options.loadExportToSvg ?? importExcalidrawBundle)(options.bundleUrl);
      const serializer = new instance.dom.window.XMLSerializer();
      return await run({
        exportToSvg,
        serializeSvg: (svgElement) => serializer.serializeToString(svgElement),
      });
    } catch (error) {
      domPool.markFailed(instance);
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      restoreGlobals();
      domPool.release(instance);
    }
  });
}

// oxlint-disable-next-line typescript/no-restricted-types -- 型ガード: 動的import結果がバンドル形式かを検証する。
function isExcalidrawBundle(value: unknown): value is { exportToSvg: ExcalidrawExportToSvg } {
  return (
    typeof value === 'object' && value !== null && 'exportToSvg' in value && typeof value.exportToSvg === 'function'
  );
}

async function importExcalidrawBundle(bundleUrl: string): Promise<{ exportToSvg: ExcalidrawExportToSvg }> {
  // oxlint-disable-next-line typescript/no-restricted-types -- 外部バンドルの動的import結果を型ガードで検証する境界。
  const imported: unknown = await import(bundleUrl);
  if (!isExcalidrawBundle(imported)) {
    throw new Error(`Excalidraw bundle ${bundleUrl} does not export exportToSvg.`);
  }
  return { exportToSvg: imported.exportToSvg };
}

type RestoreGlobals = () => void;

function installDomGlobals(dom: JSDOM, bundleBaseUrl: string): RestoreGlobals {
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  // oxlint-disable-next-line typescript/no-restricted-types -- jsdomのuntypedなwindowメンバーをグローバルに設定する境界。
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
  defineGlobal('Path2D', ExcalidrawPath2DStub);

  const fontFetch = createFontFetch(bundleBaseUrl);
  defineGlobal('fetch', fontFetch);
  Object.defineProperty(dom.window, 'fetch', { value: fontFetch, configurable: true });

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
        Reflect.deleteProperty(globalThis, key);
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
  };
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

/**
 * jsdom does not implement Path2D, and the excalidraw bundle calls it while
 * generating element shapes. The SVG exporter reads the path data directly, so
 * a no-op Path2D keeps shape generation from aborting elements.
 */
const path2DMethodNames = [
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'closePath',
  'setTransform',
] as const;

function noopPath2DMethod(): void {
  return;
}

function ExcalidrawPath2DStub(this: { [key: string]: () => void }, _path?: string): void {
  for (const name of path2DMethodNames) {
    this[name] = noopPath2DMethod;
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
