# Visual Review

このディレクトリの画像は**pixel matchingには使用しない**。Playwrightで同一の画面状態を再現して撮影し、人間が目視で確認するための参照画像として使用する。OS・ブラウザ・フォント・描画倍率の差によるノイズを排除するため、ピクセル単位の自動比較は行わない。

## 責務の分離

| 領域                                            | 責務                                    | Git管理 |
| ----------------------------------------------- | --------------------------------------- | ------- |
| E2Eテスト（`test/playwright/electron/`）        | DOM・操作・状態遷移・処理結果を自動検証 | する    |
| capture spec（`visual_review_capture.spec.ts`） | 目視確認用の画面状態を再現して撮影      | する    |
| generated画像（`artifacts/visual-review/`）     | 今回の実行で生成した未確認画像          | しない  |
| reference画像（`references/`）                  | 人間が確認して採用した参照画像          | する    |
| Playwright report / test-results                | レポート・trace・失敗時画像             | しない  |

## Workflow

1. `npm run package:vsix` でVSIXを生成する（`graphics-workbench.vsix`）
2. `npm run visual:capture` を実行する
   - 出力先: `artifacts/visual-review/<platform>-<arch>/<screen>-<state>.png`（例: `darwin-arm64/crop-configure-dark.png`）
   - 対象: crop / merge / split のConfigure画面をdark / light / high-contrast / high-contrast-light / red / abyssテーマで撮影
3. 生成された画像を確認する
4. 意図した変更であることを確認する
5. 必要な場合のみreference画像を更新する
6. コード変更と画像変更を一緒にレビューする

`visual:capture` は通常のE2Eコマンド（`npm run test:playwright:vsix`）とは分離しており、E2Eの合否には影響しない。撮影に失敗した場合はエラーと出力先パスが表示される。

## generated画像とreference画像

- `artifacts/visual-review/` は実行ごとに生成される未確認画像で、Git管理しない
- `references/` は人間が確認して「この見た目が正しい」と採用した画像で、Git管理する
- reference画像を採用する場合は、`artifacts/visual-review/<platform>-<arch>/` から `references/<platform>-<arch>/` へコピーし、コード変更と一緒にcommitする

## reference画像を更新する条件

- UIのレイアウト・配色・コンポーネントを意図的に変更した
- 生成画像を目視確認し、変更後の見た目が正しいと確認できた
- 不要になったreference画像は同じPRで削除する

環境差（フォント、DPI、OS描画）による細かな違いだけの場合は更新しない。

## 現在の標準確認環境

開発者がローカルのOS・CPUで生成した環境を正本とする。出力先ディレクトリが`<platform>-<arch>`で分かれるため、OS・CPUごとに別々のreferenceを管理できる。Linux環境の固定再現用Docker runnerは廃止し、追加しない。

## レビュー方針

UIを変更するPRでは、コード差分と一緒にreference画像の差分もレビューする。GitHubのPR画像差分で確認できるよう、採用したreference画像はコード変更と同じcommitに含める。
