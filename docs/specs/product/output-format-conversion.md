# 出力形式基準の変換コマンド仕様

## 目的

変換commandは入力形式と出力形式の組み合わせではなく、出力形式を基準に公開する。同じ出力形式へ変換できる複数の入力形式を、1回の操作で選択できる。

## 公開command

| Command ID                         | 表示名 | 出力形式 |
| ---------------------------------- | ------ | -------- |
| `graphics-workbench.convertToPdf`  | PDF    | PDF      |
| `graphics-workbench.convertToPng`  | PNG    | PNG      |
| `graphics-workbench.convertToJpeg` | JPEG   | JPEG     |
| `graphics-workbench.convertToWebp` | WebP   | WebP     |
| `graphics-workbench.convertToAvif` | AVIF   | AVIF     |
| `graphics-workbench.convertToGif`  | GIF    | GIF      |
| `graphics-workbench.convertToTiff` | TIFF   | TIFF     |
| `graphics-workbench.convertToSvg`  | SVG    | SVG      |

Command PaletteとExplorerの`変換`サブメニューでは、出力形式基準commandを表示する。

## 入力と処理単位

対応形式は、editable Draw.io画像、PNG、JPEG、WebP、AVIF、GIF、TIFF、SVG、PDF、Mermaidの組み合わせとする。通常のラスター形式変換ではGIF/TIFFの先頭page/frameを扱う。`graphics-workbench.convertToPdf` はGIF/TIFFの全page/frameを1つのPDFの各ページへ展開する。EPSは公開変換commandの入力形式として扱わない。ネイティブDraw.io（`.drawio`、`.dio`）は専用のPDF commandで扱う。対応していない入力、出力と同じ形式の入力、混在選択に含まれる非対応入力がある場合は、変換全体を開始しない。

1回のcommand実行を1つの変換batchとして扱う。

- 入力ごとに出力を作成する。
- すべて成功するまで指定出力先へ反映しない。
- 1件でも失敗した場合は指定出力先へ反映しない。
- Safe Modeの判断はbatch全体で1回だけ行う。
- Undoはbatch全体を直前の1回分として扱う。
- キャンセル時は指定出力先へ反映しない。

複数画像をPDFへ変換する場合も、画像ごとに別のPDFを作成する。画像を1つのPDFへ結合する機能は別commandとして扱う。

## PDFと画像の出力

PDFを画像またはSVGへ変換する場合はページごとに出力を作成し、複数ページでは`${page}`を利用できる。出力先が同じbatch内で重複する場合は反映前に全体停止する。

画像からPDFへ変換する場合は1ページPDFとし、画像のpixel幅・高さをpoint単位のページサイズとして扱う。PDFから画像へ変換する場合はDPIに基づいてpixel数を決める。画像から画像への変換では原則としてpixel幅・高さを維持する。

editable Draw.io画像から画像へ変換する場合は、数式を保持するためPDFを経由する。中間結果は利用者向けの出力名へ現れない。

GIF、TIFFは入力と出力の両方に対応する。通常の画像形式変換では先頭page/frameを扱い、GIF/WebPのanimation preserve commandとsplit commandは全frameを扱う。Convert to PDFのGIF/TIFF入力は、複数page/frameを全ページPDFへ展開する。ページ寸法が異なるTIFFも各pageを個別に読み出す。

## 設定と入力名

出力形式基準のoutputPath設定を明示した場合はそれを使い、空、空白のみ、または未設定の場合は既存の形式別設定へfallbackする。既存設定はこの仕様で削除しない。legacy設定の廃止時期は、利用実態を確認したうえで次のmajor version前に決める。

テンプレート変数は利用者が選択した論理入力を基準に展開する。editable Draw.io画像はDraw.io入力として扱い、`.drawio`などの接尾辞を除いた論理入力名を使用する。

## Mermaid

Mermaid（`.mmd`、`.mermaid`）は出力形式基準commandの入力として扱う。PDF、SVG、PNGなどの出力形式への対応と出力pathは、対応する形式の設定に従う。

Mermaidは外部の`mmdc` CLIをプロセスとして実行する。`graphics-workbench.execPath.mermaid`で実行ファイルを指定し、未指定時は`mmdc`をPATHから探す。Chrome/Chromiumは`graphics-workbench.execPath.chrome`で指定でき、未設定時はOS標準の実行ファイルを使う。Mermaid CLIは拡張機能へ同梱せず、利用者が別途インストールする。

SVGからPDFへの`chrome` backendは、同じChrome実行ファイルを`--headless --no-pdf-header-footer --print-to-pdf=...`で直接実行する。`rsvg-convert` backendは既存どおり`graphics-workbench.execPath.rsvgConvert`を使う。

## Native Draw.io PDF

ネイティブDraw.io（`.drawio`、`.dio`）は、出力形式基準commandとは別に次のPDF commandを提供する。

- `graphics-workbench.convertDrawioToPdf`: Draw.ioの各ページをページ名ごとの単一ページPDFへ分割する。
- `graphics-workbench.convertDrawioToPdfDirectly`: Draw.ioの全ページを1つのPDFへ出力する。

分割commandは`outputPath.convertDrawioToPdf`の`${page}`へDraw.ioのページ名を設定する。Windowsで使用できない文字や端の空白は出力ファイル名用に正規化する。直接commandは`outputPath.convertDrawioToPdfDirectly`を使う。いずれもDraw.io Desktop CLIを使い、出力は通常のstaging、Safe Mode、Undo、cancellationの対象とする。

## 移行

v1では入力形式・出力形式ペア別の旧command IDを公開UIへ残さない。旧command IDからの移行は[v1 migration note](v1-migration-from-v051.md)に従う。
