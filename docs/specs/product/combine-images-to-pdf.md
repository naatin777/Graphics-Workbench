# 複数画像を1つのPDFへ結合する仕様

## 目的

複数の画像入力を1つのPDFファイルへ結合する変換コマンドを提供する。既存の `convertToPdf`（入力ごとに個別PDF）とは異なり、全入力を単一のPDFにまとめる。

## コマンド

| Command ID                              | 表示名               | 出力形式 |
| --------------------------------------- | -------------------- | -------- |
| `graphics-workbench.combineImagesToPdf` | 画像を1つのPDFに結合 | PDF      |

## 対象入力形式

- PNG、JPEG、WebP、AVIF、GIF、TIFF（ラスター画像）
- SVG

Mermaid、Draw.io、ネイティブPDFは対象外。Draw.ioは`graphics-workbench.convertDrawioToSinglePdf`で全ページを1PDFにする専用コマンドがある。

## 入力と順序

**2件以上**のファイルを選択する必要がある。1件だけの選択は結合しない（Combineには2件以上必要であることと、通常のConvert to PDFを使うべきであることを表示する）。

画像の順序は Explorer での選択順（VS Code の `uris` 配列順）とする。ユーザーが Ctrl+クリックで選んだ順序をそのまま使う。結合前にQuickPickで順序の確認・変更・除外ができる。

## 出力パス

`combineImagesToPdf`はoutputPath設定を持たない。結合順の確認後、**必ず保存ダイアログ（Save As）**で出力先を指定させる。出力先は選択したworkspace内に制限する。

## ページサイズ

各入力画像の pixel 幅・高さを point 単位のページサイズとして扱う。ページごとに異なるサイズを許容する。

- ラスター画像: `sharp` の metadata から幅・高さを取得し、pixel = point でページサイズとする
- SVG: `sharp` の metadata から幅・高さを取得（既存の `readSvgSize` を再利用）

## 内部パイプライン

```
画像1 ─→ 既存の画像→PDF処理 ─→ 中間PDF1 ┐
画像2 ─→ 既存の画像→PDF処理 ─→ 中間PDF2 ┤─ mupdf graftPage → 結合PDF
画像3 ─→ 既存の画像→PDF処理 ─→ 中間PDF3 ┘
```

1. 各入力画像を既存の経路で単ページPDFへ変換する
   - ラスター画像: `writeRasterImageAsPdf`（sharp + mupdf）
   - SVG: `writeSvgAsPdf`（rsvg-convert またはChrome headless CLI）
2. 生成された中間PDFを mupdf の `graftPage` で1つの `PDFDocument` にマージする
3. 結合PDFを staging へ保存し、commit する

中間PDFは staging directory 内で管理し、ユーザーに見せない。commit 後に staging cleanup で削除する。

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

`combineImagesToPdf`は出力path設定を持たない。出力先は常にSave Asダイアログで選択する。

## 対象外

- 画像の並び替えUI（QuickPickでの順序変更は行う）
- 結合方向の指定（縦結合・横結合・grid など、PDFのページ結合なので不要）
- 画像間への空白ページ挿入
- Mermaid、Draw.io、PDFの入力
- 単一ファイルの入力（通常のConvert to PDFを使う）

## テスト計画

- 全対象入力形式（PNG, JPEG, WebP, AVIF, GIF, TIFF, SVG）の複数→PDF
- 複数形式混在選択の結合
- 1件の変換失敗時に出力しないことの確認
- Safe Mode 競合判断の確認
- Undo の確認
- 1件だけの選択時に結合しないことの確認
- Save Asで出力先を選択して結合することの確認

## 関連

- [出力形式基準の変換仕様](output-format-conversion.md)
- [Safe Mode仕様](safe-mode.md)
- [変換入力job validationの内部契約](../internal/input-preflight.md)
- [0096: 複数画像を1つのPDFへ結合する仕様を決める](../../tasks/0096-design-combine-images-to-single-pdf.md)
