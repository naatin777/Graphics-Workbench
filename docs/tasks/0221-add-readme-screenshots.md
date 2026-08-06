# 0221: README用の操作スクリーンショットを追加する

Status: Not Started

## Objective

README（`README.md` / `README.ja.md`）へ、実際の操作が伝わる画像を追加する。架空の画像リンクは追加せず、`docs/images/` へ実画像を配置してから README へ参照を追加する。

## Why

README冒頭の「代表的なワークフロー」を補強するには、Configure画面・PDFプレビュー・ページ選択・並び替え・Safe Modeの選択画面など、実際の見た目が伝わる画像が有効。現時点では使用可能な画像がリポジトリに存在しない（`assets/icon.png`のみ）。

## Image location

`docs/images/` を正式な配置先とする。ファイル名は内容を表す snake_case とし、`.png`（または `.gif`）で保存する。

## Required captures

文字が読めるサイズで、テーマ依存・個人情報・ローカルパスが写り込まないように撮影する。

### 1. PDF Configure画面（例: Crop）

- Explorer で PDF を右クリック → **Crop PDF** → **Adjust Margins** を開いた状態
- 左側にPDFプレビュー、右側に処理オプション（余白設定）が表示されていること

### 2. ページ選択画面（例: Split / Rotate）

- 対象ページの選択状態がわかること
- PageNavigator が表示されていること

### 3. 並び替え画面（Reorder）

- 複数ページのPDFプレビューと、各ページの移動コントロール（↑ / ↓）が表示されていること

### 4. Safe Modeの選択

- 既存出力の上書き時に表示される **Keep Both** / **Do Not Overwrite** / **Overwrite** の選択ダイアログ

### 5. ワークフロー用の短いGIF（任意）

- 「複数画像を1つのPDFへまとめる」「スクリーンショットをLaTeXへ挿入する」の操作を1回の流れで示す短いGIF

## Acceptance criteria

- 各画像が `docs/images/` に配置されている
- READMEの該当箇所に画像参照（相対パス）が追加されている
- 画像に個人情報・ローカルパス・テーマ依存が写り込んでいない
- 画像が読めるサイズである

## Notes

- 撮影はローカルの VS Code で行い、画像のみを commit する（`.vscode-test-data` や test workspace は含めない）
- テーマは既定テーマのまま撮影し、ダークテーマのスクリーンショットを前提にしない
