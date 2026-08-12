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

## Renderer

- LaTeX、Typst、Quarkdownの表として出力する。列alignmentとheaderの選択を出力へ反映する。
- LaTeXでは特殊文字をescapeする。TypstとQuarkdownでも表構文を壊す入力文字をデータとして扱い、生成コードの構造を維持する。
- headerを無効にした場合も、対象形式が要求する最小構造を満たす出力を生成する。

## Insert

- 開いた時点のactive editorを `target` として保持する。
- `insert` 受信時にそのdocumentへ `editor.edit()` でカーソル位置にコードを挿入する。
- 対象editorが閉じられた、編集できない場合、開いた時点にeditorが存在しなかった場合は明示的なエラー通知を出し、別documentへfallbackしない。
- 挿入形式の判定は既存 `InsertionFormat`（`insertion_format.ts`）を再利用する。新規に形式判定を実装しない。

## 対象外

`.xlsx` 読み書き、Excel formula、multiple sheets、Spreadsheet計算、sort、filter、chart、conditional formatting、cell styling完全再現、merged cell / rowspan / colspan / `\multirow` / 複雑な`\multicolumn`、LaTeX table parser、既存LaTeX tableのround-trip編集、CSV Custom Editor / Editor Association、documentへの直接CSV Drop / Table Paste、XLSX系dependency、大型Spreadsheet UI library。
