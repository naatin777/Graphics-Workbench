# PDF並び替え（Configure）仕様

## 対象

- command: `graphics-workbench.reorderPdf.configure`
- 入力: Explorerから選択された1件のローカルPDF
- 操作: Configure Webviewでページの出力順を変更してApplyする

## 出力

- 指定した順序で全ページを並び替え、1つのPDFを出力する。ページの追加・削除は行わない。
- 出力先は`graphics-workbench.outputPath.reorderPdf`を元PDFのパス情報で展開する。
- 相対パスは入力PDFが属するworkspaceを基準に解決する。
- Applyが成功するまで指定出力先へ反映しない。
- 既存出力との競合時は[Safe Mode仕様](safe-mode.md)に従う。

既定の出力pathは`${fileDirname}/${fileBasenameNoExtension}-reordered.pdf`とする。

## Webview

- PDFの全ページを出力順にサムネイル表示し、各ページの上へ / 下へ移動ボタンで順序を変更する。
- 表示中の順序がそのまま出力順になる。
- CancelでWebviewを閉じ、何も実行しない。

## キャンセルと取り消し

処理中のキャンセル時は未開始の処理を開始せず、指定出力先へ結果を反映しない。成功後は[Undo仕様](undo-last-conversion.md)の対象にする。

## エラー

PDF以外、workspace外、0ページPDF、既存の出力先、読み書き失敗、出力反映失敗は全体を停止する。キャンセルは通常のエラーとして扱わない。
