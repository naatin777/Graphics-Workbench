# 複数画像を1つのPDFへ結合する仕様

## 目的

複数の画像入力を1つのPDFファイルへ結合する変換コマンドを提供する。既存の `convertToPdf`（入力ごとに個別PDF）とは異なり、全入力を単一のPDFにまとめる。

## コマンド

保存先を指定するCombineと、設定済みの出力先へ実行するQuick Combineを提供する。両commandは、複数の独立した画像を1つのPDFへ結合すること自体を目的とする`combine` operationに分類され、Context Menuでの表示は`graphics-workbench.conversion.combine.enabled`で制御する。公開IDはmanifestとcommand bindingを正本とする。

## 対象入力形式

- PNG、JPEG、WebP、AVIF、GIF、TIFF（ラスター画像）
- SVG

Mermaid、Draw.io、ネイティブPDFは対象外。Draw.ioは`graphics-workbench.convertDrawioToSinglePdf`で全ページを1PDFにする専用コマンドがある。

## 入力と順序

**2件以上**のファイルを選択する必要がある。1件だけの選択は結合しない（Combineには2件以上必要であることを表示する）。通常のConvert to PDFへの暗黙フォールバックはしない。

- **Save As Combine**（`combineImagesToPdf`）: 画像の順序をQuickPickで確認・変更・除外した後、Save Asダイアログで出力先を指定する。
- **Quick Combine**（`quickCombineImagesToPdf`）: ダイアログなしで即座に結合する。入力順序は Explorer の選択順のまま使う。

## 出力パス

- **Save As Combine**: outputPath設定を持たない。結合順の確認後、**必ず保存ダイアログ（Save As）**で出力先を指定させる。出力先は選択したworkspace内に制限する。
- **Quick Combine**: `graphics-workbench.outputPath.combine.pdf` を使う。既定値は `${workspaceFolder}/combined-${random}.pdf`。この設定は**必ず `${random}` を含む必要がある**。含まない場合はinvalid configurationとして扱い、`combined.pdf` への衝突時に `combined-1.pdf` へ勝手に名前を変えるようなfallbackはしない。

`${random}` はファイル名用途の短いランダム文字列（16進数8桁、例: `a83f2c91`）で、Node.jsの暗号学的乱数（`crypto.randomBytes`）から生成する。Quick Combineを連続実行しても出力が衝突しないことを設定レベルで保証する。

Save AsとQuickは空文字設定のような隠れたsentinel値で切り替えない。別commandとして明示する。

## ページサイズ

各入力画像の pixel 幅・高さを point 単位のページサイズとして扱う。ページごとに異なるサイズを許容する。

- ラスター画像: `sharp` の metadata から幅・高さを取得し、pixel = point でページサイズとする
- SVG: `sharp` の metadata から幅・高さを取得（既存の `readSvgSize` を再利用）

## エラー処理

1件でも入力の変換に失敗した場合、結合PDFを出力しない。既存の batch transaction モデルに従う。

全画像が正常に変換され、結合も成功した場合のみ commit する。

## Safe Mode、Undo、Progress、Cancellation

既存の出力形式基準コマンドと同じ batch transaction モデルを使用する。

- **Safe Mode**: 出力先に既存ファイルがある場合、競合判断を1回だけ行う
- **Undo**: batch 全体を1回分の Undo として記録する
- **Progress**: `vscode.window.withProgress` で「N件中M件を処理中」と表示する
- **Cancellation**: `AbortSignal` を全処理に伝播し、途中停止時は出力しない

## 設定

- `graphics-workbench.outputPath.combine.pdf`: Quick Combineの出力テンプレート。`${random}`必須。
- Save As Combineは出力path設定を持たない。出力先は常にSave Asダイアログで選択する。

## 対象外

- 画像の並び替えUI（Save As版のQuickPickでの順序変更は行う）
- 結合方向の指定（縦結合・横結合・grid など、PDFのページ結合なので不要）
- 画像間への空白ページ挿入
- Mermaid、Draw.io、PDFの入力
- 単一ファイルの入力（通常のConvert to PDFを使う。暗黙フォールバックしない）

## 関連

- [出力形式基準の変換仕様](output-format-conversion.md)
- [Safe Mode仕様](safe-mode.md)
- [`docs/architecture.md`](../../architecture.md)
