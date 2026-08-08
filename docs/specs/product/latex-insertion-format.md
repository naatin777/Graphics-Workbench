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
  - LaTeX: `subfigure` 環境（既存動作を維持）
  - Typst: `#grid(columns: 2, ...)`
  - Quarkdown: `.row alignment:{spacebetween}` ブロック

### drag & drop（画像）

- PNG/JPEG/WebP/AVIF/GIF/TIFF/SVG/EPS → `insert{Format}.imageTemplate` を使用
- 複数ファイル同時 drop 時は形式別にラップする（上記に同じ）

### clipboard paste（画像）

- 保存された画像ファイル → `insert{Format}.imageTemplate` を使用
- 保存先パスは既存の `outputPath.clipboardImage` 設定に従う

## 既存の詳細設定との関係

既存の `figure.placementOptions`、`figure.alignmentOptions`、`figure.graphicsOptions`、`subfigure.*` 設定は、テンプレート方式に移行した後も互換のために残す。

テンプレートがデフォルト値のままの場合、既存の個別設定が反映される（後方互換）。

テンプレートがカスタマイズされた場合は、テンプレートの内容が優先され、個別設定は無視される。

## テンプレートのバリデーション

- `${path}` が含まれていない場合は警告（必須変数）
- 未知の変数（`${xxx}`）はそのまま文字列として残す（エラーにはしない）

バリデーションは拡張機能起動時または設定変更時に行い、Output channel に警告を記録する。

## パッケージマニフェスト

```json
{
  "graphics-workbench.insertLatex.pdfTemplate": {
    "type": "string",
    "default": "\\begin{figure}[H]\n  \\centering\n  \\includegraphics[width=\\linewidth]{${path}}\n  \\caption{${name}}\n  \\label{fig:${name}}\n\\end{figure}",
    "description": "%config.insertLatex.pdfTemplate%"
  },
  "graphics-workbench.insertLatex.imageTemplate": {
    "type": "string",
    "default": "\\begin{figure}[H]\n  \\centering\n  \\resizebox{\\linewidth}{!}{\\includegraphics{${path}}}\n  \\caption{${name}}\n  \\label{fig:${name}}\n\\end{figure}",
    "description": "%config.insertLatex.imageTemplate%"
  },
  "graphics-workbench.insertTypst.pdfTemplate": {
    "type": "string",
    "default": "#figure(image(\"${path}\"), caption: [${name}])",
    "description": "%config.insertTypst.pdfTemplate%"
  },
  "graphics-workbench.insertTypst.imageTemplate": {
    "type": "string",
    "default": "#figure(image(\"${path}\", width: 80%), caption: [${name}])",
    "description": "%config.insertTypst.imageTemplate%"
  },
  "graphics-workbench.insertQuarkdown.pdfTemplate": {
    "type": "string",
    "default": "![${name}](${path} \"${name}\")",
    "description": "%config.insertQuarkdown.pdfTemplate%"
  },
  "graphics-workbench.insertQuarkdown.imageTemplate": {
    "type": "string",
    "default": "![${name}](${path} \"${name}\")",
    "description": "%config.insertQuarkdown.imageTemplate%"
  }
}
```

## テスト計画

- デフォルトテンプレートで PDF drop → 期待されるコードが生成される（LaTeX=`includegraphics`、Typst=`#figure(image(...))`、Quarkdown=`![name](path "name")`）
- デフォルトテンプレートで画像 drop → `resizebox` が含まれる（LaTeX）
- カスタムテンプレート（`\includegraphics{${path}}` のみ）→ `figure` 環境なしで生成される
- `${name}`、`${ext}`、`${dir}` 変数が正しく展開される
- 複数ファイル drop → 形式別ラップ（LaTeX=`subfigure`、Typst=`#grid`、Quarkdown=`.row`）が正しく生成される
- clipboard paste → 保存先パスが `${path}` に展開される
- テンプレート空文字 → エラーまたはデフォルトフォールバック
- 後方互換：テンプレート未設定時は既存の個別設定が使われる

## 対象外

- `subfigure` テンプレートの個別設定
- `caption` / `label` の有無の切り替え（テンプレート変数で対応）
- テンプレートのリアルタイムプレビュー
- Quarkdownの自動figure化・caption番号制御
- Typstの`figure`補完
- 画像drop（現行はPDFのみdrop、画像はpaste）の追加

## 関連

- [出力形式基準の変換仕様](output-format-conversion.md)
- [0119: LaTeX挿入フォーマットの仕様を決める](../../tasks/0119-design-latex-insertion-format.md)
