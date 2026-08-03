# PDF回転仕様

## 対象

- command: `graphics-workbench.rotatePdf.rotate`
- 入力: Explorerから選択された1件以上のローカルPDF
- 操作: QuickPickで90 / 180 / 270度の回転角度を選択する

## 出力

- 入力PDFの全ページを選択した角度だけ回転し、1つのPDFを出力する。
- 出力先は`graphics-workbench.outputPath.rotatePdf`を元PDFのパス情報で展開する。
- 相対パスは入力PDFが属するworkspaceを基準に解決する。
- すべての入力の処理が成功するまで指定出力先へ反映しない。
- 同じ変換内で出力先が重複する場合は全体停止する。
- 既存出力との競合時は[Safe Mode仕様](safe-mode.md)に従う。

既定の出力pathは`${fileDirname}/${fileBasenameNoExtension}-rotated.pdf`とする。

## キャンセルと取り消し

QuickPickでキャンセルした場合は何も実行しない。処理中のキャンセル時は未開始の処理を開始せず、指定出力先へ結果を反映しない。成功後は[Undo仕様](undo-last-conversion.md)の対象にする。

## エラー

入力なし、PDF以外、workspace外、0ページPDF、重複または既存の出力先、読み書き失敗、出力反映失敗は全体を停止する。キャンセルは通常のエラーとして扱わない。

## 構成ページの回転

Webview版（`graphics-workbench.rotatePdf.configure`）は、構成ページ単位の回転をサポートする。このQuickPick版は常に全ページを対象とし、選択ページ回転はWebview版の責務とする。
