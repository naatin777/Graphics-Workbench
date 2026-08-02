# 0211: パッケージ済みElectron E2Eの安定性・幅別UI検証を改善する

Status: Done

## Objective

パッケージ済みVSIXを対象とするElectron Playwright E2Eの不安定さ、不要な終了ダイアログ、終了後に残るElectron子プロセスを減らし、長幅・短幅の両方でWebview UI崩れを検出できる状態にする。

## Scope

- Electron本体だけでなく、終了時に残る子プロセスをテストごとに終了する
- テスト終了時にVS Codeの製品外の保存・終了確認を表示させない
- Playwrightの固定sleepを成立条件または描画フレーム待ちへ置き換える
- 長幅と短幅の2つのElectron projectで同じ15ケースを実行する
- 重複する幅別レイアウト検証と、UIを使わないMerge/Split module検証を統合する
- Webviewの水平overflowを画面崩れの回帰契約として検証する
- 既存のCrop / Merge / Splitの機能契約、幅別の意図したレイアウト、ユーザー側のCSS変更を維持する

終了ダイアログを製品仕様へ追加すること、またはダイアログ表示をE2Eの期待値にすることは対象外とする。

## Completion conditions

- [x] 長幅・短幅のPlaywright projectが同じ15ケースを列挙する
- [x] テスト終了後に対象Electron子プロセスが新たに孤児化しない
- [x] テスト終了時に製品外の終了ダイアログを表示する経路を使わない
- [x] 固定Playwright待機をLintで禁止する
- [x] 長幅・短幅のE2E、型チェック、Lint、フォーマット、関連Webview buildが成功する
- [x] 再発防止用Codex skillを検証して配置する

## Evidence

実装・検証結果:

- Electronの終了処理をプロセスツリー全体へ拡張し、製品仕様外の終了ダイアログを期待値にせず、直接終了させる経路にした。対象VS Codeプロセスの孤児化数は実行前後で増加しなかった。
- `playwright.config.mjs` に長幅 `1280px` と短幅 `600px` の2 projectを追加し、`npx playwright test --list --project=vscode-electron --project=vscode-electron-narrow` で3ファイル・30ケース（15 × 2幅）を確認した。
- 画面崩れ対策として、Crop / Merge / Splitの狭幅CSS、水平overflow検査、ペイン非重複検査、PDFの中央寄せ検査、canvas件数検査を追加した。外側ヘッダーを除去して余白を圧縮し、Mergeの並べ替え・削除操作をアイコン化した。PNGを目視確認し、Cropの設定欄とSplitのグループ操作がプレビューに重なる問題を修正した。
- 重複していたSplitの狭幅専用テストを幅別テストへ統合し、UIを使わないMerge/Split packaged moduleテストを1本へ統合した。
- Splitの入力更新で行DOMを再生成しないstoreへ変更し、キーボードフォーカス維持を幅別E2EとWebview testで確認した。Cropは15ページPDFのスクロール・全ページcrop・出力PDF、Splitは15ページPDFのページ範囲入力・4ページ出力を確認した。Mergeは15ページ+2ページを実結合するcommand testを追加した。
- Splitのテーマsnapshotは、初期の空グループではなく1ページ選択・全ページ表示状態を撮影するようにし、PDF canvasの可読性を実描画で検証する。
- `npx playwright test --update-snapshots=all --reporter=line`: 30 passed (2.7m)。wide/narrowのPNGを更新し、Crop/SplitのPDF中央寄せとMerge操作ボタンを目視確認した。続けて `npx playwright test --reporter=line` を実行し、30 passed (2.9m) を再確認した。
- `npm run check`、`npm run test:webview`（7 tests）、`node --test scripts/oxlint-project-plugin.test.mjs`、`npm run build`、`npm run package:vsix` が成功した。
- 固定 `page.waitForTimeout` を禁止する `project/no-fixed-e2e-wait` と、安定化手順を `/Users/takenaka/.codex/skills/graphics-workbench-e2e-stability/SKILL.md` に追加した。skill validatorも成功した。
