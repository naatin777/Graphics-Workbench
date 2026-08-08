---
name: graphics-workbench-external-tool
description: Graphics Workbenchで外部CLI / renderer / converter（Draw.io、Mermaid、Chrome、Ghostscript、qpdf、pdftocairo、rsvg-convert、ImageMagick等）を扱うときの判断と手順。新しい外部CLIの統合、または既存外部CLIの失敗・OS差異のデバッグで使用する。`runExternalTool`の再利用、process実行、cross-platform、success条件、キャンセル、環境チェックを扱う。
---

# 外部CLI

外部CLIに関する作業は「新規統合」と「既存CLIのデバッグ」に分かれる。両方で共通の実行・安全性パターンを再利用する。

## 共通事項

- `src/operations/external_tools/run_external_tool.ts`の`runExternalTool`を再利用する。個別にspawnを実装しない。
- `shell: false`を基本とし、executableとargumentsを分離する。手動shell quotingを安易に追加しない。
- cwd / stdin / stdout / stderr / exit code / spawn failureを明示する。
- exit code 0だけで成功扱いしない。期待する出力ファイルの存在・非空・形式（例: SVG→PDFは`validateGeneratedPdf`等）・ページ数を確認する。
- 空ファイルや不正なPDF/画像を成功扱いしない。
- 空白・non-ASCII文字・Windowsパスを扱えることを確認する。
- キャンセル(AbortSignal)とprocess tree終了は`runExternalTool`が担う。Windowsの`taskkill /t /f`実装を再利用する。
- キャンセル検知後に最終出力を確定しない。外部processでも既存の安全機構(staging / Safe Mode / rollback / cleanup / Undo)を迂回しない（詳細は`graphics-workbench-safety`）。
- macOS / Linux / Windowsの差異（path separator、executable extension、process tree終了）を考慮する。
- 途中生成物の作成場所と削除タイミングを明確にする。

## 新規統合

新しい外部CLIを組み込むとき、同じ問題を各commandで個別実装しない。

1. dependency戦略を判断する（npm dependencyとしてbundle / system CLIとして要求 / executable pathをsettingで指定 / OS別discovery）。理由なくdependencyを増やさない（AGENTS.md）。
2. `graphics-workbench.execPath.*`設定と`src/config/external_tools/external_tool_paths.ts`のパターンに従う。setting値が空のときOS既定名へfallbackする既存パターン(Ghostscript)を参考にする。
3. `TOOL_ID_BY_NAME`にtoolIdを追加し、timeout設定(`externalTools.<id>.timeoutSeconds`)と対応させる。
4. system dependencyなら`src/commands/shared/environment_check.ts`へ統合する。「未インストール」と「実行したが失敗」を区別し、`checkTool`パターン(probe・versionArgs・settingId)を再利用する。
5. テスト: 純粋な引数組み立て・path解決はUnit Test、実spawn・ファイル出力・キャンセルはIntegration Test。既存のfixtureランナー(例: `run_crop_pdf_process.test.ts`のpattern)を参考にする。

## 既存CLIのデバッグ

拡張機能の問題と、外部CLI単体の問題を分離する。

1. 実際に実行されたコマンドと引数を確認する。
2. `cwd`、入力パス、出力パスを確認する。
3. exit code、stdout、stderrを確認する。
4. 同じコマンドをCLI単体で再現する。
5. 最小の入力ファイルで再現する。
6. 修正後に元の入力でも再確認する。

確認項目:

- パスと引数が正しく分離されている。
- exit codeだけでなく、期待する出力ファイルの存在と内容を確認している。
- CLIの未インストールと実行失敗を区別している。
- OS固有の修正を全OS共通処理へ無条件に混ぜない。
- 根拠なくシェルのクォートを追加しない。
- ログを大量に追加する前に、検証する仮説を明確にする。

報告形式: 再現方法 / 原因 / 修正内容 / 回帰確認 / 未確認環境
