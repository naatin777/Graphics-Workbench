import * as vscode from 'vscode';
import type { PdfJsResources } from '../../shared/protocols/pdf_preview_protocol.js';

export function getPdfJsAssetsRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'pdfjs');
}

export function getWebviewSharedAssetsRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'shared');
}

export function createPdfJsResources(webview: vscode.Webview, assetsRoot: vscode.Uri): PdfJsResources {
  const directoryUri = (name: string): string =>
    `${webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, name)).toString()}/`;

  return {
    workerSrc: webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'pdf.worker.mjs')).toString(),
    cMapUrl: directoryUri('cmaps'),
    standardFontDataUrl: directoryUri('standard_fonts'),
    wasmUrl: directoryUri('wasm'),
  };
}
