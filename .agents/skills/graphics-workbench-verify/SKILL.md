---
name: graphics-workbench-verify
description: Graphics Workbenchの実装・修正をローカル検証するとき、testコマンドを選ぶ前に使用する。canonicalなLinux検証は用途別Dockerコマンドで実行し、必要十分なUnit Test、Integration Test、Webview、Playwright、package smoke testを選ぶ。
---

# 変更検証

現在の差分から、変更を検証できる最小限のチェックを選択する。「とりあえず全テスト」を既定にしない。

## 実行環境の選択

- canonicalなLinuxローカル検証は、用途別の `*:docker` コマンドで実行する。
- hostではwatch、format fix、変更箇所の短い診断、native OS固有の確認を実行する。
- release検証はGitHub Actionsの各native runnerで実行する。

## 手順

1. `git diff --stat`と`git diff --name-only`を確認する。
2. 関連する差分を読む。
3. 変更されたsubsystemを特定する。
4. 変更された動作と境界を特定する。
5. 必要なチェックを実行する。
6. 実行結果と未検証事項を報告する。

## subsystem別のminimal verification

| subsystem                             | チェック                           |
| ------------------------------------- | ---------------------------------- |
| TypeScript / metadata / script        | `npm run check:docker`             |
| Extension Host / Webview / 変換フロー | `npm run test:docker`              |
| coverage                              | `npm run test:coverage:docker`     |
| packaged VSIX smoke                   | `npm run playwright:smoke:docker`  |
| Playwright full suite                 | `npm run playwright:full:docker`   |
| visual review capture                 | `npm run visual:capture:docker`    |
| pre-push相当の一式                    | `npm run verify:docker`            |
| packaging / dependency                | `graphics-workbench-packaging`参照 |

## 基本チェック

通常の実装変更では、まず静的チェックを実行する。

```bash
npm run check:docker
```

表から変更に必要なruntime testを追加し、push前の一式には `npm run verify:docker` を使う。リポジトリはnpmを使い、`pnpm`は使わない。

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
