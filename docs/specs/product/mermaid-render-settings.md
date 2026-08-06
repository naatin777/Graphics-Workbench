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

## CLI への引き渡し

同梱の`mmdc` CLIを通常の外部プロセスとして実行する。入力・出力・形式・背景色は引数配列で渡す。

```text
mmdc --input source.mmd --output output.png --outputFormat png \
  --backgroundColor transparent --configFile mermaid-config.json \
  --puppeteerConfigFile chrome-config.json --quiet
```

`mermaid-config.json`にはthemeを、`chrome-config.json`には`execPath.chrome`から解決したChrome実行ファイルを一時的に書き込む。これらはCLI実行後に削除する。`base`を含むthemeの実行時検証はmmdcに委譲する。

## 設定の読み取り

`readMermaidCliOptions` 関数で読む。

```typescript
export interface MermaidCliOptions {
  chromePath: string;
  theme: string;
  backgroundColor: string;
}

export function readMermaidCliOptions(configuration: Configuration): MermaidCliOptions {
  return {
    chromePath: readChromeExecutablePath(configuration),
    theme: configuration.mermaid.theme(),
    backgroundColor: configuration.mermaid.backgroundColor(),
  };
}
```

## 影響範囲

| 操作                          | 影響                                                      |
| ----------------------------- | --------------------------------------------------------- |
| `convertToPdf`（Mermaid入力） | Mermaid → PDF 変換時に theme/backgroundColor が反映される |
| `convertToPng`（Mermaid入力） | 同上                                                      |
| `convertToSvg`（Mermaid入力） | 同上                                                      |

すべての出力形式で同じ theme/backgroundColor 設定が使われる。

## パッケージマニフェスト

`package.json` の `contributes.configuration` に以下を追加する。

```json
{
  "graphics-workbench.mermaid.theme": {
    "type": "string",
    "default": "default",
    "enum": ["default", "forest", "dark", "neutral", "base"],
    "description": "%config.mermaid.theme%"
  },
  "graphics-workbench.mermaid.backgroundColor": {
    "type": "string",
    "default": "white",
    "description": "%config.mermaid.backgroundColor%"
  }
}
```

NLS の日本語・英語メッセージも追加する。

## テスト計画

### 設定読み取りテスト

- `mermaid.theme` 未設定時は既定値 `"default"` が使われる
- `mermaid.theme` に `"dark"` を設定すると `"dark"` が読まれる
- `mermaid.backgroundColor` 未設定時は既定値 `"white"` が使われる
- `mermaid.backgroundColor` に `"transparent"` を設定すると `"transparent"` が読まれる

### 実変換テスト

- theme=`dark` で Mermaid → SVG 変換し、出力に dark theme 特有の色が含まれることを確認
- backgroundColor=`transparent` で Mermaid → PNG 変換し、背景が透過であることを sharp の metadata で確認（`hasAlpha`）

## 対象外

- fontFamily の設定
- Mermaid CLI の config JSON ファイルによる全設定開放
- theme ごとの出力画像の完全一致テスト
- Mermaid 図の拡大縮小設定

## 関連

- [出力形式基準の変換仕様](output-format-conversion.md)
- [0099: Mermaid描画設定の仕様を決める](../../tasks/0099-design-mermaid-render-settings.md)
