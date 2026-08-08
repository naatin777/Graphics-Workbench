# PROJECT_STATE.md

このファイルは、人間がプロジェクトの現在地を見るための要約です。作業開始時に毎回読む文書ではなく、作業の入口は `AGENTS.md` と現在のタスク文書です。

## Goal

Graphics Workbench は、VS Code 上で PDF・画像・Draw.io・LaTeX への挿入作業を扱いやすくする拡張機能です。

## 現在の運用

- ローカルテストはDockerで実行する（`npm run test:docker -- <script>`）。
- PR時CIは停止中（`check.yml` / `test.yml` / `playwright.yml` は `workflow_dispatch` のみ）。releaseはtag時に実行。
- branch運用はplain git + gh（Graphiteは廃止済み）。
- AI用ルールは `.agents/skills/` のskillと `AGENTS.md`。skillはdescriptionで選択される。

## Non-goals

- production codeのリファクタリング
- test directoryの全面移動
- test runnerの移行・比較
- Playwright Electronへの全面置換
- 新しいユーザー機能
- AI開発ハーネス（RuleSync / Stop hook / Evidence matrix等）の再導入

## 永続判断の正本

採用した永続判断は `docs/adr/`、現在のタスクは `docs/tasks/` を正本とする。本ファイルには判断を重複して記載しない。
