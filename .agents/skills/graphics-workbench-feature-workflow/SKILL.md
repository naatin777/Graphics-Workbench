---
name: graphics-workbench-feature-workflow
description: Graphics Workbenchに新しいcommand、PDF操作、画像変換、変換経路などを追加するときの入口。最も近い既存実装の確認、触るべき層の判断、該当する専門skillへの振り分けを行う。新機能の追加・既存機能への新入力形式追加で使用する。単なるバグ修正やリネームでは使用しない。
---

# 機能追加 workflow

新機能を追加するとき、実装前に「この変更ならどこまで触る必要があるか」を判断し、必要な境界だけを選んで確認する。全ての項目を強制しない。

## 判断の起点

1. 最も近い既存実装を探す(例: 画像変換→`src/operations/conversion/`、PDF操作→`src/operations/pdf/`、Webview→`webview/apps/*/`)。
2. 既存実装がどの層を通っているかを追う。
3. 新機能が既存の形式と何が違うかを列挙する。
4. その差分に必要な層だけを選ぶ。

## 条件付きrouting

変更内容が次のいずれかに該当する場合のみ、対応するskillを参照する。

- user fileの作成・置換・削除、staging / Safe Mode / rollback / Undo → `graphics-workbench-safety`
- Webview機能の追加・変更 → `graphics-workbench-webview-feature`
- 外部CLIの統合・デバッグ → `graphics-workbench-external-tool`
- dependency / bundled asset / native binary / package size → `graphics-workbench-packaging`
- リリース・公開 → `graphics-workbench-release`
- 実装後の検証 → `graphics-workbench-verify`

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

### ローカライズ

- `package.nls.json` / `package.nls.ja.json`(package.json の %key% 参照)
- Webview の labels / messages

## 判断ルール

- **全部をやらない**。今回の変更に必要な層だけを選ぶ。
- 選ばなかった層は「確認不要」ではなく「今回は対象外」と明示する。
- アーキテクチャ制約(共通固定入力上限なし・共通timeoutなし)は `docs/adr/0028-no-global-input-limits-or-processing-timeout.md` を参照する。
- 旧command ID・旧settingを内部aliasやfallbackとして復活させない(AGENTS.md)。command登録と生成metadataはgenerator (`npm run generate:extension-meta`) と `check:extension-meta` が正本。
- 既存の安全機構(staging / Safe Mode / rollback / cancel / Undo)を迂回しない。詳細は `graphics-workbench-safety`。
