# 0223: AI開発用docs・skillsを現在のrepository構成と開発パターンに合わせて整理する

Status: In Progress

## Objective

Graphics Workbench の AI 開発用 `AGENTS.md`・`PROJECT_STATE.md`・task入口・skills を、現在の repository 構成と最近の開発パターンに合わせて整理する。skill の数を増やすことではなく、AI が実装手順・安全性・テストを必要時だけ正しく読み込める状態にする。

## Background

- 旧task文書では「新規追加予定」とされた `feature-workflow` / `external-tool-integration` / `webview-feature` / `packaging` は実装済み。文書と現状がズレていた。
- `AGENTS.md` が `PROJECT_STATE.md` と `docs/tasks/README.md` を毎回読む前提になっており、常時コンテキストが大きい。
- skillsが`.opencode/skills/`にあり、CodexとOpenCodeで共有しづらい。両者は`.agents/skills/`を標準で読む。
- `graphics-workbench-architecture`は複数の設計判断をまとめたルール集で、skillとして不適切。
- `cli-debug`と`external-tool-integration`、`vscode-testing`と`verify`で責務が重複していた。
- Graphite廃止・PR時CI停止済み（task 0224）だが、残骸の参照が残っていた。

## Changes

1. `AGENTS.md`を常時コンテキスト向けに縮小し、`PROJECT_STATE.md` / `docs/tasks/README.md` の無条件読み込みを削除。
2. `PROJECT_STATE.md`を人間向け要約へ整理（実装済み一覧・ADR重複判断を削除）。
3. `docs/tasks/CURRENT.md`を追加し、task入口を小さくする。0223をCurrent Taskとして登録。
4. skillsを`.opencode/skills/`から`.agents/skills/`へ移行（Codex / OpenCode共有）。
5. `graphics-workbench-architecture`を廃止。入力制限・timeoutはADR-0028へ、command登録・generated metadataはgenerator / `check:extension-meta`が正本。
6. `cli-debug`と`external-tool-integration`を`graphics-workbench-external-tool`へ統合。
7. `vscode-testing`を`graphics-workbench-verify`へ統合。テスト名規約は`docs/testing/test-naming.md`へ移動。
8. `graphics-workbench-feature-workflow`を薄いrouterへ整理し、各専門skillへの条件付きroutingに。
9. 各skillの`description`を発火条件の精度で見直し。
10. `.opencode/commands/`のskill参照を更新し、Graphite依存の`parallel-tasks.md`を削除。

## Non-goals

- 新しいAI harnessの構築（RuleSync再導入・Stop hook・routing script・skill generator等）
- CI構成そのものの大規模変更
- production architecture / application codeの変更
- docsの全面書き換え

## Acceptance criteria

- 常時読み込むのは`AGENTS.md`のみで、開始時に巨大な文書を毎回読まない
- `.opencode/skills/`と`.agents/skills/`の二重管理がない
- skill間の参照連鎖が増えていない
- staleなGraphite / CI記述が現在のルールとして残らない
- Graphics Workbench固有の安全性（staging / Safe Mode / rollback / cancel / Undo）が維持されている
