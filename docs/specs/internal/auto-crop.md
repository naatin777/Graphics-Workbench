# PDF自動クロップの内部契約

`cropPdf.auto`の利用者向け挙動は、[product specification](../product/auto-crop.md)を正本とする。この文書は、入力境界、処理依存関係、staging、commit、取消の内部契約だけを記録する。

## Command boundary

command adapterは`uri`と`uris`を受け取り、`uris`に1件以上ある場合はそれを、ない場合は`uri`をcoreへ渡す。workspace境界の検証は変換処理を開始する前に行う。

## Processing boundary

- 各ページのcontent boundsはMuPDFの`findVisibleContentBounds`で検出する。ページを白背景へrenderし、純白（`#FFFFFF`）以外のvisible pixelのboundsを取得する。これはpdfcrop / Ghostscript bbox互換のsemanticsで、白い描画objectは「墨」として扱わない（全面の白rectangleがcontent扱いにならない）。
- content検出は`cropPdf.auto`、Draw.io PDFの余白除去（`renderPdfPageToPng(cropContent)`）、`hasPdfPageContent`で共通のdetectorを共有する。detectorは`DisplayList.getBounds()`を使わない（mediaboxを返すため使えない）。
- 検出用Pixmapは5000万pixelを超えないよう解像度を下げる。メモリ保護であり、入力制限やCrop禁止の判定ではない。
- Pixmap buffer長がDeviceRGB layout（3 bytes/pixel）と矛盾する場合はfallbackせずthrowする。
- 検出したpixel boundsはページのtransformの逆変換でPDF座標へ戻すため、offset MediaBoxとrotationを考慮する。これはraster samplingによるpdfcrop-compatibleな挙動であり、Ghostscriptのbboxとbit-perfectに一致することは保証しない。
- 元PDFはworkspace内のoperation stagingへコピーし、コピーをMuPDFで処理する。検出後にcommandから受け取ったmarginを加えてCropBoxを更新し、MuPDFで完成artifactを作る。
- 大きな同期pixel scanのExtension Host隔離は[refactor backlog](../../refactor-backlog.md)の継続課題とする。

## Staging and commit boundary

operationごとのstaging rootは次の形式とする。

```text
<workspace>/.graphics-workbench/crop-pdf/<一意ID>/<入力ごとのディレクトリ>/
```

元PDFのコピーと完成artifactはstagingで管理する。全入力の処理が成功するまでfinal pathへcommitせず、commit途中の失敗ではそのoperationで反映済みのartifactをrollbackする。stagingの寿命とactivation時のcleanupは、[Safe Mode internal contract](safe-mode.md)と[file operation security contract](file-operation-security.md)を正本とする。

## Cancellation boundary

margin選択後の変換はcommand層の`vscode.window.withProgress`からcoreへ接続する。キャンセルの伝播とoperation rootのcleanupは[conversion progress and cancellation internal contract](conversion-progress-and-cancellation.md)に従う。

## Undo boundary

成功した変換のartifact記録と取消前のSHA-256・workspace境界検証は[Undo internal contract](undo-last-conversion.md)に従う。
