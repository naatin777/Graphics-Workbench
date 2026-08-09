# v1.0.0 migration note: v0.5.1からの破壊的変更

## 目的

`v0.5.1`で公開されていたcommand IDとsettingsから、`v1.0.0`へ移行するときの破壊的変更を記録する。

`v1.0.0`では、旧command IDの互換aliasを実装しない。

理由:

- v1ではcontext menuをサブメニュー化し、操作単位を整理する
- 変換コマンドは入力形式・出力形式ペア別ではなく、出力形式基準へ統合する
- 旧command IDを残すと、同じ機能に複数の入口ができてテスト対象と説明対象が増える
- 破壊的変更はv1.0.0のmigration note / CHANGELOG / READMEで明示する

## command IDの移行

| v0.5.1 command ID                       | v1.0.0で使うcommand ID                       | 備考                                                                                                                          |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `graphics-workbench.cropPdf`            | `graphics-workbench.cropPdf.auto`            | quick系の自動crop。Webview GUIで細かく指定するcropは `graphics-workbench.cropPdf.configure` として別入口にする。              |
| `graphics-workbench.splitPdf`           | `graphics-workbench.splitPdf.allPages`       | quick系の全ページsplit。Webview GUIでページを選択するsplitは `graphics-workbench.splitPdf.configure` として別入口にする。     |
| `graphics-workbench.mergePdf`           | `graphics-workbench.mergePdf.selectedFiles`  | quick系の選択PDF結合。Webview GUIで順序やページを指定するmergeは `graphics-workbench.mergePdf.configure` として別入口にする。 |
| `graphics-workbench.convertDrawioToPdf` | `graphics-workbench.convertDrawioToPagePdfs` | native Draw.ioの各ページを個別PDFへ変換する。editable Draw.io画像は`convertToPdf`へ統合される。                               |
| `graphics-workbench.convertPdfToPng`    | `graphics-workbench.convertToPng`            | PDF入力をPNG出力形式コマンドへ統合する。                                                                                      |
| `graphics-workbench.convertPdfToJpeg`   | `graphics-workbench.convertToJpeg`           | PDF入力をJPEG出力形式コマンドへ統合する。                                                                                     |
| `graphics-workbench.convertPdfToSvg`    | `graphics-workbench.convertToSvg`            | PDF入力をSVG出力形式コマンドへ統合する。                                                                                      |
| `graphics-workbench.convertPngToPdf`    | `graphics-workbench.convertToPdf`            | PNG入力をPDF出力形式コマンドへ統合する。                                                                                      |
| `graphics-workbench.convertJpegToPdf`   | `graphics-workbench.convertToPdf`            | JPEG入力をPDF出力形式コマンドへ統合する。                                                                                     |
| `graphics-workbench.convertSvgToPdf`    | `graphics-workbench.convertToPdf`            | SVG入力をPDF出力形式コマンドへ統合する。                                                                                      |

## 旧command IDの互換alias

旧command IDの互換aliasは実装しない。

影響:

- ユーザーがVS Code keybindingsやtasksから旧command IDを直接呼んでいる場合は、新command IDへ変更する必要がある
- Explorer context menuから使う場合は、v1.0.0の新しいサブメニューを使う
- Command Paletteから使う場合は、新しい出力形式基準の表示名を検索する

## settingsの移行

### `graphics-workbench.execPath.pdfcrop`

`v1.0.0`では復元しない。

移行先:

- なし。v1の自動cropはMuPDFで実行し、外部crop executableの設定を持たない。

理由:

- 現行のcrop処理は`pdfcrop`やGhostscriptではなくMuPDF基準で実行する
- Windows path handlingなど外部crop tool固有の問題を避ける
- 依存する外部ツールを整理する

README / CHANGELOG / migration noteには、`execPath.pdfcrop`が廃止され、自動cropに外部tool設定がないことを書く。

### `graphics-workbench.execPath.puppeteer`

`v1.0.0`では復元しない。

移行先:

- SVG / Mermaid: `graphics-workbench.execPath.chrome`

理由:

- SVG変換とMermaid CLIでChrome実行ファイルのパスを共有する
- Chromeを使う変換だけを共有対象とし、Draw.ioなどの外部tool pathとは分ける
- Chrome実行はPuppeteer APIではなくCLI経由で行う

### `graphics-workbench.puppeteer.browser`

`v1.0.0`では復元しない。

移行先:

- SVG / Mermaid: `graphics-workbench.execPath.chrome`

理由:

- SVG→PDFはChromeをheadless CLIとして直接実行する
- Mermaidは外部のmmdc CLIを`execPath.mermaid`またはPATHから解決して使う
- Firefox backendは提供しない

### `graphics-workbench.puppeteer.channel`

`v1.0.0`では復元しない。

移行先:

- SVG / Mermaid: `graphics-workbench.execPath.chrome`

理由:

- SVG変換とMermaid CLIで同じChrome実行ファイル設定を共有する
- Mermaidの出力形式間でも同じChrome実行ファイルを使う
- browser channelの選択を公開しない

## READMEに書く内容

READMEでは、詳細な互換表をすべて載せすぎず、以下を短く書く。

- v1.0.0ではcommand IDが整理され、旧command IDは互換aliasとして残らない
- 変換コマンドは`PDFに変換` / `PNGに変換`のような出力形式基準になった
- keybindingsやtasksで旧command IDを使っている場合はmigration noteを参照する
- `execPath.pdfcrop`は廃止され、自動cropはMuPDFを使う
- Chrome実行ファイルは`execPath.chrome`へ移行した

SVGとMermaidの出力形式別legacy設定は使用しない。

## CHANGELOGに書く内容

CHANGELOGでは、`BREAKING CHANGE`として以下を明記する。

- 旧command IDの互換aliasを提供しない
- 変換コマンドを出力形式基準へ統合した
- PDF操作コマンドはサブメニュー化し、quick系は`cropPdf.auto` / `splitPdf.allPages` / `mergePdf.selectedFiles`、Webview GUI系は`cropPdf.configure` / `splitPdf.configure` / `mergePdf.configure`などの具体的なcommand IDへ移行した
- `execPath.pdfcrop`を廃止し、自動cropはMuPDFを使う
- Puppeteer設定を廃止し、Chrome実行ファイルを`execPath.chrome`へ集約した

## migration noteに書く内容

migration noteでは、このファイルの以下の表をユーザー向けに整えて掲載する。

- command ID移行表
- settings移行表
- 旧command ID aliasを実装しないこと
- keybindings / tasks / 外部automationで旧command IDを使っている場合の修正例

## 関連

- `docs/specs/product/output-format-conversion.md`
- `docs/tasks/0112-track-v051-public-feature-parity.md`
- `docs/tasks/0115-decide-v051-legacy-compatibility.md`
