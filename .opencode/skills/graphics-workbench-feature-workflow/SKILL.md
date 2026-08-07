---
name: graphics-workbench-feature-workflow
description: Graphics Workbenchに新しいcommand、PDF操作、画像変換、変換経路などを追加するときに、触るべき層を漏れなく確認するためのworkflow。新機能の追加・既存機能への新入力形式追加で使用する。単なるバグ修正やリネームでは使用しない。
---

# 機能追加 workflow

新機能を追加するとき、実装前に「この変更ならどこまで触る必要があるか」を判断し、必要な境界だけを選んで確認する。全ての項目を強制しない。変更内容から必要な層を選ぶ。

## 判断の起点

1. 最も近い既存実装を探す(例: 画像変換→`src/operations/conversion/`、PDF操作→`src/operations/pdf/`、Webview→`webview/apps/*/`)。
2. 既存実装がどの層を通っているかを追う。
3. 新機能が既存の形式と何が違うかを列挙する。
4. その差分に必要な層だけを選ぶ。

## 確認候補の層

### 公開面

- `package.json` contributes.commands / configuration / menus / submenu / NLS
- `scripts/generate-extension-meta.ts` と `src/generated/extension_manifest.ts`(手書き禁止、generatorで再生成)
- `src/commands/shared/command_bindings.ts`(public commandの正本)
- `src/commands/shared/command_registrations.ts`(adapter経由の動的登録)

### 実装層

- command実装(`src/commands/`)
- operation / application層(`src/operations/` / `src/application/`)
- protocol(`src/application/protocols/`、host↔webview境界)
- 出力パス設定(`src/config/output/`)
- staging / Safe Mode / rollback / Undo(`src/commands/lifecycle/` / `src/operations/lifecycle/`)
- キャンセル(`ConversionExecutionContext`、`signal`)

### 外部依存

- 外部CLI使用時は `graphics-workbench-external-tool-integration` skill を参照。
- environment check(`src/commands/shared/environment_check.ts`)への統合が必要か。

### ローカライズ

- `package.nls.json` / `package.nls.ja.json`(package.json の %key% 参照)
- Webview の labels / messages

### テスト

- Unit Test / Integration Test / VS Code Electron / Webview Test / Playwright のうち、変更した境界に最も低いものを選ぶ。
- テスト選択は `graphics-workbench-vscode-testing`、検証は `graphics-workbench-verify` を参照。

### packaging

- 新しい dependency、bundled asset、native binary、Webview asset を追加する場合は `graphics-workbench-packaging` skill を参照。

## 判断ルール

- **全部をやらない**。今回の変更に必要な層だけを選ぶ。
- 選ばなかった層は「確認不要」ではなく「今回は対象外」と明示する。
- アーキテクチャ制約(legacy alias禁止・共通固定入力上限なし・共通timeoutなし・command正本)は `graphics-workbench-architecture` を参照し、重複コピーしない。
- 既存の安全機構(staging / Safe Mode / rollback / cancel / Undo)を迂回しない。詳細は `graphics-workbench-safety`。
