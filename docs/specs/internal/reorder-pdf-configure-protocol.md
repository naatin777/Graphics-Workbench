# PDF並び替え Configure protocol contract

## 対象

- `src/application/protocols/reorder_pdf_protocol.ts`
- `src/commands/pdf/reorder_pdf_configure.ts`（`graphics-workbench.reorderPdf.configure`）
- `webview/apps/reorder_pdf/`

## Host → Webview

`ReorderPdfHostToWebview`:

- `{ type: 'init', payload: { sourceId, fileName, pageCount, pdfSrc, resources, preview, labels } }`
  - `pdfSrc`はwebview URI。`resources`はPDF.js worker / cMap / font / wasmのURL（省略可）
  - `preview`は`PdfPreviewSettings`
  - `labels`は`ReorderPdfLabels`（`hasExactKeys`で検証）
- `{ type: 'error', payload: { message } }`

## Webview → Host

`ReorderPdfWebviewToHost`:

- `{ type: 'ready' }`
- `{ type: 'apply', payload: { order } }`
  - `order`は1始まりのページ番号の出力順。空は不可。並び替えは全ページを保持するため`1..pageCount`の順列
- `{ type: 'cancel' }`
- `{ type: 'previewLoadFailed', payload: { message } }`

Hostは`isReorderPdfWebviewToHostMessage`で検証し、`order`を`reorderPdfFiles`の`pageOrder`へ渡す。`pageOrder`が`1..pageCount`の順列でない場合は操作側で全体停止する。

## 関連

- [PDF並び替え Configure product spec](../product/reorder-pdf-configure.md)
- [Undo internal contract](undo-last-conversion.md)
