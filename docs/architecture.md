# Current architecture

実装を変更するときに誤ったmodule境界を作らないための現在形の要約である。関数一覧と手順はコード・型・testsを正本とする。

## Packages

- `core/` はfrontend-independentなheadless engineである。formats、parser/planner、conversion operation、external process、lifecycle、file-safety primitiveを、明示されたoptionsとdependencyで実行する。frontend設定やfrontend stateは読まない。
- `vscode/` はVS Code adapterである。command登録、`vscode.Uri`、configuration、progress/notification、Webview、editor integration、Safe Mode interaction、Undo policyを持つ。headless処理は`@graphics-workbench/core/*`の公開entry pointから利用する。
- `tui/` は独立したBunのterminal adapterである。terminal input/rendering、公開するfeature subset、default、message、成功後cleanup policyを持ち、staged copyのcoreを利用する。
- root packageは`core`と`vscode`をnpm workspaceとしてbuild・test・packageするcoordinatorである。

依存方向は`vscode -> core`と`tui -> core`である。coreはfrontendをimportせず、frontend同士も参照しない。`scripts/check-package-boundaries.mjs`が依存方向、package declaration、coreの公開entry pointを検証する。

coreの公開surfaceは`conversion`、`pdf`、`formats`、`runtime`、`security`、`output`、`external-tools`に分かれる。frontendはcoreの内部file layoutへ依存しない。

## Safety and integration boundaries

変換結果は共通のstaging/commit lifecycleを通り、workspace containment、symlink/realpath検証、overwrite protection、TOCTOU mitigation、rollback、cleanup、cancellationを維持する。Safe Modeのconflict interactionとUndoの保持方針はVS Code側、TUIの成功後cleanupはTUI側にある。

外部CLIはcoreの`runExternalTool`と形式ごとの薄いadapterを通る。CLI設定の取得とユーザーへのenvironment error表示はfrontend、実行・キャンセル・process-tree終了・出力検証はcoreが担当する。

WebviewはVS Code host command、`vscode/src/shared/protocols/`のruntime-validated message、`vscode/webview/apps/*`のUIの境界で構成する。

VS Code configuration accessは`vscode/src/config/extension_configuration.ts`へ集約する。公開command、configuration、menu、NLS、generated manifestはpackageとgenerator/testsを正本とし、generated fileを手編集しない。
