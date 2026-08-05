---
description: 複数の独立タスクをsubagentで並列実行し、GitHub Actionsの待ち時間を有効活用する
agent: build
---

独立した複数の作業を、Git branch / worktreeを分けてsubagentで並列実行する。CIを先にPRへ投げ、待ち時間中に次のタスクを進める。

## 手順

1. `git status --short`、`gt log short`、`gt trunk`で現在地を確認する
2. 各タスクが独立していることを確認する（ファイル重複がある場合は1つに統合する）
3. trunk（main）から、タスクごとに独立したbranchを作成する（`gt create <branch> -m "<message>"`）
4. 各branchを別worktreeとしてcheckoutする（`git worktree add`）
5. 各worktreeに対してsubagentを1つずつ起動し、タスクを並列実行させる
6. 各subagentの完了後に `gt submit` でPR化し、CIを走らせる
7. CI実行中は、依存していない次のタスクを並列で進める

## subagent起動時の指示

各subagentには以下を必ず渡す:

- 対象worktreeの絶対パス（作業は必ずそのworktree内で行う）
- タスクの目的と完了条件
- 検証コマンド（`npm run check` や該当testなど）
- 成果物の報告形式

## 注意

- 同じファイルを複数subagentが同時に編集しない
- `gt submit`はremoteへPRを作るため、実行前にPR対象branchと内容を確認する
- 各タスクは1つの検証可能な目的に集中させる
