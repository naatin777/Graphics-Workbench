import assert from 'node:assert/strict';

import * as vscode from 'vscode';

import { getWebviewHtml } from '../../vscode/src/presentation/webview/get_webview_html.js';

suite('Webview HTML生成', () => {
  test('getWebviewHtmlが生成するHTMLに、PDF.jsがPDF・フォント・画像・workerを読み込めるCSP（connect/font/img/worker-srcにvscode-resource・data・blob）とnonce付きscript-src・unsafe-inline付きstyle-src・lang="en-US"を含める', () => {
    const webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'> = {
      cspSource: 'vscode-resource:',
      asWebviewUri(uri: vscode.Uri): vscode.Uri {
        return uri;
      },
    };

    const html = getWebviewHtml({
      webview,
      extensionUri: vscode.Uri.file('/extension'),
      title: 'Crop PDF',
      appName: 'crop_pdf',
      locale: 'en-US',
    });

    assert.match(html, /connect-src vscode-resource: data: blob:/);
    assert.match(html, /font-src vscode-resource: data: blob:/);
    assert.match(html, /img-src vscode-resource: data: blob:/);
    assert.match(html, /<html lang="en-US">/);
    assert.match(html, /script-src 'nonce-[^']+';/);
    assert.doesNotMatch(html, /script-src 'nonce-[^']+' vscode-resource:/);
    assert.match(html, /style-src vscode-resource: 'unsafe-inline'/);
    assert.match(html, /worker-src vscode-resource: blob:/);
  });
});
