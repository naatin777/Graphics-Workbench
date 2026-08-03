# PDF回転 internal contract

## 対象

- `src/operations/pdf/rotate_pdf.ts`の`rotatePdfFiles`
- `src/commands/pdf/rotate_pdf.ts`の`rotatePdfCommand`（`graphics-workbench.rotatePdf.rotate`）

## 入力

- `RotatePdfJob`: `sourcePath`、`workspacePath`、`outputPath`、`angle`（90 / 180 / 270）、任意の`pageIndices`（0始まり。省略時は全ページ）
- `RotatePdfOptions`: `jobs`、任意の`runtime`、`runId`

## stagingとartifact境界

- 入力PDFは`<workspace>/.graphics-workbench/rotate-pdf/<runId>/<n>-<source>/`へコピーし、そのコピーから処理する。
- 生成した`result.pdf`をstagingへ書き込み、全job成功後にcommitする。
- staging rootとbackupは[Safe Mode internal contract](safe-mode.md)、commit/rollbackは[file operation security contract](file-operation-security.md)、Undo recordは[Undo internal contract](undo-last-conversion.md)を正本とする。
- 処理は`runStagedConversionBatch`で実行し、失敗時はstagingをcleanupする。

## 回転の実装

- pdf-libの`copyPages`でページをコピーし、対象ページに`setRotation(degrees(angle))`を適用してから出力PDFへ追加する。
- ページindexが範囲外の場合はエラーにして全体を停止する。
- `angle`が90 / 180 / 270以外の場合はエラーにして全体を停止する。

## キャンセルと進捗

- `runtime.signal`でキャンセルを検知し、未開始jobは開始せず、commit前のstagingはcleanupする。
- `runtime.reportProgress`で完了job数を通知する。

## 関連

- [PDF回転 product spec](../product/rotate-pdf.md)
- [Safe Mode internal contract](safe-mode.md)
- [Undo internal contract](undo-last-conversion.md)
