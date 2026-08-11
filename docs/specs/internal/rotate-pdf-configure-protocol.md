# PDF回転 Configure protocol contract

## 対象

- `vscode/src/shared/protocols/rotate_pdf_protocol.ts`
- `vscode/src/commands/pdf/rotate_pdf_configure.ts`（`graphics-workbench.rotatePdf.configure`）
- `vscode/webview/apps/rotate_pdf/`

## Host → Webview

`RotatePdfHostToWebview`:

- `{ type: 'init', payload: { sourceId, fileName, pageCount, pdfSrc, resources, preview, labels } }`
  - `pdfSrc`はwebview URI。`resources`はPDF.js worker / cMap / font / wasmのURL（省略可）
  - `preview`は`PdfPreviewSettings`（`maxCanvasPixels` / `maxDevicePixelRatio`）
  - `labels`は`RotatePdfLabels`（全フィールドが`hasExactKeys`で検証される）
- `{ type: 'error', payload: { message } }`

## Webview → Host

`RotatePdfWebviewToHost`:

- `{ type: 'ready' }`
- `{ type: 'apply', payload: { angle, pageIndices } }`
  - `angle`は90 / 180 / 270のいずれか
  - `pageIndices`は1始まりの回転対象ページ。空は不可
- `{ type: 'cancel' }`
- `{ type: 'previewLoadFailed', payload: { message } }`

Hostは`isRotatePdfWebviewToHostMessage`で受信メッセージを検証し、`apply`の`pageIndices`を0始まりへ変換して`rotatePdfFiles`へ渡す。

## 関連

- [PDF回転 Configure product spec](../product/rotate-pdf-configure.md)
- [PDF回転 internal contract](rotate-pdf.md)
