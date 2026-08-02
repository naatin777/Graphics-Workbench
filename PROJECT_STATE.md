# PROJECT_STATE.md

このファイルは、プロジェクトの現在地を見失わないためのメモです。

## Goal

Graphics Workbench は、VS Code 上で PDF・画像・Draw.io・LaTeX への挿入作業を扱いやすくする拡張機能です。

## Current priority

- Extension Hostをpre-package testの唯一のruntimeとして維持する
- 次の作業は `docs/tasks/README.md` で管理する

## Implemented

- PDF crop / split / merge
- PDF to/from PNG/JPEG/WebP/AVIF/SVG/GIF/TIFF/EPS/Raw conversion
- Draw.io to PDF conversion
- Mermaid theme/backgroundColor settings
- LaTeX insertion templates (settings)
- Input preflight validation (all operations) with deep PDF/SVG inspection
- Preflight warning confirmation dialog (errors checked before warnings)
- Insert LaTeX code (PDF, clipboard image)
- ConversionRuntime consistently used across all operations
- Menu conditions aligned with implementation format support
- Version-tag consistency validation in release workflow
- v1 safety hardening, output validation, test Evidence, and packaged VSIX smoke verification
- Undo履歴のライフサイクル管理（上限10件・24時間、workspaceStateマニフェスト、孤立データ掃除）
- 起動時の変換系モジュールdynamic import化（sharp/pdf-lib/Mermaid CLIを実行時ロード）
- Mermaid CLIの子プロセス実行とキャンセル・タイムアウト
- PDF変換のJob planningをProgress表示内へ移動（解析中表示とキャンセル対応）
- 外部実行パス設定のmachine scope化とuntrustedWorkspaces宣言

## In progress

- [0212: package済みPlaywrightのOS別責務を再配分する](docs/tasks/0212-rebalance-packaged-playwright-platform-coverage.md) — PRはLinux full visual + macOS / Windows packaged smoke、releaseは3 OS full visual artifact、localはmulti-arch Docker Linux fullを実装。CI scope classifierは廃止し、対象jobを常時実行する。clean-head ActionsとDocker amd64のEvidence待ち

## Non-goals

- production codeのリファクタリング
- test directoryの全面移動
- test runnerの移行・比較
- required statusやbranch protectionの変更
- Playwright Electronへの全面置換
- 新しいユーザー機能
- Coding Houtei相当のrepository内実装
- inspired-mino-design-skills suiteの全面導入

## Important Decisions

- 技術案、runner名、directory名をproblemや目的として扱わない。
- 観測、解釈、仮説、unknown、contradictionを分離してから判断する。
- test runnerは、runner統一ではなく、守るcontractとoracleから選ぶ。
- pre-package testはすべて`vscode-test`で実行し、Node専用runnerやExtension Hostからの除外を持たない。
- Extension Host testはLinux、macOS、Windowsで恒久的に維持し、required statusは設定しない。
- extension manifestのNode制約は置かず、repositoryの開発・install用Node制約は`devEngines.runtime`で管理する。
- CIのnpm cacheは、npm 12.0.1への更新後に`actions/cache`で復元し、`setup-node`の自動cacheは使わない。
- Browser Playwrightは廃止し、実VS Codeを必要とする配布物E2Eはpackage済みVSIXのElectron Playwrightで確認する。
- PRのPackaged Electron E2Eは、Linuxがwide+narrow full UI / responsive / pixel snapshotのowner、macOS / Windowsがwide packaged conversion smokeのownerとなる。release前は3 OSすべてで全wide+narrow suiteを実行し、pixel gateではなく各OSのscreenshot artifactを目視確認する。
- GitHub ActionsのPRでは3 OSともpackaged Playwrightを実行する。Linuxはfull 33 cases、macOS / Windowsはwide packaged conversion smoke 3 casesで、macOS / Windowsではpixel比較を行わない。
- Linux visualのローカル再現には、Playwright・npm・lockfileを固定し、外部変換toolのpath/versionをbuild時にverifyする`docker/playwright-visual/Dockerfile`を使う。Docker imageは`linux/amd64`と`linux/arm64`を対象に全33 casesを実行できるが、GitHub Actions runnerへDocker実行を組み込まない。
- required platform、quality priority、不可逆な変更はmaintainerが決める。
- Selection Gateが決まるまで、大規模なproduction architecture変更を開始しない。
- 作業中は `docs/tasks/README.md` からリンクされた1つのtaskに限定する。作業がない場合はCurrent Taskを空にする。
- 気になるリファクタは、すぐ直さず `docs/refactor-backlog.md` に書く。
- 採用した永続判断は `docs/adr/` に記録する。未決案をADRで確定扱いしない。
- READMEは日本語で正確に書いてから英語化してよい。
- 英語で書くもの・日本語で書くものは `docs/adr/0011-define-language-policy-for-project-artifacts.md` に従う。
- AIにはコードを書かせるが、価値判断と最終承認は渡さない。
- 変換fixtureテストは、固定入力を`test/input/valid`・`test/input/invalid`に元のファイル名で保存し、固定正解データを入力形式ごとの`test/output`に保存する。各テストは必要な入力だけを`test/workspace`直下のworkspace rootへ名前や配置を変えてコピーし、テスト前後にworkspaceを空にする。`test/output`はworkspaceへコピーしない。
- 変換fixtureテストの実行時workspaceは`test/workspace`をVS Code workspace rootとして開く。外部ツールのテスト設定は`test/vscode-settings/settings.json`からtest runnerのuser dataへコピーし、実行用workspaceとは分離する。
- Playwright Electronテストも`test/workspace`を開き、テスト前後に空であることを検証する。VS Code内部用の`user-data`・`shared-data`・`extensions`だけはOS一時領域へ分離する。
- `test/workspace`はリポジトリ内にあるため、Electronテストの起動引数でGit拡張を無効化してGit通知をスクリーンショットへ混入させない。`git.openRepositoryInParentFolders`や`git.enabled`のsettingsだけでは通知を抑止できなかった。
- 検証結果は「コマンドを実行した」と「テストが成功した」を分けて報告し、成功確認前にcommit・pushしない。Node/npmが使えない場合は代替runtimeの結果をnpmテスト成功と扱わない。

## Tasks

See `docs/tasks/README.md`.
