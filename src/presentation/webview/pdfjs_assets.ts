import * as vscode from 'vscode';

export function getPdfJsAssetsRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'pdfjs');
}

export function getWebviewSharedAssetsRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'media', 'webview', 'shared');
}
