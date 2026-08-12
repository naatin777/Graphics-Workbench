# ADR-0009: 変換コマンドは出力形式基準で公開する

## Status

Accepted

## Context

現在の変換コマンドは、`PNGをPDFに変換`、`SVGをPDFに変換`、`PDFをPNGに変換`のように、入力形式と出力形式の組み合わせごとに公開されている。

この方式では、対応形式が増えるほどcontext menuとCommand Paletteの項目が増える。

また、複数の異なる入力形式を同じ出力形式へ変換したい場合でも、入力形式ごとに別コマンドを実行する必要がある。

## Decision

公開する変換コマンドは、出力形式基準にする。

例:

- `PDFに変換`
- `PNGに変換`
- `JPEGに変換`
- `WebPに変換`
- `AVIFに変換`
- `SVGに変換`

既存の入力形式・出力形式ペア別コマンドは、公開UIから外す。

旧command IDの互換aliasは実装しない。現行の公開command集合だけをmanifestとruntime bindingへ登録する。

## Consequences

- context menuの項目数を減らせる
- 異なる入力形式を同じ出力形式へまとめて変換できる
- command実行時に、選択された全ファイルが対象出力形式へ変換可能か検証する必要がある
- 旧command IDをkeybindingsやtasksで直接呼んでいるユーザーは、新command IDへ移行する必要がある
- 出力パス設定は、operationの`single`／`split`／`combine`出力モデルに対応する設定を使う
- Safe Mode、Undo、Progress、Cancellationは、1回の出力形式基準コマンド実行を1つの変換バッチとして扱う
- 対応形式の追加や変更は、manifest、binding、planner、testsを同じ公開command契約として更新する

## Related

- [`docs/specs/product/output-format-conversion.md`](../specs/product/output-format-conversion.md)
- [`docs/architecture.md`](../architecture.md)
- [`docs/safety.md`](../safety.md)
