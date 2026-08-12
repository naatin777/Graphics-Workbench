# 出力形式基準の変換コマンド仕様

## 目的

変換commandは入力形式と出力形式の組み合わせではなく、出力形式を基準に公開する。同じ出力形式へ変換できる複数の入力形式を、1回の操作で選択できる。

## 公開command

Command PaletteとExplorerの`変換`サブメニューでは、出力形式基準の変換commandを表示する。公開IDと登録条件はmanifest、command binding、generated metadataを正本とし、このspecでは一覧を重複管理しない。

## 入力と処理単位

対応形式は、editable Draw.io画像、PNG、JPEG、WebP、AVIF、GIF、TIFF、SVG、PDFの組み合わせとする。通常のラスター形式変換ではGIF/TIFFの先頭page/frameを扱う。`graphics-workbench.convertToPdf` はGIF/TIFFの全page/frameを1つのPDFの各ページへ展開する。EPSは公開変換commandの入力形式として扱わない。ネイティブDraw.io（`.drawio`、`.dio`）は専用のPDF commandで扱う。対応していない入力、出力と同じ形式の入力、混在選択に含まれる非対応入力がある場合は、変換全体を開始しない。

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

GIF、TIFFは入力と出力の両方に対応する。通常の画像形式変換では先頭page/frameを扱い、通常のWebP/GIF commandはanimationを1つの出力へ保持し、Split commandは全frameを個別出力する。Convert to PDFのGIF/TIFF入力は、複数page/frameを全ページPDFへ展開する。ページ寸法が異なるTIFFも各pageを個別に読み出す。

## 設定と入力名

変換の出力先は入力形式ではなく、ユーザーから見た出力・操作の種類で決める。`single`は1回の変換結果を1つの出力ファイルとして生成する操作、`split`は1つの論理的な入力・document・animationを複数の独立ファイルへ展開する操作、`combine`は複数の独立したユーザーファイルを1つへ結合すること自体を目的とする操作を表す。それぞれ`outputPath.single.<形式>`、`outputPath.split.<形式>`、`outputPath.combine.<形式>`を正本とする。

- `outputPath.single.<形式>`は、対応する1ファイル出力形式のmanifest settingを使う。
- `outputPath.split.<形式>`は、対応する複数ファイル出力形式のmanifest settingを使い、`${page}`を必須とする。
- `outputPath.combine.pdf`はQuick Combine専用で、`${random}`を必須とする。
- 素材からeditable Draw.ioを作成するcomposeは、最終artifactが1ファイルのため`outputPath.single.drawio`／`outputPath.single.drawioPng`／`outputPath.single.drawioSvg`を使う。
- 複数画像を1つへ結合する画像のPDF結合operationのSave As版は出力path設定を持たず、Save Asダイアログで出力先を選択する。
- PDF編集operation固有の設定（`cropPdf`、`rotatePdf`、`reorderPdf`、`compressPdf`、`encryptPdf`、`decryptPdf`）は維持する。

`split`のテンプレートは`${page}`を必須とし、PDFページ・アニメーションフレーム・Draw.ioページを同じ`split.<形式>`で扱う。

`outputPath`設定は未設定ならmanifest既定値を使い、空文字や空白だけ・型不一致はinvalid configurationとして扱う（既定値への黙示fallbackはしない）。

テンプレート変数は利用者が選択した論理入力を基準に展開する。editable Draw.io画像はDraw.io入力として扱い、`.drawio`などの接尾辞を除いた論理入力名を使用する。

## Context MenuとGW Controls

変換commandのContext Menu表示制御は入力format単位ではなく、ユーザー向けの出力・操作分類 `single`／`split`／`combine` 単位で行う。

- `graphics-workbench.conversion.single.enabled`: 最終artifactを1ファイルへ生成する変換commandを表示する
- `graphics-workbench.conversion.split.enabled`: 1つの論理入力を複数ファイルへ展開する変換commandを表示する
- `graphics-workbench.conversion.combine.enabled`: 複数ファイルを1つへ結合することが目的の変換command（Save As / Quickの両方）を表示する

各commandのwhen句は入力formatの判定（対応commandの表示に必要なformat正規表現）を維持するが、`format判定 × format別enabled設定`の組み合わせは持たない。

PDF編集operation（Crop / Rotate / Reorder / Split / Compress / Encrypt / Decrypt）は変換ではなく、`contextMenu.*.enabled`の既存operation設定で制御し、conversion toggleの影響を受けない。

GW Controls（status barのスライダーアイコン）のQuickPickには`Conversions`セクションがあり、`Single`／`Split`／`Combine`をON/OFFできる。選択すると対応する`conversion.*.enabled`設定を直接更新し、表示へ即時反映する。

SVGからPDFへの`chrome` backendは、同じChrome実行ファイルを`--headless --no-pdf-header-footer --print-to-pdf=...`で直接実行する。`rsvg-convert` backendは既存どおり`graphics-workbench.execPath.rsvgConvert`を使う。

## Native Draw.io PDF

ネイティブDraw.io（`.drawio`、`.dio`）は、出力形式基準commandとは別に次のPDF commandを提供する。

- `graphics-workbench.convertDrawioToPagePdfs`: Draw.ioの各ページをページ名ごとの単一ページPDFへ分割する。
- `graphics-workbench.convertDrawioToSinglePdf`: Draw.ioの全ページを1つのPDFへ出力する。

分割commandは`outputPath.split.pdf`の`${page}`へDraw.ioのページ名を設定する。Windowsで使用できない文字や端の空白は出力ファイル名用に正規化する。単一PDF commandは`outputPath.single.pdf`を使う。いずれもDraw.io Desktop CLIを使い、出力は通常のstaging、Safe Mode、Undo、cancellationの対象とする。
