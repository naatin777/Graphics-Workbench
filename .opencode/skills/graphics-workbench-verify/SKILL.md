---
name: graphics-workbench-verify
description: Graphics Workbenchの変更内容に応じて、必要十分な型チェック、lint、format、ローカライズ確認、Unit Test、Integration Test、Playwright Test、package smoke testを選択して実行する。実装や修正の完了前に使用する。
---

# LHG変更検証

現在の差分から、変更を検証できる最小限のチェックを選択する。「とりあえず全テスト」を既定にしない。

## 手順

1. `git diff --stat`と`git diff --name-only`を確認する。
2. 関連する差分を読む。
3. 変更されたsubsystemを特定する。
4. 変更された動作と境界を特定する。
5. 必要なチェックを実行する。
6. 実行結果と未検証事項を報告する。

## subsystem別のminimal verification

変更されたsubsystemに応じて、必要なチェックだけを選ぶ。

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

## 動作テスト

- 純粋関数、パーサー、パス判定は関連するUnit Testを実行する。
- VS Code API、ファイル操作、外部CLI、変換フローは関連するIntegration Testを実行する。
- VS Code Electron環境が必要な場合は`npm test`を実行する。
- Webviewの表示や操作は関連するWebview Testまたは`npm run test:playwright:vsix`を実行する。

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
- 新機能追加は `graphics-workbench-feature-workflow`、テスト境界は `graphics-workbench-vscode-testing` を参照する。

## 報告形式

- 実行したコマンド
- 確認できたこと
- 失敗
- 未確認
