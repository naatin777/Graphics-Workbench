# ADR-0027: Playwrightスクリーンショットをpixel比較せず目視レビュー資料として扱う

## ステータス

採用

## 日付

2026-08-03

## 背景

これまでPlaywrightで取得したWebview画像を`toMatchSnapshot`によるpixel比較でVisual Regression Testしていた。OS、ブラウザ、フォント、描画倍率などの環境差によるノイズが大きく、基準画像の生成環境を固定するためのCI往復、Docker runner、`[update-snapshots]`等の仕組みが増え、保守性と信頼性が下がった。

見た目の検証は「自動のpixel比較」より「人間が目視で確認する」方が、環境差ノイズに左右されず意図的な崩れを確実に検出できる。機能の検証は通常のE2E assertionが担当し、スクリーンショットは合否判定に使わないレビュー資料として扱う。

## 決定

Playwrightスクリーンショットはpixel比較の対象とせず、目視確認用のレビュー資料として扱う。

- `toMatchSnapshot` / `toHaveScreenshot`、`__snapshots__`ディレクトリ、`snapshotPathTemplate`、`PLAYWRIGHT_VISUAL_SNAPSHOTS`を削除する
- テーマテストの見た目検証は、theme class、`body`背景色 / 前景色の変化、PDF canvasが読めることなどのDOM・状態assertionで行う
- 目視確認用画像は`npm run visual:capture`（`visual_review_capture.spec.ts`）で`page.screenshot()`として明示的に生成し、`artifacts/visual-review/<platform>-<arch>/<viewport>/<screen>-<state>.png`へ出力する（`<viewport>`は`wide`または`narrow`。画面ごとにElectronを1回起動し、同一セッション内でテーマを切り替え、wide撮影後にnarrowへリサイズして再び撮影する）
- generated画像（`artifacts/`）はGit管理しない。人間が確認して採用したreference画像は`vscode/extension/test/e2e/electron/visual-review/references/`へGit管理する
- スクリーンショット生成は通常のE2Eコマンド（`test:playwright:vsix`）から分離し、E2Eの合否判定に使わない
- Linux環境の固定再現用`docker/playwright-visual`は削除する。目視レビューは開発者のローカルOS・CPUで生成する
- PRのLinux full UI / responsive、macOS / Windows packaged smoke、release前3 OS full suiteの責務は維持する

## 理由

- OS・ブラウザ・フォント・描画倍率の環境差によるpixelノイズを、合否判定から排除できる
- 基準画像の生成環境固定のためのCI往復、snapshot更新、Docker runnerが不要になる
- 見た目は人間の目視、機能はE2E assertionという役割分担が明確になる
- スクリーンショットがOS非依存（`page.screenshot()`ベース）になり、どのOSでも生成できる

## 代替案

### pixel比較を維持しつつ許容差を広げる

ノイズは残り、許容差を広げるほど回帰検出能力が落ちるため採用しない。

### 全OS用のpinned環境（Docker等）でpixel比較を続ける

環境固定の維持costとCI時間が増え、目的が「環境差のノイズ除去」なら目視レビューで足りるため採用しない。

## 結果・影響

- pixel snapshotを合否判定に使わず、`visual:capture`で生成した画像をレビュー資料として扱う。
- `visual:capture`で生成した画像を人間が目視確認し、承認したreferenceだけをGit管理する。
- リリース時は3 OSで`visual:capture`を実行し、`artifacts/visual-review/`をreview用artifactとして保存する

## 見直す条件

- 環境差を排除できる確実なpixel比較基盤が確立した場合
- 目視レビューでは検出できない微妙な視覚回帰が問題になった場合

## 関連

- [`package.json` scripts](../../package.json)
- [`vscode/extension/test/e2e/electron/visual-review/README.md`](../../vscode/extension/test/e2e/electron/visual-review/README.md)
