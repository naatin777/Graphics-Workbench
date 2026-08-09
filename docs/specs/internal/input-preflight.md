# 入力validationの責務

## 決定

汎用的なinput preflightは行わない。

入力が壊れているか、実際の形式として読み取れるかは、変換時にその入力を開くdecoderまたは外部toolが判定する。変換backendがthrowした場合はconversion lifecycleが失敗として扱い、stagingをcleanupしてfinal outputをcommitしない。

## 理由

従来のpreflightは、対応拡張子、`stat`、regular file、0 byte、Raw byte長を変換前に別処理で確認していた。しかし、preflightを通過しても形式固有の破損は判定できず、実変換側のerror handlingは必ず必要だった。

同じ入力を事前検査と実変換で二重に扱う代わりに、入力の妥当性判定を実際のreaderへ集約する。

## 責務

### command / job planning

- 選択されたURIとsource formatから対応するoperationを決定する。
- output pathを解決する。
- 明らかに未対応の入力形式はjob生成時に拒否する。

### workspace path boundary

- source、output、staging、sidecarがworkspace外へ逸脱しないことを確認する。
- symlinkを含む実pathの境界確認は`src/security/workspace_path.ts`が担当する。
- これは入力内容のpreflightではなくfile operation securityである。

### decoder / external tool

- PDFはMuPDFまたはpdftocairoなど実際に使用するbackendが読み取る。
- raster入力はSharpが読み取る。
- SVG、Mermaid、Draw.ioは各rendererまたは外部toolが処理する。
- backend errorは入力pathとoperation contextを保ったまま上位へ伝播する。

### output lifecycle

- 変換はstaging内で行う。
- 1件でも変換または生成物検証に失敗したbatchはfinal outputをcommitしない。
- 失敗時はstaging artifactをcleanupする。

## Flow

```text
command
  ├─ job / source format / output pathを解決
  ├─ workspace path boundaryを確認
  ├─ staging内で実変換
  │   ├─ decoderまたは外部toolが入力を読めない → throw
  │   └─ 変換成功                         → 続行
  ├─ 生成物を検証
  └─ conflict判断後にcommit
```

## Cancellation

conversion lifecycleの`AbortSignal`を使用する。入力専用のvalidator queueやpreflight進捗は持たない。

## Output channel

`[preflight]`形式の入力別ログは出力しない。実変換を担当したoperationまたはexternal tool adapterが、tool名、引数、stderr、入力contextを記録する。

## 対象外

- 入力fileの自動修復
- password入力UI
- 拡張子の自動変更
- 壊れた内容を別formatとして推測して処理すること

## 関連

- [出力形式基準の変換仕様](output-format-conversion.md)
- [ファイル操作security仕様](file-operation-security.md)
