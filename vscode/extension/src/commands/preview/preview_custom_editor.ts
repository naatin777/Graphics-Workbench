import path from 'node:path';

import * as vscode from 'vscode';

import { readPdfPreviewSettings } from '../../config/pdf_preview.js';
import { customEditorContributions } from '../../generated/extension_manifest.js';
import { localeMap } from '../../locale_map.js';
import { inspectPdfSummary } from '@graphics-workbench/core/pdf';
import { readTiffPreviewPageCount, renderTiffPreviewPage } from '../../adapters/preview/tiff_preview.js';
import { getWebviewHtml } from '../../presentation/webview/get_webview_html.js';
import { getPdfJsAssetsRoot, getWebviewSharedAssetsRoot } from '../../presentation/webview/pdfjs_assets.js';
import { createExtensionChannel, createWebviewTransport } from '../../presentation/webview/typed_channel.js';
import type { PdfPreviewSettings } from '@graphics-workbench/vscode-protocol/pdf-preview-protocol';
import {
  previewProtocol,
  type PreviewFormat,
  type PreviewHostToWebview,
  type PreviewLabels,
} from '@graphics-workbench/vscode-protocol/preview-protocol';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { assertLocalFileUri, toWebviewDirectoryUri } from '../shared/command_input.js';

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

    const configuration = this.dependencies.getConfiguration();
    const previewSettings = readPdfPreviewSettings(configuration);
    const maxInputPixels = configuration.raster.maxInputPixels();
    const pdfJsAssetsRoot = getPdfJsAssetsRoot(this.extensionUri);

    // Custom editor webviews are sandboxed without script execution unless
    // enableScripts is set explicitly (the register options do not expose it).
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media', 'webview'),
        getPdfJsAssetsRoot(this.extensionUri),
        getWebviewSharedAssetsRoot(this.extensionUri),
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
      ],
    };

    webviewPanel.webview.html = getWebviewHtml({
      webview: webviewPanel.webview,
      extensionUri: this.extensionUri,
      title: previewTitle(this.format, document.uri),
      pageId: 'preview',
      locale: vscode.env.language,
    });
    const channel = createExtensionChannel(previewProtocol, createWebviewTransport(webviewPanel.webview));

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
        channel.send.renderPageResult({ page, dataUri: rendered.dataUri });
      } catch (error) {
        if (initController.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.dependencies.outputChannel.appendLine(`[tiff-preview] render page failure: ${page}: ${message}`);
        channel.send.error({ message });
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

    const unsubscribeMessages = channel.on({
      ready: () => {
        void (async (): Promise<void> => {
          try {
            const prepared = await preparePreview(this.format, document.uri, maxInputPixels, initController.signal);
            const initPayload = buildInitMessage({
              format: this.format,
              uri: document.uri,
              pageCount: prepared.pageCount,
              preview: previewSettings,
              webview: webviewPanel.webview,
              pdfJsAssetsRoot,
            });
            channel.send.init(initPayload);
          } catch (error) {
            if (initController.signal.aborted) {
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.dependencies.outputChannel.appendLine(`[${this.format}-preview] init failure: ${message}`);
            channel.send.error({ message });
          }
        })();
      },
      renderPage: ({ page }) => {
        if (this.format !== 'tiff') {
          return;
        }
        tiffRenderQueue.push(page);
        void processTiffRenderQueue();
      },
      previewLoadFailed: ({ message }) => {
        this.dependencies.outputChannel.appendLine(`[${this.format}-preview] preview failure: ${message}`);
        void vscode.window.showErrorMessage(message);
      },
      cancel: () => {
        webviewPanel.dispose();
      },
    });
    webviewPanel.onDidDispose(() => {
      initController.abort();
      tiffRenderQueue.length = 0;
      unsubscribeMessages();
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
): Promise<{ pageCount: number }> {
  if (format === 'tiff') {
    return { pageCount: await readTiffPreviewPageCount(uri.fsPath, maxInputPixels, signal) };
  }

  const summary = await inspectPdfSummary(uri.fsPath, signal);
  return { pageCount: summary.pageCount };
}

function buildInitMessage(options: {
  format: PreviewFormat;
  uri: vscode.Uri;
  pageCount: number;
  preview: PdfPreviewSettings;
  webview: vscode.Webview;
  pdfJsAssetsRoot: vscode.Uri;
}): Extract<PreviewHostToWebview, { type: 'init' }>['payload'] {
  const { format, uri, pageCount, preview, webview, pdfJsAssetsRoot } = options;
  const shared = {
    fileName: path.basename(uri.fsPath),
    pageCount,
    preview,
    labels: previewLabels(),
  };
  if (format === 'pdf') {
    return {
      format: 'pdf',
      ...shared,
      pdfSrc: webview.asWebviewUri(uri).toString(),
      resources: {
        workerSrc: webview.asWebviewUri(vscode.Uri.joinPath(pdfJsAssetsRoot, 'pdf.worker.mjs')).toString(),
        cMapUrl: toWebviewDirectoryUri(webview, pdfJsAssetsRoot, 'cmaps'),
        standardFontDataUrl: toWebviewDirectoryUri(webview, pdfJsAssetsRoot, 'standard_fonts'),
        wasmUrl: toWebviewDirectoryUri(webview, pdfJsAssetsRoot, 'wasm'),
      },
    };
  }
  return {
    format: 'tiff',
    ...shared,
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
