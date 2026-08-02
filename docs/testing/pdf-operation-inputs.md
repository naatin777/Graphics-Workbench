# PDF operation test data

このテストデータは、PDF操作テストで使う固定入力と固定出力を説明する。

入力は`test/input/valid/pdf/`、正解データは`test/output/pdf/pdf-operations/`に保存する。
テストは入力を一時workspaceへコピーして使い、固定データ自体は変更しない。

## 入力ファイル

- `multi-page-table.pdf`: 2ページの元PDF（crop/split/merge configure の基準入力）
- `multilingual-text.pdf`: 2ページの元PDF（crop configure・merge/split の2つ目の入力）
- `multi-page-mixed-content.pdf`: 15ページの混在サイズPDF（長いプレビューのスクロールと実操作E2E用）
- `single-page-document.pdf`: 1ページの元PDF（Unicode名で複数outputPathへ出力するテスト用）
- `drawio/unicode-page-names.drawio`: 3ページのDraw.io原本（drawio変換テスト用）

入力ファイル名には特殊文字を置かず、空白・日本語・絵文字を含む名前はテストがworkspaceへコピーするときに付与する。

## 正解データ

configure cropの結果を`test/output/pdf/pdf-operations/`へ保存する。

- `a a-1-crop.pdf`: `multilingual-text.pdf`の1ページ目をcropBoxでcropしたPDF

PDFの内容を変更・再生成した場合は、入力と正解データの対応関係および描画比較結果を確認する。
