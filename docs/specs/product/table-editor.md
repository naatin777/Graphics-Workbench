# Table Editor仕様

## 適用範囲

`graphics-workbench.openTableEditor`（表エディター）の入力・編集・出力境界を定義する。WebviewでExcel / Google Sheets等からコピーした表や `.csv` / `.tsv` ファイルを読み込み、セルを編集してLaTeX / Typst / Quarkdownの表コードを文書へ挿入する。

本仕様はSpreadsheet Editorではない。`.xlsx` 読み書き、数式、複数シート、セル結合、ソート、フィルタ、チャート等は対象外である。

## 入力

### Clipboard Paste

- Webview上の `Cmd/Ctrl+V` で `text/plain` を読み取る。
- **table candidate判定**: `text/plain` にtabが1つ以上含まれる場合のみTSVとして取り込み、`event.preventDefault()` する。tabを含まない文章は表として認識せず、既定のpaste動作に任せる。
- Excel / Google Sheets由来のclipboard TSVを想定し、CRLF / LF、空セル、末尾の空セルに対応する。
- `text/html` の `<table>` は今回の対象外である。

### Drag & Drop

- Webviewへのdropで最初のファイルを読み取る。
- `.csv`（大文字小文字を区別しない）はCSV parserで、`.tsv` はTSV parserでparseする。
- それ以外のファイルは明示的にunsupportedとして `role="alert"` で通知する。silent fallbackはしない。
- 空ファイルは明示的なメッセージを表示する。

## TableModel

Clipboard / CSV / TSV / DOMは直接相互変換しない。小さい中間モデルへ集約し、Webview表示と各rendererはこのモデルだけを参照する。

```ts
type TableAlignment = 'left' | 'center' | 'right';

interface TableCell {
  text: string;
}
interface TableRow {
  cells: TableCell[];
}
interface TableColumn {
  alignment: TableAlignment;
}
interface TableModel {
  rows: TableRow[];
  columns: TableColumn[];
  headerRows: number;
}
```

- `headerRows` は0（先頭行をheaderにしない）または1（する）で、Webviewのトグルで切り替える。
- parse時は行の最大列数へ空セルで補完する。
- 編集操作（セル更新・行/列の追加削除・alignment・headerRows）は純粋関数として `src/table/table_model.ts` に置き、Webviewは不変更新で使う。

## Webview構成

- host↔webview境界は `src/shared/protocols/table_editor_protocol.ts` のValibot schemaで検証する。
- Extension → Webview: `init`（初期出力形式とlabels）。`error`。
- Webview → Extension: `ready` / `cancel` / `insert`（`{ format, code }`）。
- セル編集のたびにhostへmessageを送らない。編集・Preview生成はWebview内で完結し、hostは `insert` だけを受け取る。
- 初期出力形式は、開いた時点のactive editorのdocument languageを既存 `insertionDocumentSelectors` の逆引きで決める。判定できない場合はLaTeXを既定にする。

## リアルタイム更新

- セル編集 → TableModel更新 → renderer（純粋関数）→ Preview更新。
- VS Code document本体は `insert` まで変更しない。

## Renderer

rendererは `src/table/table_renderer.ts` の純粋関数として分離する。

- `renderLatexTable(model, { booktabs })`: `tabular` + `l/c/r`。booktabs有効時は `\toprule` / `\midrule` / `\bottomrule`、無効時は `\hline`。既存 `escapeLatex` を再利用して特殊文字をescapeする。
- `renderTypstTable(model)`: `#table(columns: (auto, ...), align: (...), table.header(...))`。headerは `[*text*]` で強調する。
- `renderQuarkdownTable(model)`: GFM pipe table。delimiter行の `:---` / `:---:` / `---:` でalignmentを表す。GFMはheader行を必須とするため、header無効時は空のheader行を出力する。

## Insert

- 開いた時点のactive editorを `target` として保持する。
- `insert` 受信時にそのdocumentへ `editor.edit()` でカーソル位置にコードを挿入する。
- 対象editorが閉じられた、編集できない場合、開いた時点にeditorが存在しなかった場合は明示的なエラー通知を出し、別documentへfallbackしない。
- 挿入形式の判定は既存 `InsertionFormat`（`insertion_format.ts`）を再利用する。新規に形式判定を実装しない。

## テスト境界

- CSV / TSV parser・TableModel・rendererはMochaの純粋Unit Test。
- host↔webviewのprotocol・command・insertはExtension HostのIntegration Test（`test/commands/open_table_editor_command.test.ts`）。
- Webviewの表示・paste・drop・編集・Preview・InsertはVitest（`webview/apps/table_editor/src/app.test.tsx`）。

## 対象外

`.xlsx` 読み書き、Excel formula、multiple sheets、Spreadsheet計算、sort、filter、chart、conditional formatting、cell styling完全再現、merged cell / rowspan / colspan / `\multirow` / 複雑な`\multicolumn`、LaTeX table parser、既存LaTeX tableのround-trip編集、CSV Custom Editor / Editor Association、documentへの直接CSV Drop / Table Paste、XLSX系dependency、大型Spreadsheet UI library。
