---
name: graphics-workbench-release
description: Graphics WorkbenchのVSIX packaging、dependency・native asset確認、リリース前検証、リリースノート準備を行う。ユーザーがVSIX作成、リリース、公開、バージョン更新を明示的に依頼した場合だけ使用する。通常の実装では使用しない。
---

# Packaging and release

このskillは、通常の実装で必要なpackage情報を常時読み込ませず、配布物の作成・検証・公開に固有の手順だけを扱う。

## Packaging boundary

- rootはprivate npm coordinatorで、VSIXは`core/`と`vscode/`のbuild済みruntimeを一時directoryへstagingして組み立てる。rootのdevDependency、workspace symlink、`tui/`をVSIXのproduction closureへ混ぜない。
- `vscode/.vscodeignore`、staging filter、runtimeのdynamic importを確認し、Webview bundle、PDF.js asset、native Sharp packageなどの実行時ファイルを除外しない。
- `npm run package:vsix`でVSIXを作成し、`npx vsce ls --tree`または`unzip -l`で実際の内容を確認する。
- target別のnative assetは`node scripts/verify-vsix.mjs --vsix <file> --target <target>`で検証する。新しいnative binary、bundled CLI、runtime assetを追加した場合は、packaged smokeで実行まで確認する。

## Release flow

1. current branch、version、前回releaseとの差分を確認する。
2. 変更範囲に応じたcheck、test、packaged smokeを実行する。通常のscripts一覧と正確なコマンドはroot `package.json`を正本とする。
3. `npm run package`または対象targetのpackage scriptで配布物を作成する。
4. VSIXの内容、version、runtime dependency、native asset、不要な開発ファイルを確認する。
5. リリースノートを作成し、公開はユーザーが明示した場合だけ行う。

6 target VSIX、native runner、Marketplace認証、installed VSIX E2Eの境界は、関連ADRと`.github/workflows/`の現在の実装を確認する。古いtaskや過去のpackage方式を復元しない。

## Safety

Packagingは生成した一時directoryとVSIXだけを対象にする。ユーザーworkspaceの変換出力、staging、Safe Mode、Undo、rollbackの契約をpackage検証の都合で変更しない。
