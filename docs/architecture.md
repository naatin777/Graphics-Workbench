# Current architecture

この文書は、実装を変更するときに誤ったmodule境界を作らないための現在形の要約である。詳細な関数一覧や実装手順はコードを正本とする。

## Packages

- `core/` はfrontendから独立したconversion、PDF/raster処理、external tool runner、configuration、file-safety lifecycleを提供する。
- `vscode/` はVS Code command、configuration access、notifications、Undo、Safe Mode、Webview host、VS Code固有のoperation adapterを持つ。
- `tui/` はroot npm workspaceに含まれない独立Bun packageで、VS Code extensionのruntime dependencyではない。
- root packageは`core`と`vscode`をnpm workspaceとしてbuild・test・packageするcoordinatorである。

## Conversion flow

VS Code commandは入力選択とユーザー通知を担当し、形式固有のplanning・operationへ渡す。変換結果は共通のstaging/commit lifecycleを通り、成功時だけ最終出力へ反映される。入力形式・出力形式・page/frameの扱いは、該当するplannerとoperationの型・testsを正本とする。

外部CLIはcoreの`runExternalTool`と、形式ごとの薄いadapterを通る。CLIの実行、キャンセル、process-tree終了、出力検証を各commandで再実装しない。

## Webview boundary

Webview機能は、VS Code host command、`vscode/src/shared/protocols/`のruntime-validated message、`vscode/webview/apps/*`のUIの3境界で構成する。Webview stateとhost stateをDOMの存在だけで同期しない。protocolと既存のconfigure session/lifecycleを再利用する。

## Configuration and generated metadata

VS Code configuration accessは`vscode/src/config/extension_configuration.ts`へ集約する。公開command、configuration、menu、NLS、generated manifestの対応は`vscode/package.json`とgenerator/testsを正本とし、generated fileを手編集しない。
