<div align="center">
  <h1>Graphics Workbench</h1>
  <img alt="GitHub License" src="https://img.shields.io/github/license/naatin777/Graphics-Workbench">
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/naatin777/Graphics-Workbench">
</div>

[English](README.md) | 日本語

Graphics Workbench は、論文や技術文書で使用する PDF や画像を、VS Code から離れずに変換・トリミング・結合・並べ替え・挿入できる拡張機能です。LaTeX 以外の一般的な PDF・画像処理にも利用できます。

## 対象ユーザーと解決する作業

この拡張機能は、論文、レポート、技術文書などで図版を扱う VS Code ユーザーを主な対象にしています。

- スクリーンショットや図表を PDF に変換したい
- 図版 PDF の余白を削除して論文に貼りたい
- 複数の画像を 1 つの PDF にまとめたい
- 図版を LaTeX の `figure` / `includegraphics` コードとして挿入したい

Graphics Workbench の独自性は、個々の変換形式ではなく、次の一連の流れにあります。Explorer から直接操作し、PDF をプレビューしながら編集し、出力競合を安全に処理し、必要に応じて Undo し、最後に LaTeX や技術文書へ配置できます。VS Code を離れて外部ツールを手で操作する必要がありません。

## 代表的なワークフロー

### 1. PDF の余白を削除する

1. Explorer で PDF を右クリック
2. **Crop PDF** → **Adjust Margins** を選択（自動で行う場合は **Auto crop**）
3. プレビューで余白を確認
4. 自動または詳細指定で余白を削除
5. 出力先と上書き方針を確認して保存

### 2. 複数画像を 1 つの PDF にまとめる

1. Explorer で複数の画像を選択
2. 右クリック → **Convert** → **Combine Images into Single PDF**
3. 生成される PDF を確認
4. 出力を保存

### 3. スクリーンショットを LaTeX へ挿入する

1. クリップボードの画像を LaTeX ドキュメントへ貼り付け
2. PDF として保存するか画像として保存するかを選択
3. 出力ファイルを生成して LaTeX コードを挿入
4. 必要なら **Undo Last Graphics Operation** で直前の処理を取り消す

## Safe Mode と Undo

Graphics Workbench は、既存のファイルを不用意に上書きしないよう設計されています。

- **Safe Mode（既定で有効）**: 既存の出力を上書きする前に **Keep Both**・**Do Not Overwrite**・**Overwrite** の選択を求めます
- **staging / backup**: 出力はまず staging 領域へ書き込み、確定時に反映します。上書き前の backup は Undo が済むまで保持されます
- **Undo**: 最後に完了した変換・結合・トリミング・分割・回転・並べ替え・クリップボード貼り付けを元に戻せます。生成後に変更された出力は取り消しません
- **不完全な出力を残さない**: 変換の失敗時やキャンセル時には、不完全な出力を出力先へ残しません

Convert confidently. Existing files are protected by default, and the latest graphics operation can be undone.

## 対応する主な処理

### PDF 操作

- **プレビュー**: PDF を読み取り専用で表示（「Reopen Editor With...」→ Graphics Workbench PDF Preview）
- **余白のトリミング**: 自動、またはプレビューで余白を指定して削除
- **分割**: PDF をページごとに単一ページ PDF として分割
- **結合**: 複数の PDF を 1 つに結合（並べ替えも可能）
- **回転**: ページを 90° / 180° / 270° で回転
- **並べ替え**: ページ順をプレビューしながら変更
- **圧縮 / 暗号化 / 復号化**: サイズ削減やパスワード保護

### プレビュー

- **TIFF プレビュー**: 単一・複数ページの TIFF ファイルを読み取り専用で表示（「Reopen Editor With...」→ Graphics Workbench TIFF Preview）

### 変換

