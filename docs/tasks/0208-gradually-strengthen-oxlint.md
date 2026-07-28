# 0208: oxlintの制限を段階的に強化する

Status: In progress — Phase 5

## Objective

既存コードを一度に大量修正せず、oxlintの制限を段階的に強化する。各段階で現在の違反を基準化し、新しい違反だけを止められる状態を作る。

## Scope

- 警告で運用している既存ルールのうち、現行違反がないものをerrorへ昇格する
- 未使用のlint抑制コメントをerrorとして検出する
- `suspicious`カテゴリ全体や、現行違反が多い型安全ルールは後続phaseで扱う

## Phase 1

次の制限をerrorへ強化する。

- `eqeqeq`
- `no-console`
- `typescript/consistent-type-imports`
- `reportUnusedDisableDirectives`

`test`、設定ファイル、ビルド用スクリプトなど既存の明示的な例外は維持する。

Phase 1はPR #16でmainへ反映済み。

## Phase 2

`unicorn/no-array-sort`をerrorへ強化する。既存の11箇所はNode.js 22で利用できる`toSorted()`へ置き換え、配列の破壊的変更を避ける。

## Phase 3

`typescript/no-unnecessary-type-assertion`をerrorへ強化する。既存の78箇所から不要な非nullアサーションと型アサーションを削除し、型がすでに保証されている箇所での重複した保証をなくす。

## Phase 4

`typescript/no-unsafe-argument`をerrorへ強化する。既存の27箇所でanyのまま関数や外部APIへ渡していた値に型注釈または実行時検証を追加し、型安全な引数だけを渡す。

## Phase 5

`typescript/no-unsafe-type-assertion`をerrorへ強化する。既存の59箇所を、JSON/XML/API境界の実行時検証、テンプレートsuffixの型ガード、型付きのVS Codeテストダブルへ置き換える。

Mermaid CLIのthemeだけは、無効値をCLIへ渡してCLI自身に検証させる既存仕様と、依存パッケージの狭いtheme型が一致しないため、理由を明記した行単位の抑制を残す。

## Baseline

- `npm run lint` は変更前に成功
- `eqeqeq`、`no-console`、`typescript/consistent-type-imports` をerrorとして試行しても既存違反なし
- `unicorn/no-array-sort` の既存違反は11件で、スクリプトとテストに限定されていた
- `typescript/no-unnecessary-type-assertion` の既存違反は78件で、主にテストコードの不要な非nullアサーションだった
- `typescript/no-unsafe-argument` の既存違反は27件で、型注釈のないNode.jsスクリプト、外部API境界、テストstubに分散していた
- `typescript/no-unsafe-type-assertion` の既存違反は59件で、JSON/XML解析結果、出力拡張子、VS Code APIのテストダブル、動的importに分散していた
- `typescript/no-unsafe-return` は既存違反22件だったが、Vitest/Solidの型と`.toSorted()`に依存する誤検知が含まれるため、Phase 5の対象にしなかった
- `suspicious`カテゴリ全体をerrorにすると、型アサーション、配列sort、importなどの既存違反が多数あるため、Phase 1では有効化しない

## Completion criteria

- Phase 1からPhase 5までの制限をCIの通常lintで強制できる
- 既存の型チェック、format、テスト、buildを壊さない
- 次に強化する候補と既存違反をtaskへ記録する

## Follow-up

次のphaseでは、対象ディレクトリまたはルール単位で既存違反を小さく解消し、`suspicious`カテゴリと残る型安全ルールを段階的にerrorへ移す。違反が多いルールを一括有効化しない。
