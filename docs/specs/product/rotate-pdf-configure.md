# PDF回転（Configure）仕様

## 対象

- command: `graphics-workbench.rotatePdf.configure`
- 入力: Explorerから選択された1件のローカルPDF
- 操作: Configure Webviewで回転するページと回転角度（90 / 180 / 270度）を選択してApplyする

## 出力

- 選択したページだけを選択した角度だけ回転し、1つのPDFを出力する。
- 出力先は`graphics-workbench.outputPath.rotatePdf`を元PDFのパス情報で展開する。
- 相対パスは入力PDFが属するworkspaceを基準に解決する。
- Applyが成功するまで指定出力先へ反映しない。
- 既存出力との競合時は[Safe Mode仕様](safe-mode.md)に従う。

既定の出力pathは`${fileDirname}/${fileBasenameNoExtension}-rotated.pdf`とする。

## Webview

- PDFの全ページをサムネイル表示し、クリックで回転対象ページを選択できる。
- 「すべてのページを選択」トグルで全選択 / 全解除できる。
- 回転角度は90 / 180 / 270度からラジオで選択する。
- ページを1つも選択しない状態でApplyすると検証エラーを表示し、Applyを送信しない。
- CancelでWebviewを閉じ、何も実行しない。

## キャンセルと取り消し

処理中のキャンセル時は未開始の処理を開始せず、指定出力先へ結果を反映しない。成功後は[Undo仕様](undo-last-conversion.md)の対象にする。

## エラー

PDF以外、workspace外、0ページPDF、既存の出力先、読み書き失敗、出力反映失敗は全体を停止する。キャンセルは通常のエラーとして扱わない。
