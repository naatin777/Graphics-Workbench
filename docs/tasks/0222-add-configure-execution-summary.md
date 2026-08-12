# 0222: Configure画面の共通実行サマリーを導入する

Status: Not Started

## Objective

PDF Configure画面（crop / split / merge / rotate / reorder）で、実行前に利用者が確認すべき情報を、画面下部または操作パネル内の共通実行サマリーとして表示する。

## Background

各Configure画面には共通要素（共通ボタン・共通入力・ラジオグループ・PageNavigator・SplitPane・Codicon・VS Codeテーマ変数）が導入済み。次の段階として、操作モデルを揃える。理想的な共通構造は次。

```text
対象ファイル
↓
プレビュー
↓
処理オプション
↓
対象ページ
↓
出力
↓
実行
```

実行サマリーの候補は次。

- 出力ファイル名
- 上書き方針
- 対象ページ
- 使用する処理エンジン
- 推定出力数

## Constraint

現在のアーキテクチャでは、出力先が設定テンプレート側（`graphics-workbench.outputPath.*`）で決定されている。出力先はhost側で解決され、webviewのinit messageには含まれていない。

そのため、出力ファイル名や上書き方針をwebviewへ渡すには、各Configure画面のprotocol（`*_pdf_protocol.ts`）、init payload、host側の`buildInitMessage`、webviewのlabelsを変更する必要がある。これは画面ごとに独立しており、まとめて行うと変更範囲が大きい。

## Scope

- 共通化できる表示だけを先に実装する
  - 例: 各画面で既に持っている情報（対象ファイル名、ページ数、選択ページ数、適用対象）を使う実行サマリー
- 出力ファイル名・上書き方針など、host側の情報が必要な項目は、protocol変更を伴うため個別タスクとして分割する
- 大規模な出力設定アーキテクチャの刷新は行わない

## Non-goals

- 出力設定（`outputPath.*`）の仕様変更
- webviewからの出力先編集
- 全画面を一括で書き換えること

## Recommended first step

1. 各Configure画面が「実行前に利用者が確認すべき情報」を整理する
2. 既にwebviewが持っている情報（対象ファイル名・ページ数・選択ページ数・適用対象ページ）で構成できるサマリーを、1画面（例: reorder）へ導入して方式を確立する
3. 出力先・上書き方針が必要な項目は、protocol変更タスクとして分割する

## Acceptance criteria

- 各Configure画面で、実行前に確認すべき情報が一貫した場所に表示される
- 出力先や上書き方針がwebviewへ渡る場合、hostの解決結果と一致する
- 既存のConfigure画面の操作とテストを壊さない
