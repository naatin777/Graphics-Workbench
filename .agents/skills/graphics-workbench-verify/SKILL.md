---
name: graphics-workbench-verify
description: Graphics Workbenchの変更内容に応じて、必要十分な型チェック、lint、format、ローカライズ確認、Unit Test、Integration Test、VS Code Electron、Webview、Playwright、package smoke testを選択して実行する。テスト境界の選択とローカルDockerでの実行方法も含む。実装や修正の完了前に使用する。
---

# 変更検証

現在の差分から、変更を検証できる最小限のチェックを選択する。「とりあえず全テスト」を既定にしない。

## 手順

1. `git diff --stat`と`git diff --name-only`を確認する。
2. 関連する差分を読む。
3. 変更されたsubsystemを特定する。
4. 変更された動作と境界を特定する。
5. 必要なチェックを実行する。
6. 実行結果と未検証事項を報告する。

## subsystem別のminimal verification

| subsystem                                 | チェック                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| TypeScript全般                            | `npm run check`(lint + format + typecheck + typecheck:test + typecheck:webview) |
| テストコード / テスト用tsconfig変更       | 上記のcheckに含まれるtypecheck:testに加え、`npm run compile:test`               |
| Webview / SolidJS                         | 該当Webviewの `npm run test:webview:<app>`、`npm run typecheck:webview`         |
| 生成metadata / package.json / NLS         | `npm run check:nls`、`npm run check:extension-meta`                             |
| script / node test                        | `npm run test:scripts`                                                          |
| Extension Host / VS Code API / 変換フロー | 関連するIntegration Test(`npm test -- --grep ...`)                              |
| Playwright / packaged VSIX                | `npm run package:vsix` + `npm run test:playwright:vsix`(必要時のみ)             |
| packaging / dependency                    | `graphics-workbench-packaging` を参照                                           |

## 基本チェック

通常の実装変更では実行する。

```bash
npm run check
```

(リポジトリはnpmを使う。`pnpm`ではない。)

## ローカルDockerでの実行

PR時CIは停止済み（workflow_dispatchのみ）。ローカルテストは基本的にDockerで実行する。

```bash
npm run test:docker -- check:all
npm run test:docker -- test:webview
npm run test:docker -- test
npm run test:docker -- package:vsix test:playwright:smoke
```

- **buildはhost、testはDocker**。`npm run build`をhostで実行してからDockerでテストする（コンテナ内buildはviteのpdfjs asset copyがmacOS bind mountでEACCESになる）。
- node_modulesはlockfileのSHA-256でkey付けされたnamed volumeが再利用される。lockfile変更で別volumeになる。
- GUIが必要なscript（`test` / `test:coverage` / `test:coverage:run` / `test:playwright:vsix` / `test:playwright:smoke` / `visual:capture`）が含まれる場合だけXvfbが起動する。
- Playwrightはコンテナではpackaged smokeのみ実行する。full suite（configure specのPDF描画）はhost / releaseで検証する。
- Dockerfile / `docker/` / `scripts/test-in-docker.sh` / `entrypoint.sh` を変更した場合は、`npm run test:docker -- check:all` と `npm run test:docker -- package:vsix test:playwright:smoke` で実動作を確認する。

## テスト境界の選択

変更された動作を確認できる最も低いテスト境界を選ぶ。VS Code APIを過剰にモックしない。

- **Unit Test**: 純粋関数、パーサー、パス判定、変換オプションの組み立て。
- **Integration Test**: VS Code API、コマンド実行、ファイル操作、外部CLIとの接続。
- **VS Code Electron / Playwright**: 実際のExtension Host、Webview表示、ユーザー操作、画面遷移が必要な場合。実装の検証はWebviewの内部実装だけにしない。
- **visual review**: UI変更では、変更した挙動に関係する状態だけを確認する。Playwrightはスクリーンショットを`artifacts/visual-review/`へ生成し人間が目視確認する(pixel比較しない)。スクリーンショットだけを機能検証の代わりにしない。
- Webview機能の設計は `graphics-workbench-webview-feature` を参照。

テストを追加・改名する場合のみ `docs/testing/test-naming.md` を参照する。

## 規則

- LSP診断だけを完了根拠にしない。
- 既存テストを弱体化または削除しない。
- 理由なく無関係な重いテストを実行しない。
- 実行していないコマンドを成功したと報告しない。
- 実行できない確認は、理由と残る不確実性を報告する。
- 未確認事項を隠さない。
- 実装前に期待される挙動と主要なエッジケースを確認する。
- 内部実装より外部から確認できる挙動をテストする。
- 可能な限り実際の形式に近いフィクスチャを使用する。
- 変更に関係するテスト、型チェック、Lint、フォーマット、ビルドを実行する。
- 実行していない検証、失敗、残る制約、挙動に影響する前提を報告する。
- 未検証または部分的な実装を完了済みとしない。
- 新機能追加は `graphics-workbench-feature-workflow` を参照する。

## 報告形式

- 実行したコマンド
- 確認できたこと
- 失敗
- 未確認
