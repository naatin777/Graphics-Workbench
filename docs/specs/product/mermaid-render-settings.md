# Mermaid描画設定の仕様

## 目的

Mermaid 変換で theme と背景色を settings.json から変更可能にする。LaTeX 文書への挿入時に透過背景やダークテーマを選択できるようにする。

## 設定項目

| 設定キー                                     | 型       | 既定値      | 説明                                      |
| -------------------------------------------- | -------- | ----------- | ----------------------------------------- |
| `graphics-workbench.execPath.chrome`         | `string` | 空文字      | Chrome実行ファイルの明示指定              |
| `graphics-workbench.mermaid.theme`           | `string` | `"default"` | Mermaid の theme                          |
| `graphics-workbench.mermaid.backgroundColor` | `string` | `"white"`   | 背景色（CSS color値または `transparent`） |

## theme の有効値

`default`、`forest`、`dark`、`neutral`、`base`。

Mermaid CLI がサポートする theme 値に従う。無効な値が指定された場合は Mermaid CLI のエラーに委ねる（事前バリデーションは行わない）。

## backgroundColor の有効値

CSS color 値（`white`、`#ffffff`、`rgb(255,255,255)` など）または `transparent`。

`transparent` を指定すると背景なしの画像が生成される。LaTeX 文書に挿入する場合に便利。

## 変換への反映

Mermaidは外部の`mmdc` CLIで変換し、`theme`と`backgroundColor`をPDF、PNG、SVGの各出力へ反映する。実行file、temporary config、process lifecycleは実装と外部tool skillを正本とする。

## 影響範囲

| 操作                          | 影響                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `convertToPdf`（Mermaid入力） | Mermaid → PDF 変換時に theme/backgroundColor が反映される |
| `convertToPng`（Mermaid入力） | 同上                                                      |
| `convertToSvg`（Mermaid入力） | 同上                                                      |

すべての出力形式で同じ theme/backgroundColor 設定が使われる。

## 対象外

- fontFamily の設定
- Mermaid CLI の config JSON ファイルによる全設定開放
- theme ごとの出力画像の完全一致テスト
- Mermaid 図の拡大縮小設定

## 関連

- [出力形式基準の変換仕様](output-format-conversion.md)
