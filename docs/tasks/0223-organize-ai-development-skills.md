# 0223: AI開発用skillsをrepository構成と開発パターンに合わせて整理・強化する

Status: Not Started

## Objective

Graphics Workbench の AI 開発用 `.opencode/skills/` を、現在の repository 構成と最近の開発パターンに合わせて整理・強化する。skill の数を増やすこと自体ではなく、AI が実装手順・安全性・テスト・Graphite/CI 運用を毎回正しく判断できる状態にする。

## Scope

- 新規 skill
  - `graphics-workbench-feature-workflow`: 新機能追加で触るべき層のworkflow
  - `graphics-workbench-external-tool-integration`: 外部CLI統合（process lifecycle含む）
  - `graphics-workbench-webview-feature`: Webview機能の構造・state正本・protocol
  - `graphics-workbench-packaging`: VSIX内容・dependency・size
- 編集 skill
  - `graphics-workbench-vscode-testing`: visual review追加
  - `graphics-workbench-verify`: subsystem別minimal verification、pnpm→npm修正
  - `graphics-workbench-release`: packaging詳細をpackaging skillへ分離、pnpm→npm修正
  - `graphite-stacked-pr`: CI economy（CIを開発の同期ステップにしない）
- `AGENTS.md`: skill routingは不要（skillはdescriptionで自動提示される）と判断し、削除

## Non-goals

- 全repositoryをfeature-firstへ移行する
- CI workflowの変更（concurrency導入等は既存3 workflowで済んでいる）
- skill validator用のproduction dependency追加
- 単発バグ専用skillの追加

## Recommended first step

1. 既存skillの責務と重複を確認する
2. 新規4 skillを追加し、既存4 skillを編集する
3. skillがdescriptionで自動提示されるため、AGENTS.mdのroutingは追加しない
4. frontmatter・重複・`git diff --check` で検証する

## Acceptance criteria

- 新規機能追加で触るべき層を見落とさない
- ユーザーファイルを壊さない（safety参照）
- 外部CLIのOS差異を雑に扱わない
- WebviewのDOMをstateの正本にしない
- package sizeを不用意に増やさない
- 不必要に重いテストを毎回走らせない
- GraphiteのrestackごとにCIを再submit / 待機しない
- CI pendingを理由に開発作業を停止しない
- merge前には必要なCIを確認する
- skillはdescriptionで自動選択され、AGENTS.mdにroutingを重複させない