- Explorer の右クリックメニューから、出力形式（PDF / PNG / JPEG / WebP / AVIF / GIF / TIFF / SVG）を選んで変換
- PDF・画像・SVG・Mermaid・Draw.io ファイルの相互変換
- 複数の画像を 1 つの PDF に結合
- アニメーション GIF / WebP の相互変換（アニメーション保持 / フレーム分割）
- 図版から編集可能な `.drawio` / `.drawio.png` / `.drawio.svg` を作成
- ネイティブ Draw.io ファイル（`.drawio` / `.dio`）をページごと、または 1 つの PDF へ変換

### LaTeX コード生成

- **PDF の挿入**: PDF ファイルを LaTeX ドキュメントへドラッグ&ドロップすると、対応する LaTeX コードを自動挿入
- **クリップボード画像の挿入**: 画像を貼り付けると、PDF / 画像のどちらで保存するかを選び、保存先を編集してから LaTeX コードを挿入

## インストール

この拡張機能は、以下のいずれかの方法でインストールできます。

> 対応エディタ: Visual Studio Code、Cursor、Devin Desktop（VS Code 1.125 以降）。
> その他の VS Code 互換エディタは動作する可能性がありますが、互換性テストの対象外です。

### Visual Studio Code Marketplace

VS Code 内の拡張機能マーケットプレイスから **Graphics Workbench** を検索し、インストールしてください。

[Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=naatin777.graphics-workbench)

### Open VSX Registry

Open VSX Registry からもインストールできます。

