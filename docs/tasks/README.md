# Tasks

## Current Task

現在のタスクは [CURRENT.md](CURRENT.md) を参照する。ユーザーから明示的な依頼がある場合はそちらを優先する。

## On hold

- [0208: oxlintの制限を段階的に強化する](0208-gradually-strengthen-oxlint.md) — Phase 59（バグ検出ルール群）Done、次phaseは保留

## Task boundaries

Taskは小さな作業手順やPR単位ではなく、達成する成果または意思決定を単位とする。

1つのtaskは複数のphase、experiment、PRを含んでよい。

次の理由だけでは新しいtaskを作成しない。

- PRやbranchが別になる
- localとCIで実行場所が異なる
- 実験結果の記録が必要
- script名を変更する
- policy文書を更新する
- maintainerによる判断が必要

新しいtaskへ分けるのは、次のいずれかを満たす場合とする。

- 単独で利用価値がある
- 必要な意思決定が独立している
- 変更範囲またはリスクが大きく異なる
- 別担当で並行して完了できる

## Backlog

ここにあるtaskは未着手または保留中の候補であり、Current Taskではない。完了したtaskはこの一覧へ戻さない。

- [0222: Configure画面の共通実行サマリーを導入する](0222-add-configure-execution-summary.md) — Not Started
- [0221: README用の操作スクリーンショットを追加する](0221-add-readme-screenshots.md) — Not Started

## Completed history

- [完了task archive](archive/completed.md)

完了taskの本文はGit履歴に残る。Current Taskの判断材料にしない完了taskは、必要に応じてarchiveの要約だけを残す。
