# 変換入力job validationの内部契約

## 目的

変換操作を開始する前に、jobの形式・path・file状態を検査し、実行不能なjobで変換や出力commitを開始しない。validationは入力ファイルを変更しない。

## 原則

- 入力段階では安価なjob/path validationだけを行う。
- 形式固有の妥当性は実際の変換backendが判定する。
- 生成物はcommit前に出力形式として検証する。
- 変換または生成物検証に失敗したbatchは一切commitしない。
- preflightを通過しても、生成物はcommit前に出力形式として再検証する。

## 検査内容

すべての入力で次を確認する。

| ID  | 検査                                       | 失敗時 |
| --- | ------------------------------------------ | ------ |
| C1  | 対応するsource formatとして判定できる      | error  |
| C2  | fileが存在し、statとreadが可能             | error  |
| C3  | regular fileである                         | error  |
| C4  | 0 byteではない                             | error  |
| C5  | Raw入力のsidecarが存在し、byte長が一致する | error  |

C5はpreflight内で行い、形式固有のparseは行わない。

## 除外された検査

形式固有の深い検査（PDF header/parse/暗号化/page count、Raster画像のSharp metadata/dimensions、SVGのXML parse/root、Mermaid/Draw.ioの文字列検査、EPSのPostScript header/BoundingBox）は削除した。これらの検査は変換backend（pdf-lib、Sharp、rsvg-convert、Puppeteer、Mermaid CLI、Draw.io CLI、Ghostscript）が実行し、失敗時はbackendのエラーとして利用者に伝達する。

## Batch flow

```text
command
  ├─ operation固有のjob/path validation
  ├─ preflightを入力順で実行（同時実行数2）
  │   ├─ errorあり    → path付きerrorで停止
  │   └─ 全件ok       → 続行
  ├─ stagingへ変換
  ├─ 生成形式を検証
  └─ conflict判断後にcommit
```

## Cancellation

- 開始時にcancel済みならvalidatorを起動しない。
- cancel後はqueue済みvalidatorを開始しない。
- 実行中validatorが返った後にもsignalを再確認する。
- cancel時は変換を開始しない。

## Output channel

各入力について最低限次を記録する。

```text
[preflight] <source path>: <ok|error> — <reason>
```

operationがOutput channelを持つ場合、preflightへ同じchannelを渡す。ユーザー向けerrorには失敗した入力pathを含める。

## 生成物検証との境界

preflightは入力の軽量検査であり、外部toolのexit code 0を成果物の正しさとはみなさない。

- PDFはparse可能、1page以上、page boxが有限かつ正寸法であること。
- SVGは空でなく、SVG rootを含むこと。
- rasterはSharp encoder / decoderが成功すること。
- commit前検証に失敗した場合、final outputを反映しない。

## 対象外

- 入力fileの自動修復
- password入力UI
- 拡張子の自動変更
- 壊れた内容を別formatとして推測して処理すること

## 関連

- [出力形式基準の変換仕様](output-format-conversion.md)
- [ファイル操作security仕様](file-operation-security.md)
- [EPS変換の内部契約](eps-conversion.md)
