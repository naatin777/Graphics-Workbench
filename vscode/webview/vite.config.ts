import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';

const webviewRoot = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(webviewRoot, '..', 'extension');
const protocolRoot = resolve(webviewRoot, '..', 'protocol');
const repositoryRoot = resolve(webviewRoot, '..', '..');
const outputRoot = resolve(extensionRoot, 'media', 'webview');

const fixtureFiles = new Map([
  ['single-page-document.pdf', resolve(repositoryRoot, 'test', 'input', 'valid', 'pdf', 'single-page-document.pdf')],
  ['multi-page-table.pdf', resolve(repositoryRoot, 'test', 'input', 'valid', 'pdf', 'multi-page-table.pdf')],
]);

export default defineConfig({
  root: webviewRoot,
  base: '',
  plugins: [
    solid(),
    copyCodiconAssetPlugin(outputRoot),
    copyPdfJsAssetsPlugin(resolve(outputRoot, 'pdfjs')),
    browserDevelopmentAssetsPlugin(),
  ],
  resolve: {
    alias: {
      '@webview-shared': resolve(webviewRoot, 'src', 'shared'),
      '@graphics-workbench-typed-protocol': resolve(protocolRoot, 'protocols', 'typed_protocol.ts'),
      '@graphics-workbench-crop-pdf-protocol': resolve(protocolRoot, 'protocols', 'crop_pdf_protocol.ts'),
      '@graphics-workbench-merge-pdf-protocol': resolve(protocolRoot, 'protocols', 'merge_pdf_protocol.ts'),
      '@graphics-workbench-split-pdf-protocol': resolve(protocolRoot, 'protocols', 'split_pdf_protocol.ts'),
      '@graphics-workbench-rotate-pdf-protocol': resolve(protocolRoot, 'protocols', 'rotate_pdf_protocol.ts'),
      '@graphics-workbench-reorder-pdf-protocol': resolve(protocolRoot, 'protocols', 'reorder_pdf_protocol.ts'),
      '@graphics-workbench-preview-protocol': resolve(protocolRoot, 'protocols', 'preview_protocol.ts'),
      '@graphics-workbench-table-editor-protocol': resolve(protocolRoot, 'protocols', 'table_editor_protocol.ts'),
      '@graphics-workbench-table-model': resolve(protocolRoot, 'table', 'table_model.ts'),
      '@graphics-workbench-table-parser': resolve(protocolRoot, 'table', 'parse_delimited.ts'),
      '@graphics-workbench-table-renderer': resolve(protocolRoot, 'table', 'table_renderer.ts'),
    },
  },
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    // The unified app intentionally contains all page entry points. Keep the
    // warning threshold above the single shared bundle while retaining Vite's
    // warning checks for unexpected additional output.
    chunkSizeWarningLimit: 800,
    cssCodeSplit: false,
    rolldownOptions: {
      input: resolve(webviewRoot, 'index.html'),
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) =>
          isCssAsset(assetInfo.names, assetInfo.originalFileNames) ? 'index.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});

function isCssAsset(names: readonly string[], originalFileNames: readonly string[]): boolean {
  return [...names, ...originalFileNames].some((fileName) => fileName.endsWith('.css'));
}

function copyCodiconAssetPlugin(outDir: string): Plugin {
  return {
    name: 'copy-codicon-asset',
    apply: 'build',
    closeBundle() {
      const cssPath = resolve(outDir, 'index.css');
      const css = readFileSync(cssPath, 'utf8');
      const assetName = css.match(/assets\/(codicon-[^"]+\.ttf)/u)?.[1];
      if (assetName === undefined) {
        throw new Error(`Codicon font asset not found in ${cssPath}`);
      }
      const fontPath = resolve(outDir, 'assets', assetName);
      const sharedRoot = resolve(outDir, 'shared');
      mkdirSync(sharedRoot, { recursive: true });
      copyFileSync(fontPath, resolve(sharedRoot, 'codicon.ttf'));
      writeFileSync(cssPath, css.replaceAll(`assets/${assetName}`, 'shared/codicon.ttf'));
      rmSync(fontPath);
    },
  };
}

function copyPdfJsAssetsPlugin(assetsRoot: string): Plugin {
  return {
    name: 'copy-pdfjs-assets',
    apply: 'build',
    closeBundle() {
      const sourceRoot = resolve(repositoryRoot, 'node_modules', 'pdfjs-dist');
      const workerSource = resolve(sourceRoot, 'build', 'pdf.worker.min.mjs');
      if (!existsSync(workerSource)) {
        throw new Error(`PDF.js worker not found: ${workerSource}`);
      }
      mkdirSync(assetsRoot, { recursive: true });
      copyFileSync(workerSource, resolve(assetsRoot, 'pdf.worker.mjs'));
      for (const directoryName of ['cmaps', 'standard_fonts', 'wasm']) {
        const source = resolve(sourceRoot, directoryName);
        if (!existsSync(source)) {
          throw new Error(`PDF.js asset directory not found: ${source}`);
        }
        cpSync(source, resolve(assetsRoot, directoryName), { recursive: true });
      }
    },
  };
}

function browserDevelopmentAssetsPlugin(): Plugin {
  return {
    name: 'browser-development-assets',
    configureServer(server) {
      server.middlewares.use('/fixtures', (request, response, next) => {
        const name = request.url?.replace(/^\//u, '');
        const fixture = name === undefined ? undefined : fixtureFiles.get(name);
        if (fixture === undefined) {
          next();
          return;
        }
        const requestPath = resolve(fixture);
        if (relative(repositoryRoot, requestPath).startsWith('..')) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        response.setHeader('Content-Type', 'application/pdf');
        response.end(readFileSync(requestPath));
      });
      server.middlewares.use('/pdfjs', (request, response, next) => {
        const requestName = request.url?.replace(/^\//u, '');
        if (requestName === undefined || requestName.includes('..')) {
          next();
          return;
        }
        const asset = resolve(repositoryRoot, 'node_modules', 'pdfjs-dist', requestName);
        if (relative(resolve(repositoryRoot, 'node_modules', 'pdfjs-dist'), asset).startsWith('..')) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        if (!existsSync(asset)) {
          next();
          return;
        }
        response.end(readFileSync(asset));
      });
    },
  };
}