[Open VSX](https://open-vsx.org/extension/naatin777/graphics-workbench)

### プラットフォーム別パッケージ

Graphics Workbench は OS・CPU ごとにネイティブバイナリ（`sharp`）を含む VSIX を分けて公開しています。Marketplace / Open VSX からの通常インストールでは、VS Code が実行環境に合うパッケージを自動選択するため、利用者が選択する必要はありません。

| 環境                | パッケージ     |
| ------------------- | -------------- |
| Windows Intel / AMD | `win32-x64`    |
| Windows ARM         | `win32-arm64`  |
| Intel Mac           | `darwin-x64`   |
| Apple Silicon Mac   | `darwin-arm64` |
| Linux x64 (glibc)   | `linux-x64`    |
| Linux ARM64 (glibc) | `linux-arm64`  |

GitHub Releases から手動で VSIX を選ぶ場合は、上記の表から自分の環境に合うファイルを選んでください。

Remote SSH / WSL / Dev Container では、この拡張機能はローカルではなくリモート側の Extension Host で動作するため、リモート環境の OS・CPU 向けパッケージがインストールされます。VS Code が自動で選択します。

非対応環境（Alpine Linux / musl、ARM32 など、`sharp` のバイナリがない環境）はサポート対象外です。Universal 版のフォールバックは提供しません。

## セットアップと外部ツール

一部の機能では、VS Code 拡張機能とは別に外部ツールが必要です。使用する機能に応じて、必要なツールをインストールしてください。実行ファイルへのパスは VS Code の設定（`graphics-workbench.execPath.*`）で指定できます。

コマンドパレットから **Graphics Workbench: 環境を確認**（`Check Environment`）を実行すると、機能単位で利用可否を確認でき、項目を選択すると関連設定を開けます。未導入のツールがあっても環境チェック全体は失敗しません。

| ツール                   | 用途                                        | 必須になる機能                                                          | 備考                                                                                              |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| rsvg-convert             | SVG から PDF への変換                       | `rsvg-convert`バックエンドを選択した場合                                | SVG 変換バックエンドの 1 つです                                                                   |
| Google Chrome / Chromium | SVG / Mermaid 変換                          | SVG から PDF、Mermaid から PDF/PNG/JPEG/WebP/AVIF/SVG                   | Chrome headless CLIから使用します                                                                 |
| Draw.io Desktop          | Draw.ioファイルとeditable Draw.io画像の変換 | `.drawio`, `.dio`, `.drawio.png`, `.dio.png`, `.drawio.svg`, `.dio.svg` | Draw.io デスクトップアプリケーションが必要です                                                    |
| Mermaid CLI (`mmdc`)     | Mermaid レンダリング                        | Mermaid から PDF/PNG/JPEG/WebP/AVIF/SVG                                 | npmで`@mermaid-js/mermaid-cli`をグローバル導入するか、`graphics-workbench.execPath.mermaid`を指定 |

### すべての機能を利用する場合

すべての変換機能を利用するには、以下のツールが必要です。

- Draw.io Desktop
- SVG 変換バックエンドのいずれか
  - `rsvg-convert`
  - Google Chrome / Chromium
- Mermaid変換を使う場合は Google Chrome / Chromium と Mermaid CLI (`mmdc`)

### SVG から PDF への変換について

SVG から PDF への変換には、以下のいずれかのツールが必要です。

```text
rsvg-convert または Google Chrome / Chromium
```

環境に応じて利用可能な変換バックエンドを使用してください。

### 外部ツールのインストール例

#### macOS

```sh
brew install librsvg
npm install -g @mermaid-js/mermaid-cli
```

HomebrewはmacOSでの導入例です。拡張機能本体はHomebrewを呼び出さず、各OSの`PATH`または`graphics-workbench.execPath.*`設定から外部ツールを解決します。

Draw.io Desktop は以下からインストールしてください。

[Draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases)

#### Debian / Ubuntu

```sh
sudo apt install librsvg2-bin
npm install -g @mermaid-js/mermaid-cli
```

Draw.io Desktop は以下からインストールしてください。

[Draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases)

#### Windows

以下のツールをインストールし、必要に応じて実行ファイルへのパスを VS Code の設定で指定してください。

- Draw.io Desktop
- Google Chrome / Chromium
- Mermaid CLI (`mmdc`) — `npm install -g @mermaid-js/mermaid-cli`

WindowsではHomebrewを使用せず、各ツールのWindows向け配布物または組織のパッケージマネージャーで導入してください。`rsvg-convert.exe`を`PATH`へ追加するか、VS Codeの設定で実行ファイルのパスを指定します。

## コマンド一覧

| 機能                            | 入力                                                                                                       | 出力                                    | 主な用途                                                 | 必要な外部ツール                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| PDF の余白トリミング            | `.pdf`                                                                                                     | `.pdf`                                  | 図版 PDF の余白を削除（自動 / 設定付き）                 | 不要                                   |
| PDF の分割                      | `.pdf`                                                                                                     | `.pdf`                                  | PDF をページごとに分割（全ページ / 設定付き）            | 不要                                   |
| PDF の結合                      | `.pdf`（複数）                                                                                             | `.pdf`                                  | PDF を1つに結合（選択 / 設定付き）                       | 不要                                   |
| PDF の回転                      | `.pdf`                                                                                                     | `.pdf`                                  | 90° / 180° / 270°でページを回転（クイック / ページ選択） | 不要                                   |
| PDF の並び替え                  | `.pdf`                                                                                                     | `.pdf`                                  | ページ順をインタラクティブに変更                         | 不要                                   |
| PDF の圧縮                      | `.pdf`                                                                                                     | `.pdf`                                  | PDF を再圧縮してサイズ削減                               | 不要                                   |
| PDF の暗号化                    | `.pdf`                                                                                                     | `.pdf`                                  | パスワードで保護                                         | 不要                                   |
| PDF の復号化                    | `.pdf`                                                                                                     | `.pdf`                                  | パスワードを解除                                         | 不要                                   |
| PDF へ変換                      | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`                                         | `.pdf`                                  | ラスター画像を PDF に変換                                | 不要                                   |
| PDF へ変換                      | `.svg`, `.mmd`, `.mermaid`, editable Draw.io 画像                                                          | `.pdf`                                  | 図版ファイルを PDF に変換                                | 入力形式により異なります               |
| 画像を1つのPDFへ結合            | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`                                         | `.pdf`                                  | 複数画像を1つのPDFへ結合                                 | 不要                                   |
| Draw.ioをページごとのPDFへ変換  | `.drawio`, `.dio`, editable Draw.io 画像                                                                   | ページごとのPDF                         | Draw.ioの各ページを個別に出力                            | Draw.io Desktop                        |
| Draw.ioを1つのPDFへ変換         | `.drawio`, `.dio`, editable Draw.io 画像                                                                   | 1つのPDF                                | Draw.ioの全ページをまとめて出力                          | Draw.io Desktop                        |
| PNG へ変換                      | `.pdf`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io 画像 | `.png`                                  | 図版ファイルを PNG に変換                                |                                        |
| JPEG へ変換                     | `.pdf`, `.png`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io 画像          | `.jpeg`                                 | 図版ファイルを JPEG に変換                               |                                        |
| WebP へ変換                     | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io 画像  | `.webp`                                 | 図版ファイルを WebP に変換                               |                                        |
| WebP へ変換（アニメーション）   | `.gif`                                                                                                     | `.webp`                                 | アニメーション保持またはフレーム分割                     | 不要                                   |
| AVIF へ変換                     | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io 画像  | `.avif`                                 | 図版ファイルを AVIF に変換                               |                                        |
| GIF へ変換                      | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io 画像 | `.gif`                                  | 図版ファイルを GIF に変換                                |                                        |
| GIF へ変換（アニメーション）    | `.webp`                                                                                                    | `.gif`                                  | アニメーション保持またはフレーム分割                     | 不要                                   |
| TIFF へ変換                     | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.svg`, Mermaid, editable Draw.io 画像          | `.tiff`                                 | 図版ファイルを TIFF に変換                               |                                        |
| SVG へ変換                      | `.pdf`, `.mmd`, `.mermaid`, editable Draw.io 画像                                                          | `.svg`                                  | 図版ファイルを SVG に変換                                | MermaidはChrome、editable画像はDraw.io |
| Draw.ioファイルの作成           | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, `.mmd`, `.mermaid`     | `.drawio`, `.drawio.png`, `.drawio.svg` | 図版からDraw.ioファイルを作成                            | Draw.io Desktop                        |
| PDF の LaTeX 挿入               | `.pdf`                                                                                                     | LaTeX コード                            | `figure` / `includegraphics` を自動生成                  | 不要                                   |
| クリップボード画像の LaTeX 挿入 | クリップボード画像                                                                                         | 画像ファイル + LaTeX コード             | スクリーンショット等を LaTeX に貼り付け                  | 出力形式により異なります               |

GIF/TIFF入力は先頭page/frameだけを使用します。複数frameが必要な場合はanimation preserve/split commandを使用してください。同じ形式への変換は拒否します。

## 設定

主な設定項目は以下の通りです。

| 設定                                                       | 既定値                                          | 説明                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `graphics-workbench.outputPath.clipboardImage`             | `${fileDirname}/${dateNow}`                     | クリップボード画像を貼り付けるときに表示する既定の保存先です。貼り付け時に編集でき、拡張子は自動で追加されます          |
| `graphics-workbench.insertLatex.pdfTemplate`               | `\begin{figure}[H]...`                          | PDF drag&drop時のLaTeXテンプレート。`${path}` `${name}` `${ext}` `${dir}` を使用可能。配列でsnippet選択肢を指定できます |
| `graphics-workbench.insertLatex.imageTemplate`             | `\begin{figure}[H]...`                          | 画像ペースト時のLaTeXテンプレート。`${path}` `${name}` `${ext}` `${dir}` を使用可能。配列でsnippet選択肢を指定できます  |
| `graphics-workbench.execPath.drawio`                       | 空文字                                          | Draw.io 実行ファイルへのパスです。未指定の場合は OS ごとの既定コマンドを使用します                                      |
| `graphics-workbench.execPath.rsvgConvert`                  | `rsvg-convert`                                  | `rsvg-convert` 実行ファイルへのパスです                                                                                 |
| `graphics-workbench.execPath.chrome`                       | 空文字                                          | mmdcとChrome方式のSVGからPDF変換で使うChrome実行ファイルのパスです。未指定時はOS標準のコマンドまたは場所を使います      |
| `graphics-workbench.execPath.mermaid`                      | `mmdc`                                          | `@mermaid-js/mermaid-cli`の`mmdc`実行ファイルのパスです                                                                 |
| `graphics-workbench.convertToPdf.svg.engine`               | `chrome`                                        | SVGをPDFへ変換するときのバックエンドです。`chrome` または `rsvg-convert` を選択できます                                 |
| `graphics-workbench.outputPath.convertDrawioToPdfDirectly` | `${fileDirname}/${fileBasenameNoExtension}.pdf` | Draw.ioの全ページを1つのPDFへ出力するパスです                                                                           |
| `graphics-workbench.convertToWebp.effort`                  | `4`                                             | WebP出力のエンコードeffortです                                                                                          |
| `graphics-workbench.convertToAvif.effort`                  | `4`                                             | AVIF出力のエンコードeffortです                                                                                          |

出力ファイル名や LaTeX snippet の候補も VS Code の設定から変更できます。

command IDは`convertToPdf`などの出力形式基準ですが、出力先設定は入力形式と出力形式のpairを基準にします。単一出力は`outputPath.convertPngToPdf`などを使い、`${page}`を含む複数出力は`outputPaths` objectの`convertPdfToPng`などを使います。出力形式基準の`outputPath.convertToPdf`とcommand基準の`outputPaths.convertToPdf`は使用しません。

## Output パネル

必要なコマンド入力、外部ツールのエラー、競合解決、確定した出力、cleanup失敗は VS Code の Output パネルで確認できます。バッチの進行状況は通知に表示されます。

```text
表示 → 出力 → Graphics Workbench
```

## 入力サイズと処理時間について

Graphics Workbenchは、入力ファイルサイズやPDFページ数に一律の上限を設けていません。

処理可能な範囲、処理時間、必要なリソースは、入力内容、実行する操作、使用する外部ツール、コンピューターの性能によって異なります。非常に大きな入力では処理時間が長くなったり、メモリ不足・ディスク不足・外部ツールの失敗が発生する可能性があります。

実行中の処理は可能な範囲でキャンセルできます。外部プロセス（Draw.io、Mermaid CLIなど）は終了されますが、処理方式によってはキャンセルの反映に時間がかかる場合があります。

## トラブルシューティング

### コマンドが失敗する

外部ツールがインストールされているか確認してください。

```sh
rsvg-convert --version
```

Windows では、実行ファイル名や PATH の設定によりコマンドが見つからない場合があります。その場合は、VS Code の設定から各ツールの実行ファイルパスを指定してください。

### SVG から PDF への変換に失敗する

設定した変換方式に応じて、`rsvg-convert`または Google Chrome / Chromium が利用可能か確認してください。

### Mermaid ファイルの変換に失敗する

Google Chrome / Chromium と Mermaid CLI (`mmdc`) が利用可能か確認してください。`@mermaid-js/mermaid-cli`をnpmでグローバル導入するか、`graphics-workbench.execPath.mermaid`に実行ファイルのパスを指定してください。必要に応じて `graphics-workbench.execPath.chrome` に実行ファイルのパスを指定してください。

### editable Draw.io 画像の変換に失敗する

Draw.io Desktop がインストールされているか確認してください。必要に応じて `graphics-workbench.execPath.drawio` に実行ファイルのパスを指定してください。

## ライセンス

GNU AGPL v3 or later (AGPL-3.0-or-later)
