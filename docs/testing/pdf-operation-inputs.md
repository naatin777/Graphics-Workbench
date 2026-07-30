# PDF operation test data

このテストデータは、PDF操作テストで使う固定入力と固定出力を説明する。

入力は`test/input/valid/operations/pdf-operations/`、正解データは入力形式の`test/output/pdf/pdf-operations/`に保存する。
テストは入力を一時workspaceへコピーして使い、固定データ自体は変更しない。

## 入力ファイル

- ` 薔薇🌹.dio`: Draw.io原本
- ` 薔薇🌹.pdf`: 3ページの元PDF
- ` 薔薇🌹-1.pdf`: 元PDFの1ページ目を入力として使うPDF
- `q a.drawio`: Draw.io原本
- `q a.pdf`: 2ページの元PDF

ファイル名には、先頭空白、日本語、絵文字、通常空白を意図的に含める。テストでworkspaceへコピーするときは、さらに複数言語、全角文字、Unicode記号を含む名前へ変更する。

## 正解データ

ページ分割とcropの結果を`test/output/pdf/pdf-operations/`へ保存する。

- ` 薔薇🌹-1.pdf`から` 薔薇🌹-3.pdf`: 元PDFをページごとに分けたPDF
- ` 薔薇🌹-crop.pdf`: 3ページをcropしたPDF
- ` 薔薇🌹-1-crop.pdf`から` 薔薇🌹-3-crop.pdf`: 各ページをcropしたPDF
- `a a-1.pdf`と`a a-2.pdf`: `q a.pdf`の各ページと同じ内容を持つPDF
- `q a-crop.pdf`: 2ページをcropしたPDF
- `a a-1-crop.pdf`と`a a-2-crop.pdf`: 各ページをcropしたPDF

PDFの内容を変更・再生成した場合は、入力と正解データの対応関係および描画比較結果を確認する。
