---
name: graphics-workbench-external-tool-integration
description: Graphics Workbenchに新しい外部CLI / renderer / converter（Draw.io、Mermaid、Chrome、Ghostscript、qpdf、pdftocairo、rsvg-convert、ImageMagick等）を組み込むときの判断と実装手順。dependency戦略、process実行、cross-platform、success条件、キャンセル、環境チェックを扱う。既存CLIのバグ解析はgraphics-workbench-cli-debugを参照。
---

# 外部CLI統合

新しい外部CLIを統合するとき、既存のprocess実行・安全性・設定パターンを再利用する。同じ問題を各commandで個別実装しない。

## 1. dependency戦略の判断

まず次を判断する。

- npm dependencyとしてbundleするか
- system CLIとして要求するか
- executable pathをsettingで指定するか
- OSごとにdiscoveryするか
- bundled Chromiumのような巨大dependencyを避けるべきか

判断の基準:

- 理由なくdependencyを増やさない(`AGENTS.md`)。
- 同梱CLIでない場合、`graphics-workbench.execPath.*`設定と`src/config/external_tools/external_tool_paths.ts`のパターンに従う。
- setting値が空のときOS既定名へfallbackする既存パターン(Ghostscript)を参考にする。

## 2. process実行

`src/operations/external_tools/run_external_tool.ts`の`runExternalTool`を再利用する。個別にspawnを実装しない。

確認事項:

- `shell: false`を基本とする(executableとargumentsを分離する)。
- 手動shell quotingを安易に追加しない。
- cwd / stdin / stdout / stderr / exit code / spawn failureを明示する。
- output validation(下記success条件)を行う。
- cancellation(AbortSignal)とprocess tree終了を`runExternalTool`が担うことを確認する。
- `TOOL_ID_BY_NAME`に新しいtoolIdを追加し、timeout設定(`externalTools.<id>.timeoutSeconds`)と対応させる。

### process lifecycle

```text
spawn
→ running
→ cancellation requested
→ terminate process tree
→ cleanup
→ no final output commit
```

- キャンセル検知後に最終出力を確定しない。
- Windowsではparent processが先に終了しても子processが残るケースを考慮する(`taskkill /t /f`の既存実装を再利用)。
- process tree terminationの既存実装(`terminateProcessTree`)を再利用し、各commandで個別実装しない。

## 3. cross-platform

最低限以下を考慮する。

- macOS / Linux / Windows
- path separator
- 空白・non-ASCII path
- executable extension(`.exe`等)
- process tree terminationのOS差異(Windowsの`taskkill`)

## 4. success condition

exit code 0だけで成功扱いしない。必要に応じて確認する。

- output file exists
- non-empty
- expected file format
- parseable PDF/image(SVG→PDFは`validateGeneratedPdf`等)
- expected page count

## 5. cleanup / cancellation

外部processが絡んでも既存の安全機構(staging / Safe Mode / rollback / cleanup / Undo)を迂回しない。詳細は`graphics-workbench-safety`。

## 6. environment check

system dependencyなら、既存environment check(`src/commands/shared/environment_check.ts`)に統合する。

- 「未インストール」と「実行したが失敗」を区別する。
- `checkTool`パターン(probe・versionArgs・settingId)を再利用する。

## 既存CLIのデバッグ

既存CLIの失敗・OS差異の調査は`graphics-workbench-cli-debug`を参照する。本skillは新規統合用。

## テスト

- 純粋な引数組み立て・path解決はUnit Test。
- 実spawn・ファイル出力・キャンセルはIntegration Test。
- 既存のfixtureランナー(例: crop child processの`run_crop_pdf_process.test.ts`のpattern)を参考に、実processをテストする。
