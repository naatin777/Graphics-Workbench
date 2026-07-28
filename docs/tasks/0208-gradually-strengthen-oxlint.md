# 0208: oxlintの制限を段階的に強化する

Status: In progress — Phase 1

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

## Baseline

- `npm run lint` は変更前に成功
- `eqeqeq`、`no-console`、`typescript/consistent-type-imports` をerrorとして試行しても既存違反なし
- `suspicious`カテゴリ全体をerrorにすると、型アサーション、配列sort、importなどの既存違反が多数あるため、Phase 1では有効化しない

## Completion criteria

- Phase 1の4制限をCIの通常lintで強制できる
- 既存の型チェック、format、テスト、buildを壊さない
- 次に強化する候補と既存違反をtaskへ記録する

## Follow-up

次のphaseでは、対象ディレクトリまたはルール単位で既存違反を小さく解消し、`suspicious`カテゴリと型安全ルールを段階的にerrorへ移す。違反が多いルールを一括有効化しない。
