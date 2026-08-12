# 図・画像挿入フォーマットの仕様

## 目的

PDF／画像ファイルの drag & drop、clipboard 画像 paste 時に挿入するコード（LaTeX / Typst / Quarkdown）の形式を、テンプレート文字列でカスタマイズ可能にする。対象document言語は `latex` / `tex` / `typst` / `quarkdown`。

## 設定

| 設定キー                                           | 型       | 既定値                                                                                                                            |
| -------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `graphics-workbench.insertLatex.pdfTemplate`       | `string` | `\begin{figure}[H]\centering\includegraphics[width=\linewidth]{${path}}\caption{${name}}\label{fig:${name}}\end{figure}`          |
| `graphics-workbench.insertLatex.imageTemplate`     | `string` | `\begin{figure}[H]\centering\resizebox{\linewidth}{!}{\includegraphics{${path}}}\caption{${name}}\label{fig:${name}}\end{figure}` |
| `graphics-workbench.insertTypst.pdfTemplate`       | `string` | `#figure(image("${path}"), caption: [${name}])`                                                                                   |
| `graphics-workbench.insertTypst.imageTemplate`     | `string` | `#figure(image("${path}", width: 80%), caption: [${name}])`                                                                       |
| `graphics-workbench.insertQuarkdown.pdfTemplate`   | `string` | `![${name}](${path} "${name}")`                                                                                                   |
| `graphics-workbench.insertQuarkdown.imageTemplate` | `string` | `![${name}](${path} "${name}")`                                                                                                   |

## テンプレート変数

| 変数      | 展開内容                                     | 例                  |
| --------- | -------------------------------------------- | ------------------- |
| `${path}` | ドキュメントからの相対パス                   | `figures/graph.pdf` |
| `${name}` | 拡張子を除いたファイル名                     | `graph`             |
| `${ext}`  | 拡張子（ドットなし）                         | `pdf`               |
| `${page}` | PDFのページ番号（drag & dropでページ選択時） | `1`                 |
| `${dir}`  | ファイルのあるディレクトリ（相対）           | `figures`           |

## 動作

### drag & drop（PDF）

- 対象言語により `insert{Format}.pdfTemplate` を使用（LaTeX=`insertLatex`、Typst=`insertTypst`、Quarkdown=`insertQuarkdown`）
- ページ選択時は `${page}` にページ番号が入る
- 複数ファイル同時 drop 時は形式別にラップする
  - LaTeX: `subfigure` 環境
  - Typst: `#grid(columns: 2, ...)`
  - Quarkdown: `.row alignment:{spacebetween}` ブロック

### drag & drop（画像）

- PNG/JPEG/WebP/AVIF/GIF/TIFF/SVG → `insert{Format}.imageTemplate` を使用
- 複数ファイル同時 drop 時は形式別にラップする（上記に同じ）

### clipboard paste（画像）

- 保存された画像ファイル → `insert{Format}.imageTemplate` を使用
- 保存先パスは既存の `outputPath.clipboardImage` 設定に従う

## 設定の扱い

挿入結果はテンプレート設定だけで決まり、テンプレート以外の旧形式の設定へ切り替えない。

## テンプレートのバリデーション

- `${path}` が含まれていない場合は警告（必須変数）
- 未知の変数（`${xxx}`）はそのまま文字列として残す（エラーにはしない）

バリデーションは拡張機能起動時または設定変更時に行い、Output channel に警告を記録する。

## 対象外

- `subfigure` テンプレートの個別設定
- `caption` / `label` の有無の切り替え（テンプレート変数で対応）
- テンプレートのリアルタイムプレビュー
- Quarkdownの自動figure化・caption番号制御
- Typstの`figure`補完
- 画像drop（現行はPDFのみdrop、画像はpaste）の追加

## 関連

- [出力形式基準の変換仕様](output-format-conversion.md)
