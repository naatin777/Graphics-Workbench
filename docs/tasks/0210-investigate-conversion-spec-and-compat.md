# 0210: 変換機能と出力パス設定の仕様調査・互換コード削減

Status: Done — 調査完了と後続実装の一部を実施

## Objective

未リリース段階のGraphics Workbenchについて、変換機能と出力パス設定を調査し、不要な互換コード・重複実装を特定する。削除は「コードが似ている」だけを理由にせず、製品仕様・現在の実装・互換性維持コード・単なる実装重複の4種類へ分類した上で提案する。

本taskは調査フェーズの成果物（A〜E）を記録する。実装は各項目を独立phaseとして後続で行う。

## 実装進捗（調査完了時点からの実施分）

調査で洗い出した項目のうち、以下の実装を実施済み。未実施項目は `docs/refactor-backlog.md` と [E. 変更計画](#e-変更計画) に残る。

| 項目      | 内容                                                                                     | 実施                                                                                 |
| --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| B-1 #1    | convertToPdfのGIF/TIFF/EPS入力宣言が到達不能                                             | 修正（GIF/TIFF/EPS→PDFのテンプレ分岐を追加）。RAWはB-3 #11とともに形式ごと削除       |
| B-1 #2    | convertToWebpのGIFアニメーション分岐が到達不能                                           | 修正（preserve/splitを含むGIF→WebP分岐を追加）                                       |
| B-1 #3/#5 | EPSのDraw.io入力計画（native .drawio到達不能 + editableのconvertPngToEpsフォールバック） | 修正（native .drawioは明示拒否、editableは専用 `outputPaths.convertDrawioToEps` へ） |
| B-2 #6    | 単一出力ペア15個のplural `outputPaths` 二重キー                                          | 削除（flat `outputPath.convertXToY` を正本に統一）                                   |
| B-2 #7    | Orphan NLSキー（旧pair-specific commandタイトル等）                                      | 削除                                                                                 |
| B-5       | GIF/TIFF/EPS→JPEG/AVIF/EPS/WebP等のルーティング・コマンドテスト                          | 追加（compressPdf、convertToDrawioコマンド層含む）                                   |
| B-3 #11   | RAW変換のmixed入力設定                                                                   | RAW形式を削除したため解消                                                            |

未実施（今後の課題）: B-3 #8（convertToDrawioの出力形式固定）、B-3 #9（auto/preserve同一実装）、B-3 #10（Draw.io→ラスターのpage 1のみ）、B-3 #12（preserve/splitコマンド実行テスト）、D-1（planner共通化）、D-2（manifest整合性自動検証）

---

## A. 現行仕様マップ

### A-1. 公開コマンド（30 = 29公開 + 1内部）

| コマンドID                                                       | 種別                                         | 実装ファイル                                             |
| ---------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| cropPdf.auto / cropPdf.configure                                 | PDF crop                                     | src/commands/pdf/crop_pdf_auto.ts, crop_pdf_configure.ts |
| splitPdf.allPages / splitPdf.configure                           | PDF split                                    | src/commands/pdf/split_pdf_commands.ts                   |
| mergePdf.selectedFiles / mergePdf.configure                      | PDF merge                                    | src/commands/pdf/merge_pdf.ts                            |
| compressPdf                                                      | PDF compress                                 | src/commands/pdf/compress_pdf.ts                         |
| convertToPdf                                                     | 各形式→PDF                                   | src/commands/conversion/convert_to_pdf.ts                |
| convertDrawioToPdf / convertDrawioToPdfDirectly                  | Draw.io→ページ別PDF / 単一PDF                | src/commands/conversion/convert_drawio_to_pdf.ts         |
| convertToPng / Jpeg / Webp / Avif / Svg / Gif / Tiff / Eps / Raw | 各形式→各出力                                | src/commands/conversion/convert_to_*.ts                  |
| convertToWebpPreserveAnimation / convertToWebpSeparately         | GIF→WebP（保持/分割）                        | convert_to_webp.ts (outputMode)                          |
| convertToGifPreserveAnimation / convertToGifSeparately           | WebP→GIF（保持/分割）                        | convert_to_gif.ts (outputMode)                           |
| convertToDrawio / convertToDrawioPng / convertToDrawioSvg        | 各形式→Draw.io / editable PNG / editable SVG | src/commands/conversion/convert_to_drawio.ts             |
| convertImagesToSinglePdf                                         | 複数画像→1PDF                                | src/commands/conversion/combine_images_to_pdf.ts         |
| undoLastConversion / toggleSafeMode                              | ライフサイクル                               | commands/lifecycle/                                      |
| convertPngToPdf（内部）                                          | PNG→PDF                                      | convert_to_pdf.ts (internal command)                     |

### A-2. 変換マトリクス

表の`判定`は後述Bの分類に対応。`到達`はcommand→operationの実コードパスを確認した結果。

| 入力                     | 出力                                    | モード             | 入力数 | 出力数      | 出力設定キー                                    | `${page}`      | command到達 | operation対応 | テスト      | 判定                                  |
| ------------------------ | --------------------------------------- | ------------------ | ------ | ----------- | ----------------------------------------------- | -------------- | ----------- | ------------- | ----------- | ------------------------------------- |
| PDF                      | PNG/JPEG/WebP/AVIF/SVG/GIF/TIFF/EPS     | 通常               | 1      | N(ページ)   | outputPaths.convertPdfToX                       | 必須           | 可          | 可            | あり        | 仕様どおり                            |
| PNG                      | JPEG/WebP/AVIF/TIFF/EPS/GIF/RAW         | 通常               | 1      | 1           | outputPath.convertPngToX                        | 不要           | 可          | 可            | 一部あり    | 仕様どおり（テスト不足）              |
| JPEG                     | PNG/WebP/AVIF/TIFF/EPS/GIF/RAW          | 通常               | 1      | 1           | outputPath.convertJpegToX                       | 不要           | 可          | 可            | 一部        | 仕様どおり（テスト不足）              |
| WebP                     | PNG/JPEG/AVIF/TIFF/EPS/GIF/RAW          | 通常               | 1      | 1           | outputPath.convertWebpToX                       | 不要           | 可          | 可            | 一部        | 仕様どおり（テスト不足）              |
| AVIF                     | PNG/JPEG/WebP/TIFF/EPS/GIF/RAW          | 通常               | 1      | 1           | outputPath.convertAvifToX                       | 不要           | 可          | 可            | 一部        | 仕様どおり（テスト不足）              |
| GIF                      | WebP                                    | 保持(preserve)     | 1      | 1           | outputPath.convertGifToWebp                     | 不要           | **不可**    | 可            | なし        | **command側実装漏れ（.gif分岐なし）** |
| GIF                      | WebP                                    | 分割(split)        | 1      | N(フレーム) | outputPath.convertGifToWebp                     | 必要           | **不可**    | 可            | なし        | **command側実装漏れ**                 |
| GIF                      | PNG/JPEG/AVIF/TIFF/EPS/RAW              | 先頭フレーム       | 1      | 1           | outputPaths/convertGifToX                       | 不要           | 可          | 可            | 一部        | 仕様どおり                            |
| WebP                     | GIF                                     | 保持(preserve)     | 1      | 1           | outputPath.convertWebpToGif                     | 不要           | 可          | 可            | なし        | 仕様どおり（テスト不足）              |
| WebP                     | GIF                                     | 分割(split)        | 1      | N(フレーム) | outputPath.convertWebpToGif                     | 必要           | 可          | 可            | なし        | 仕様どおり（テスト不足）              |
| WebP                     | PNG/JPEG/AVIF/TIFF/EPS/RAW              | 先頭フレーム       | 1      | 1           | outputPath.convertWebpToX                       | 不要           | 可          | 可            | 一部        | 仕様どおり                            |
| TIFF                     | PNG/GIF                                 | 先頭ページ         | 1      | 1           | outputPaths.convertTiffToX                      | 不要           | 可          | 可            | あり        | 仕様どおり                            |
| TIFF                     | JPEG/WebP/AVIF/EPS/RAW                  | 先頭ページ         | 1      | 1           | outputPath.convertTiffToX                       | 不要           | 可          | 可            | 一部        | 仕様どおり（テスト不足）              |
| SVG                      | PNG/JPEG/WebP/AVIF/TIFF/EPS/GIF         | 通常               | 1      | 1           | outputPath.convertSvgToX                        | 不要           | 可          | 可            | 一部        | 仕様どおり                            |
| SVG                      | PDF                                     | 通常               | 1      | 1           | outputPath.convertSvgToPdf                      | 不要           | 可          | 可            | あり        | 仕様どおり                            |
| Mermaid                  | SVG/PNG/JPEG/WebP/AVIF/TIFF/EPS/GIF/PDF | 通常               | 1      | 1           | outputPath.convertMermaidToX                    | 不要           | 可          | 可            | 一部        | 仕様どおり                            |
| Draw.io(ネイティブ)      | PNG/JPEG/WebP/AVIF/GIF/TIFF/SVG         | 通常               | 1      | 1           | outputPaths.convertDrawioToX                    | 不要           | 可          | 可            | 一部        | 仕様どおり（page1のみ）               |
| Draw.io(ネイティブ)      | PDF                                     | ページ別           | 1      | N(ページ)   | outputPaths.convertDrawioToPdf                  | 必要(ページ名) | 可          | 可            | あり(3出力) | 仕様どおり                            |
| Draw.io(ネイティブ)      | PDF                                     | 単一               | 1      | 1           | outputPath.convertDrawioToPdfDirectly           | 不要           | 可          | 可            | あり        | 仕様どおり                            |
| Draw.io(ネイティブ)      | PDF                                     | 通常(convertToPdf) | 1      | 1           | —                                               | 不要           | **不可**    | **不可**      | なし        | **manifest/command不一致**            |
| Draw.io(ネイティブ)      | EPS                                     | 通常               | 1      | 1           | outputPath.convertPngToEps                      | 不要           | 可          | **不可**      | なし        | **operation側実装漏れ**               |
| editable Draw.io PNG/SVG | 各出力                                  | 通常               | 1      | 1           | outputPaths.convertDrawioToX / convertPngToEps  | 不要           | 可          | 可            | 一部        | 仕様どおり                            |
| EPS                      | PNG/JPEG/WebP/AVIF/SVG/PDF              | 通常               | 1      | 1           | outputPath.convertXToY                          | 不要           | 可          | 可            | あり        | 仕様どおり                            |
| RAW                      | PNG                                     | 通常               | 1      | 1           | outputPath.convertRawToPng                      | 不要           | 可          | 可            | あり        | 仕様どおり                            |
| ラスター                 | RAW                                     | 通常               | 1      | 1(+.json)   | outputPaths.convertXToRaw                       | 不要           | 可          | 可            | PNGのみ     | 仕様どおり（テスト不足）              |
| 複数ラスター             | PDF(結合)                               | 結合               | N      | 1           | outputPath.convertImagesToSinglePdf             | 不要           | 可          | 可            | あり        | 仕様どおり                            |
| ラスター/SVG/EPS         | Draw.io                                 | 結合               | N      | 1           | outputPath.convertToDrawio                      | 不要           | 可          | 可            | あり        | 仕様どおり                            |
| PDF                      | ページ別PDF(split)                      | 分割               | 1      | N           | outputPath.splitPdf                             | 必須           | 可          | 可            | あり        | 仕様どおり                            |
| PDF                      | PDF(crop/compress/merge)                | 通常               | 1..N   | 1           | outputPath.cropPdf/compressPdf / 保存ダイアログ | 不要           | 可          | 可            | あり        | 仕様どおり                            |

### A-3. 出力パス設定の2系統

- 単一出力（`${page}`なし）: flat `outputPath.convertXToY`（ADR-0021正本）
- 複数出力（`${page}`あり）: plural `outputPaths.convertXToY`（ADR-0021正本）
- 二重存在: 15キー（convertPngToWebp, convertGifToPng, convertGifToTiff など単一出力ペア）が**両方**に存在し、コードはplural優先で読む（`read_output_path_or_paths_template.ts`）→ ADR-0021と矛盾
- `outputPath.convertToY`（形式基準）と`outputPaths.convertToY`はADR-0021で不使用と定められている（manifestには存在しない）

---

## B. 不一致一覧

### B-1. manifest/command宣言と到達可能性の不一致

| #   | 不一致                                                                                                                                                                                                                                            | 根拠                                                | 分類                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| 1   | **convertToPdfがGIF/TIFF/EPS/RAWを宣言するが到達不能**。`pdfImageExtensions`(.gif/.tif/.tiff/.eps/.raw)はsupportedExtensionsに含まれるが、`outputTemplateForSource`(convert_to_pdf.ts:187-240)に分岐がなく「Unsupported PDF input format」でthrow | convert_to_pdf.ts:41-59, 187-240                    | manifest/command側の実装漏れ（到達不能）                        |
| 2   | **convertToWebpのGIF→WebPアニメーション保存分岐が到達不能**。`.gif`にテンプレ分岐がなく、`outputTemplateForSource`が先にthrow。`convertToWebpPreserveAnimation`/`Separately`コマンドが実質無効                                                    | convert_to_webp.ts:158-177, outputTemplateForSource | command側の実装漏れ（到達不能）                                 |
| 3   | **EPSのDraw.io→EPS計画がoperationで拒否**。commandがdrawio入力をplanするが、operation `validateJobs`(convert_to_eps.ts:247)が`.drawio`を拒否                                                                                                      | convert_to_eps.ts command:94-111, operation:247     | operation側の実装漏れ（到達不能）                               |
| 4   | **convertToPdfがnative `.drawio`未対応**。`writeSourceAsPdf`(convert_to_pdf.ts:273-276)はeditable drawio画像のみ対応。native .drawioはmanifest上「PDF変換」対象に見えるが到達不能                                                                 | convert_to_pdf.ts:273-276                           | 仕様未確定（native drawio→PDFはconvertDrawioToPdf系が正式経路） |
| 5   | **EPSのdrawio入力が`outputPath.convertPngToEps`を代用**。専用設定がない場当たり的フォールバック                                                                                                                                                   | convert_to_eps.ts command:143-149                   | 専用設定がないための場当たり的フォールバック（削除対象）        |

### B-2. 設定とADRの不一致

| #   | 不一致                                                                                                                                                         | 根拠                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 6   | **15個の単一出力ペアがplural `outputPaths`とflat `outputPath.*`に二重存在**し、コードはplural優先。ADR-0021では単一出力=flat正本のため、plural側は旧互換の残骸 | read_output_path_or_paths_template.ts:4-19, generated-extension-meta.ts |
| 7   | `outputPath.convertDrawioToPdf`（flat）がNLSで定義されるが実体なし（convertDrawioToPdfはpluralのみ）                                                           | package.nls.json:22                                                     |

### B-3. 仕様未確定（設計判断が必要）

| #   | 論点                                                                                                                                                                     | 現在の実装                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 8   | _*convertToDrawio* 3コマンドが全6拡張子を許可し、出力パス拡張子で形式を切り替え_*。`convertToDrawioCommand`が`.drawio.png`を出力できる。出力形式をコマンドが固定すべきか | convert_to_drawio.ts:18, 79, 118-128, 220-229         |
| 9   | **GIF/WebPのautoとpreserveが同一実装**。`outputMode !== 'split'`のみが分岐条件。preserveコマンドの存在意義は仕様次第                                                     | convert_to_gif.ts:122-140, convert_to_webp.ts:158-177 |
| 10  | **Draw.io→ラスターがpage 1のみ**（drawio→PDFは全ページなのに）。ユーザー仕様としてpage別ラスターが必要か                                                                 | raster_conversion.ts:264                              |
| 11  | **RAW変換のmixed入力で先頭ファイルの拡張子で全入力の設定を決定**。per-file設定にすべきか                                                                                 | convert_to_raw.ts:30-31                               |
| 12  | GIF/WebPの`preserve`/`split`コマンドがmanifestに存在するが、コマンドとして実行するテストが皆無                                                                           | test（B-5参照）                                       |

### B-4. コマンド名と実際の出力形式

| #   | 不一致                                                                                                                                          | 根拠                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 13  | `convertToDrawioCommand`はデフォルトで`.dio`（XML）を出力するが、出力パスを`.drawio.png`等に変えればPNGになる。コマンド名が出力形式を保証しない | convert_to_drawio.ts:118-128 |

### B-5. テストで未検証の仕様

- **到達不能と判定された経路**（B-1 #1-3）のテストは存在しない（実装されていないため）
- GIF→WebP（preserve/split）、WebP→GIF（preserve/split）のコマンド実行テストが皆無
- `compressPdf`コマンド全体にテストなし
- `convertToDrawio*`コマンド層テストなし（operationはconvert_to_drawio.test.tsでカバー）
- ラスター系→GIF/TIFF/EPS/RAWの大半がテスト不足（PDF→EPS、PNG→RAWのみあり）
- flat `outputPath.*`の非Pngペア（convertSvgToPdf等）の実行時テストなし
- 15個の二重キー（plural `outputPaths`）の設定優先度を検証するテストなし

---

## C. 削除候補

### 確実に削除可能

```text
対象: convertToPdfの入力宣言から .gif/.tif/.tiff/.eps/.raw を除外（B-1 #1）
分類: 到達不能（仕様・テスト・ドキュメントにも存在しない）
削除しても失われない仕様: なし（そもそも変換できない）
削除によって消える現在の挙動: 「Unsupported PDF input format」エラーのみ
その挙動が正式仕様ではない根拠: pdfImageExtensionsに宣言されているが、テンプレ分岐がなく変換は常に失敗（実装から観測）
参照箇所: src/commands/conversion/convert_to_pdf.ts:41-59, 187-240
必要な代替実装: なし。将来GIF/TIFF→PDFを実装する場合はテンプレ分岐も同時に追加する
```

```text
対象: convertToWebpのGIFアニメーション保存分岐（B-1 #2）
分類: 到達不能
削除しても失われない仕様: なし（`.gif`はテンプレ分岐がないため常にthrow）
削除によって消える現在の挙動: なし（到達しないコード）
その挙動が正式仕様ではない根拠: outputTemplateForSourceに`.gif` caseがない（実装から観測）
参照箇所: src/commands/conversion/convert_to_webp.ts:158-177, outputTemplateForSource
必要な代替実装: GIF→WebPを正式対応する場合は `.gif` のテンプレ分岐を追加。preserve/splitコマンドを実効化するかは仕様判断（B-3 #9）に依存
```

```text
対象: EPSのDraw.io入力計画（B-1 #3, #5）
分類: 到達不能 + 場当たり的フォールバック（outputPath.convertPngToEpsを代用）
削除しても失われない仕様: なし（operationが拒否するため変換できない）
削除によって消える現在の挙動: commandのplan内でdrawio入力を生成する処理
その挙動が正式仕様ではない根拠: operation validateJobsが.drawioを拒否（実装から観測）
参照箇所: src/commands/conversion/convert_to_eps.ts:94-111, src/operations/conversion/convert_to_eps.ts:247
必要な代替実装: Draw.io→EPSを正式対応する場合は専用出力設定を追加
```

```text
対象: Orphan NLSキー（command.convertXxxToYyyタイトル群, config.outputPath.convertDrawioToPdf）
分類: 未使用
削除しても失われない仕様: なし
削除によって消える現在の挙動: なし（参照されない）
その挙動が正式仕様ではない根拠: package.json/コードに参照がない（複数箇所の整合性から推定）
参照箇所: package.nls.json:22, 87-97, 119-143
必要な代替実装: なし
```

### 仕様確認後に削除可能

```text
対象: 15個の単一出力ペアの plural `outputPaths` エントリ（B-2 #6）
分類: 旧互換（ADR-0020のplural優先を維持した残骸）
削除しても失われない仕様: flat `outputPath.convertXToY`がADR-0021の正本。単一出力の粒度は不変
削除によって消える現在の挙動: `outputPaths.convertGifToPng`等の設定値が無視されるようになる
その挙動が正式仕様ではない根拠: ADR-0021で単一出力=flat正本と明記。コードのplural優先はADR-0020（置き換え済み）の名残（仕様書に明記）
参照箇所: read_output_path_or_paths_template.ts:4-19, generated-extension-meta.ts
必要な代替実装: resolverを単一出力=flatのみに簡素化。移行に既存設定が残る場合は一時的な読取維持が安全
```

```text
対象: convertToDrawio*の全拡張子許可（B-3 #8, B-4 #13）
分類: 実装が過度に自由
削除しても失われない仕様: コマンドが出力形式を決める（convertToPng等と同原則）
削除によって消える現在の挙動: convertToDrawioで.drawio.pngを出力する行為
その挙動が正式仕様ではない根拠: 他のconvertTo*はコマンド=出力形式を固定している（実装から観測の比較）
必要な代替実装: 各コマンドのallowedOutputExtensionsを固定（convertToDrawio=.drawio/.dio, convertToDrawioPng=.drawio.png/.dio.png, convertToDrawioSvg=.drawio.svg/.dio.svg）
```

```text
対象: GIF/WebPのpreserve/splitコマンド（B-3 #9, #12）
分類: 仕様未確定（auto==preserveが同一実装）
削除しても失われない仕様: 「アニメーション保持」と「フレーム分割」のユーザー操作（これを仕様とする場合）
削除によって消える現在の挙動: コマンド自体
その挙動が正式仕様ではない根拠: 未確定。autoとpreserveが同一コードパス（実装から観測）
必要な代替実装: 仕様を決めてから。保持と分割を別操作として残すならautoを廃しpreserve/splitへ明確化。分割不要ならsplitのみ
```

```text
対象: RAW変換の先頭ファイル拡張子による設定決定（B-3 #11）
分類: 仕様未確定
削除しても失われない仕様: 入力ごとに正しいconvertXToRaw設定
削除によって消える現在の挙動: mixed入力で全入力が先頭ファイルの設定を使う
その挙動が正式仕様ではない根拠: 実装から観測。仕様書に明記なし
必要な代替実装: per-fileで各入力の拡張子に対応する設定を選択
```

### 削除してはいけない

- workspace外出力拒否、出力拡張子検証、staging、commit/rollback、上書きバックアップ、Windowsの非ASCIIパス・rename対策、複数出力パス衝突防止、`.jpg`/`.jpeg`・`.tif`/`.tiff`、キャンセル処理、外部ツール失敗時クリーンアップ（安全・環境差対応）
- 複数出力の`outputPaths`キー（pdf→*, drawio→*, →raw）。ADR-0021で正本

---

## D. 共通化案

機能を削らず、実装だけを共通化する。

### D-1. 変換定義の一元管理

```ts
interface ConversionDefinition {
  source: SourceFormat;
  target: TargetFormat;
  mode: ConversionMode; // 'default' | 'preserve' | 'split'
  cardinality: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  outputPathSetting: string; // outputPath.convertXToY or outputPaths.convertXToY
  allowedOutputExtensions: readonly string[];
  pageVariable: 'forbidden' | 'optional' | 'required';
}
```

- 入力形式判定・同一形式拒否・出力設定キー選択・出力拡張子検証・`${page}`必須判定をこの定義から導出
- 既存の`createRasterFrameJobs`・PDFページ計画・Draw.ioページ名計画はこの定義の消費側にする
- 処理方式が異なるPDF/SVG/EPS/Draw.io/ラスターのoperationは維持（1関数へ押し込まない）

### D-2. 整合性自動検証

- 変換定義に存在する組み合わせだけがメニューへ表示される（manifest when条件の生成）
- 公開コマンドに対応する変換定義がある
- 変換定義に出力パス設定がある
- 1入力→複数出力では`${page}`必須
- commandが宣言する入力はoperationまで到達できる
- operationが対応する公開形式はcommandから到達できる
- 出力形式と許可拡張子が一致
- 全公開変換に最低1件のplannerテスト、単一/複数出力ペアはそれぞれ別テスト
- 上記をCIで検証（Bの不一致を再発させない）

---

## E. 変更計画

1つの巨大変更にせず、独立してmainへマージ可能な単位へ分ける。

1. **変換マトリクスとテスト追加** — 現状の仕様を固定するテスト（特にB-5の未検証経路を可能な範囲で追加）
2. **到達不能ブランチの整理** — B-1 #1〜#3（convertToPdfのGIF/TIFF/EPS/RAW宣言、convertToWebpのGIF分岐、EPSのdrawio計画）を削除
3. **旧出力設定フォールバック削除** — 15個の単一出力pluralエントリと`read_output_path_or_paths_template`の簡素化（ADR-0021へ整合）
4. **単一/複数出力設定の明確化** — convertToDrawio*の形式固定（B-3 #8）、RAW per-file化（B-3 #11）
5. **planner共通化** — 変換定義（D-1）の導入
6. **manifest整合性自動検証** — D-2
7. **形式別commandの薄いラッパー化** — 変換定義からcommandの入力判定・設定選択を導出

各phaseの実施可否と優先度はmaintainer判断による。特にB-3の仕様未確定項目（#8〜#12）は実装前に仕様を確定する。

---

## 検証と報告の注意

各結論の根拠は「仕様書に明記」「テストで保証」「実装から観測」「複数箇所の整合性から推定」のいずれかを明記した。本taskの調査はコード変更を伴わないため、lint/typecheck/testの実行は不要（変更発生時に実施する）。
