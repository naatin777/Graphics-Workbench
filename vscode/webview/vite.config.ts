import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin, type UserConfig } from 'vite';
import solid from 'vite-plugin-solid';

const webviewRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(webviewRoot, '..');
const repositoryRoot = resolve(projectRoot, '..');

export interface WebviewBuildConfig {
  appName: string;
  entryHtml?: string;
  copyPdfWorker?: boolean;
}

export function defineWebviewConfig(config: WebviewBuildConfig): UserConfig {
  const appRoot = resolve(webviewRoot, 'apps', config.appName);
  const outDir = resolve(projectRoot, 'media', 'webview', config.appName);
  const pdfJsAssetsRoot = resolve(projectRoot, 'media', 'webview', 'pdfjs');
  const sharedWebviewAssetsRoot = resolve(projectRoot, 'media', 'webview', 'shared');
  const plugins = [
    solid(),
    copyCodiconAssetPlugin(outDir, sharedWebviewAssetsRoot),
    ...(config.copyPdfWorker === false ? [] : [copyPdfJsAssetsPlugin(pdfJsAssetsRoot)]),
  ];

  return defineConfig({
    root: appRoot,
    base: '',
    plugins,

    resolve: {
      alias: {
        '@webview-shared': resolve(webviewRoot, 'shared'),
        '@graphics-workbench-crop-pdf-protocol': resolve(
          projectRoot,
          'src',
          'shared',
          'protocols',
          'crop_pdf_protocol.ts',
        ),
        '@graphics-workbench-merge-pdf-protocol': resolve(
          projectRoot,
          'src',
          'shared',
          'protocols',
          'merge_pdf_protocol.ts',
        ),
        '@graphics-workbench-split-pdf-protocol': resolve(
          projectRoot,
          'src',
          'shared',
          'protocols',
          'split_pdf_protocol.ts',
        ),
        '@graphics-workbench-rotate-pdf-protocol': resolve(
          projectRoot,
          'src',
          'shared',
          'protocols',
          'rotate_pdf_protocol.ts',
        ),
        '@graphics-workbench-reorder-pdf-protocol': resolve(
          projectRoot,
          'src',
          'shared',
          'protocols',
          'reorder_pdf_protocol.ts',
        ),
        '@graphics-workbench-preview-protocol': resolve(
          projectRoot,
          'src',
          'shared',
          'protocols',
          'preview_protocol.ts',
        ),
        '@graphics-workbench-table-editor-protocol': resolve(
          projectRoot,
          'src',
          'shared',
          'protocols',
          'table_editor_protocol.ts',
        ),
        '@graphics-workbench-table-model': resolve(projectRoot, 'src', 'table', 'table_model.ts'),
        '@graphics-workbench-table-parser': resolve(projectRoot, 'src', 'table', 'parse_delimited.ts'),
        '@graphics-workbench-table-renderer': resolve(projectRoot, 'src', 'table', 'table_renderer.ts'),
      },
    },

    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: true,
      target: 'es2022',
      cssCodeSplit: false,

      rolldownOptions: {
        input: resolve(appRoot, config.entryHtml ?? 'index.html'),
        output: {
          entryFileNames: 'index.js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            if (isCssAsset(assetInfo.names, assetInfo.originalFileNames)) {
              return 'index.css';
            }

            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },

    define: {
      __WEBVIEW_APP_NAME__: JSON.stringify(config.appName),
    },
  });
}

function isCssAsset(names: readonly string[], originalFileNames: readonly string[]): boolean {
  return [...names, ...originalFileNames].some((fileName) => fileName.endsWith('.css'));
}

function copyCodiconAssetPlugin(outDir: string, sharedAssetsRoot: string): Plugin {
  return {
    name: 'share-codicon-asset',
    apply: 'build',
    closeBundle() {
      const cssPath = resolve(outDir, 'index.css');
      const css = readFileSync(cssPath, 'utf8');
      const assetName = css.match(/assets\/(codicon-[^)"']+\.ttf)/u)?.[1];

      if (assetName === undefined) {
        throw new Error(`Codicon font asset not found in ${cssPath}`);
      }

      const appFontPath = resolve(outDir, 'assets', assetName);
      const sharedFontPath = resolve(sharedAssetsRoot, 'codicon.ttf');
      mkdirSync(sharedAssetsRoot, { recursive: true });
      copyFileSync(appFontPath, sharedFontPath);
      writeFileSync(cssPath, css.replaceAll(`assets/${assetName}`, '../shared/codicon.ttf'));
      rmSync(appFontPath);
    },
  };
}

function copyPdfJsAssetsPlugin(assetsRoot: string): Plugin {
  return {
    name: 'copy-pdfjs-assets',
    apply: 'build',
    closeBundle() {
      const workerSource = resolve(repositoryRoot, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');

      const workerTarget = resolve(assetsRoot, 'pdf.worker.mjs');

      if (!existsSync(workerSource)) {
        throw new Error(`PDF.js worker not found: ${workerSource}. Did you install pdfjs-dist?`);
      }

      mkdirSync(dirname(workerTarget), { recursive: true });
      copyFileSync(workerSource, workerTarget);

      for (const directoryName of ['cmaps', 'standard_fonts', 'wasm']) {
        const source = resolve(repositoryRoot, 'node_modules', 'pdfjs-dist', directoryName);
        const target = resolve(assetsRoot, directoryName);

        if (!existsSync(source)) {
          throw new Error(`PDF.js asset directory not found: ${source}`);
        }

        cpSync(source, target, { recursive: true });
      }
    },
  };
}
