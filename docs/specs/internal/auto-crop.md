# PDF自動クロップの内部契約

`cropPdf.auto`の利用者向け挙動は、[product specification](../product/auto-crop.md)を正本とする。この文書は、入力境界、処理依存関係、staging、commit、取消の内部契約だけを記録する。

## Command boundary

command adapterは`uri`と`uris`を受け取り、`uris`に1件以上ある場合はそれを、ない場合は`uri`をcoreへ渡す。workspace境界の検証は変換処理を開始する前に行う。

## Processing boundary

- 元PDFはworkspace内のoperation stagingへコピーし、コピーをMuPDFで処理する。
- 各ページを白背景のDeviceRGB pixmapへrenderし、純白以外のpixel boundsを検出する。
- 検出したpixel boundsをページのtransformの逆変換でPDF座標へ戻し、commandから受け取ったmarginを加えてCropBoxを更新する。
- ページのoffset MediaBoxとrotationを考慮する。これはraster samplingによるpdfcrop-compatibleな挙動であり、Ghostscriptのbboxとbit-perfectに一致することは保証しない。
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
