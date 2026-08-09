import path from 'node:path';

import * as vscode from 'vscode';

import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { getMaxInputPixels } from '../../config/raster.js';
import { customEditorContributions } from '../../generated/extension_manifest.js';
import { localeMap } from '../../locale_map.js';
import { countPdfPages } from '../../operations/pdf/mupdf.js';
import { readTiffPreviewPageCount, renderTiffPreviewPage } from '../../operations/preview/tiff_preview.js';
import { getWebviewHtml } from '../../presentation/webview/get_webview_html.js';
import { getPdfJsAssetsRoot, getWebviewSharedAssetsRoot } from '../../presentation/webview/pdfjs_assets.js';
import type { PdfPreviewSettings } from '../../shared/protocols/pdf_preview_protocol.js';
import {
  type PreviewFormat,
  type PreviewHostToWebview,
  type PreviewLabels,
  isPreviewWebviewToHostMessage,
} from '../../shared/protocols/preview_protocol.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { assertLocalFileUri, toWebviewDirectoryUri } from '../shared/command_input.js';
import { configureCommandRuntime } from '../shared/command_runtime.js';

const pdfPreviewViewType = 'graphics-workbench.pdf.preview';
const tiffPreviewViewType = 'graphics-workbench.tiff.preview';

const previewFormats: Record<string, PreviewFormat> = {
  [pdfPreviewViewType]: 'pdf',
  [tiffPreviewViewType]: 'tiff',
};

/** Registers the read-only PDF and TIFF preview custom editors from the manifest. */
export function registerPreviewCustomEditors(
  context: vscode.ExtensionContext,
  dependencies: CommandDependencies,
): void {
  for (const viewType of Object.keys(customEditorContributions)) {
    const format = previewFormats[viewType];
    if (format === undefined) {
      continue;
    }
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(
        viewType,
        new PreviewCustomEditorProvider(format, context, dependencies),
      ),
    );
  }
}

class PreviewCustomEditorProvider implements vscode.CustomReadonlyEditorProvider {
  private readonly extensionUri: vscode.Uri;

  constructor(
    private readonly format: PreviewFormat,
    context: vscode.ExtensionContext,
    private readonly dependencies: CommandDependencies,
  ) {
    this.extensionUri = context.extensionUri;
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return createPreviewCustomDocument(uri);
  }

  async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    try {
      assertLocalFileUri(document.uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      webviewPanel.webview.html = renderPreviewErrorHtml(message);
      void vscode.window.showErrorMessage(message);
      return;
    }

    const configuration = configureCommandRuntime(this.dependencies);
    const previewSettings = readPdfPreviewSettings(configuration);
    const maxInputPixels = getMaxInputPixels(configuration);
    const pdfJsAssetsRoot = getPdfJsAssetsRoot(this.extensionUri);

    // Custom editor webviews are sandboxed without script execution unless
    // enableScripts is set explicitly (the register options do not expose it).
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media', 'webview', 'preview'),
        getPdfJsAssetsRoot(this.extensionUri),
        getWebviewSharedAssetsRoot(this.extensionUri),
      ],
    };

    webviewPanel.webview.html = getWebviewHtml({
      webview: webviewPanel.webview,
      extensionUri: this.extensionUri,
      title: previewTitle(this.format, document.uri),
      appName: 'preview',
      locale: vscode.env.language,
    });

    const initController = new AbortController();
    const tiffRenderQueue: number[] = [];
    let tiffRenderRunning = false;

    const renderTiffPage = async (page: number): Promise<void> => {
      try {
        const rendered = await renderTiffPreviewPage(
          document.uri.fsPath,
          page,
          maxInputPixels,
          previewSettings.maxCanvasPixels,
          initController.signal,
        );
        initController.signal.throwIfAborted();
        const pageResult = {
          type: 'renderPageResult',
          payload: { page, dataUri: rendered.dataUri },
        } satisfies PreviewHostToWebview;
        // VS Code Webview.postMessage has no targetOrigin parameter.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        void webviewPanel.webview.postMessage(pageResult);
      } catch (error) {
        if (initController.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.dependencies.outputChannel?.appendLine(`[tiff-preview] render page failure: ${page}: ${message}`);
        // VS Code Webview.postMessage has no targetOrigin parameter.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        void webviewPanel.webview.postMessage({ type: 'error', payload: { message } });
      }
    };

    const processTiffRenderQueue = async (): Promise<void> => {
      if (tiffRenderRunning) {
        return;
      }
      tiffRenderRunning = true;
      try {
        while (tiffRenderQueue.length > 0) {
          const page = tiffRenderQueue.shift();
          if (page === undefined) {
            continue;
          }
          await renderTiffPage(page);
        }
      } finally {
        tiffRenderRunning = false;
      }
    };

    webviewPanel.onDidDispose(() => {
      initController.abort();
      tiffRenderQueue.length = 0;
    });

    webviewPanel.webview.onDidReceiveMessage((rawMessage: unknown) => {
      if (!isPreviewWebviewToHostMessage(rawMessage)) {
        return;
      }

      if (rawMessage.type === 'ready') {
        void (async (): Promise<void> => {
          try {
            const prepared = await preparePreview(this.format, document.uri, maxInputPixels, initController.signal);
            const initMessage = buildInitMessage({
              format: this.format,
              uri: document.uri,
              pageCount: prepared.pageCount,
              pdfData: prepared.pdfData,
              preview: previewSettings,
              webview: webviewPanel.webview,
              pdfJsAssetsRoot,
            });
            // VS Code Webview.postMessage has no targetOrigin parameter.
            // oxlint-disable-next-line unicorn/require-post-message-target-origin
            void webviewPanel.webview.postMessage(initMessage);
          } catch (error) {
            if (initController.signal.aborted) {
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.dependencies.outputChannel?.appendLine(`[${this.format}-preview] init failure: ${message}`);
            // VS Code Webview.postMessage has no targetOrigin parameter.
            // oxlint-disable-next-line unicorn/require-post-message-target-origin
            void webviewPanel.webview.postMessage({ type: 'error', payload: { message } });
          }
        })();
        return;
      }

      if (rawMessage.type === 'renderPage') {
        if (this.format !== 'tiff') {
          return;
        }
        const { page } = rawMessage.payload;
        tiffRenderQueue.push(page);
        void processTiffRenderQueue();
        return;
      }

      if (rawMessage.type === 'previewLoadFailed') {
        this.dependencies.outputChannel?.appendLine(
          `[${this.format}-preview] preview failure: ${rawMessage.payload.message}`,
        );
        void vscode.window.showErrorMessage(rawMessage.payload.message);
        return;
      }

      // The only remaining validated message type is `cancel`.
      webviewPanel.dispose();
    });
  }
}

function createPreviewCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
  return {
    uri,
    dispose(): void {
      // Read-only preview keeps no per-document resources.
    },
  };
}

async function preparePreview(
  format: PreviewFormat,
  uri: vscode.Uri,
  maxInputPixels: number,
  signal: AbortSignal,
): Promise<{ pageCount: number; pdfData?: string }> {
  if (format === 'tiff') {
    return { pageCount: await readTiffPreviewPageCount(uri.fsPath, maxInputPixels, signal) };
  }

  signal.throwIfAborted();
  const bytes = await vscode.workspace.fs.readFile(uri);
  signal.throwIfAborted();
  const pageCount = await countPdfPages(bytes);
  signal.throwIfAborted();
  // Webview postMessage serializes typed arrays as plain objects; pdf.js accepts
  // base64-encoded PDF data instead.
  return { pageCount, pdfData: Buffer.from(bytes).toString('base64') };
}

function buildInitMessage(options: {
  format: PreviewFormat;
  uri: vscode.Uri;
  pageCount: number;
  pdfData: string | undefined;
  preview: PdfPreviewSettings;
  webview: vscode.Webview;
  pdfJsAssetsRoot: vscode.Uri;
}): PreviewHostToWebview {
  const { format, uri, pageCount, pdfData, preview, webview, pdfJsAssetsRoot } = options;
  return {
    type: 'init',
    payload: {
      format,
      fileName: path.basename(uri.fsPath),
      pageCount,
      ...(pdfData !== undefined && { pdfData }),
      resources:
        format === 'pdf'
          ? {
              workerSrc: webview.asWebviewUri(vscode.Uri.joinPath(pdfJsAssetsRoot, 'pdf.worker.mjs')).toString(),
              cMapUrl: toWebviewDirectoryUri(webview, pdfJsAssetsRoot, 'cmaps'),
              standardFontDataUrl: toWebviewDirectoryUri(webview, pdfJsAssetsRoot, 'standard_fonts'),
              wasmUrl: toWebviewDirectoryUri(webview, pdfJsAssetsRoot, 'wasm'),
            }
          : {},
      preview,
      labels: previewLabels(),
    },
  };
}

function previewLabels(): PreviewLabels {
  return {
    title: localeMap('webview.preview.title'),
    description: localeMap('webview.preview.description'),
    page: {
      label: localeMap('webview.preview.pageLabel'),
      pages: localeMap('webview.preview.pages'),
    },
    preview: {
      ariaLabel: localeMap('webview.preview.previewAriaLabel'),
      zoomLabel: localeMap('webview.preview.zoomLabel'),
      zoomOut: localeMap('webview.preview.zoomOut'),
      zoomIn: localeMap('webview.preview.zoomIn'),
      renderError: localeMap('webview.preview.renderError'),
    },
  };
}

function previewTitle(format: PreviewFormat, uri: vscode.Uri): string {
  return `${format === 'pdf' ? 'PDF' : 'TIFF'} ${path.basename(uri.fsPath)}`;
}

function renderPreviewErrorHtml(message: string): string {
  const escaped = escapeHtml(message);
  return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview</title>
  </head>
  <body style="color: var(--vscode-errorForeground); font-family: var(--vscode-font-family);">
    <p>${escaped}</p>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': {
        return '&amp;';
      }
      case '<': {
        return '&lt;';
      }
      case '>': {
        return '&gt;';
      }
      case '"': {
        return '&quot;';
      }
      case "'": {
        return '&#39;';
      }
      default: {
        return char;
      }
    }
  });
}
