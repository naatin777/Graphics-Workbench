import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { toErrorMessage } from '@graphics-workbench/core/shared/error.js';
import { ExcalidrawError, parseExcalidrawScene } from './excalidraw_scene.js';
import { withExcalidrawDom, type ExcalidrawDomOptions } from './excalidraw_dom.js';

/**
 * The official exportToSvg() entry bundled by vscode/webview/excalidraw/vite.config.ts.
 * Search upward from the compiled module so the same lookup works in the
 * extension package and the repository test build.
 */
let resolvedBundleUrl: string | undefined;

function getBundleUrl(): string {
  resolvedBundleUrl ??= resolveExcalidrawBundleUrl();
  return resolvedBundleUrl;
}

const defaultExportPadding = 10;

export interface ExcalidrawToSvgOptions {
  sourcePath: string;
  svgPath: string;
  signal?: AbortSignal;
  bundleUrl?: string;
  loadExportToSvg?: ExcalidrawDomOptions['loadExportToSvg'];
}

/** Reads a .excalidraw scene and renders it to a normalized SVG file using the official exportToSvg(). */
export async function excalidrawToSvg(options: ExcalidrawToSvgOptions): Promise<void> {
  options.signal?.throwIfAborted();
  const scene = parseExcalidrawScene(await readExcalidrawSource(options.sourcePath));
  options.signal?.throwIfAborted();

  const svg = await withExcalidrawDom(
    {
      bundleUrl: options.bundleUrl ?? getBundleUrl(),
      ...(options.loadExportToSvg !== undefined && { loadExportToSvg: options.loadExportToSvg }),
    },
    async ({ exportToSvg, serializeSvg }) => {
      options.signal?.throwIfAborted();
      try {
        const svgElement = await exportToSvg({
          elements: scene.elements,
          appState: scene.appState,
          files: scene.files,
          exportPadding: defaultExportPadding,
        });
        return normalizeExcalidrawSvg(serializeSvg(svgElement));
      } catch (error) {
        throw new ExcalidrawError('export', `Excalidraw SVG export failed: ${toErrorMessage(error)}`, { cause: error });
      }
    },
  );

  await writeFile(options.svgPath, svg);
}

function resolveExcalidrawBundleUrl(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(directory, 'media', 'excalidraw', 'excalidraw-adapter.mjs');
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  throw new Error('Excalidraw converter assets are missing. Rebuild the extension (npm run build).');
}

async function readExcalidrawSource(sourcePath: string): Promise<string> {
  try {
    return await readFile(sourcePath, 'utf8');
  } catch (error) {
    throw new ExcalidrawError('read', `Could not read the Excalidraw file: ${toErrorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * Excalidraw's serializer emits the SVG namespace twice on the root element;
 * strict XML parsers (libxml2 used by rsvg-convert and sharp) reject the duplicate.
 */
export function normalizeExcalidrawSvg(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/u, (openTag) => {
    const seen = new Set<string>();
    let cleaned = '<svg';
    for (const match of openTag.slice('<svg'.length).matchAll(/\s+([^\s=]+)(?:\s*=\s*"[^"]*")?/gu)) {
      const attribute = match[0].trim();
      if (attribute === '') {
        continue;
      }
      const name = match[1] ?? attribute;
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      cleaned += ` ${attribute}`;
    }
    return `${cleaned}>`;
  });
}
