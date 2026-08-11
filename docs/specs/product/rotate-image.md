# 画像回転仕様

## 対象

- command: `graphics-workbench.rotateImage`
- 入力: Explorerから選択された1件以上のローカルラスタ画像（PNG / JPEG / WebP / AVIF / GIF / TIFF）
- 操作: QuickPickで90 / 180 / 270度の回転角度を選択する

## 出力

- 各入力画像を選択した角度だけ回転し、同じ画像形式で1つずつ出力する。
- 出力先は`graphics-workbench.outputPath.rotateImage`を元画像のパス情報で展開する。
- 相対パスは入力画像が属するworkspaceを基準に解決する。
- 出力拡張子はラスタ形式（PNG / JPEG / WebP / AVIF / GIF / TIFF）でなければならない。
- すべての入力の処理が成功するまで指定出力先へ反映しない。
- 同じ変換内で出力先が重複する場合は全体停止する。
- 既存出力との競合時は[Safe Mode仕様](safe-mode.md)に従う。

既定の出力pathは`${fileDirname}/${fileBasenameNoExtension}-rotated${fileExtname}`とする。

## キャンセルと取り消し

QuickPickでキャンセルした場合は何も実行しない。処理中のキャンセル時は未開始の処理を開始せず、指定出力先へ結果を反映しない。成功後は[Undo仕様](undo-last-conversion.md)の対象にする。

## エラー

入力なし、ラスタ画像以外、workspace外、無効な角度、ラスタ形式でない出力拡張子、画素上限超過、重複または既存の出力先、読み書き失敗、出力反映失敗は全体を停止する。キャンセルは通常のエラーとして扱わない。

## アニメーション

アニメーション画像（GIF / WebP）は全フレームを保持したまま回転する。PDFページ選択のような構成単位の操作は提供しない。
