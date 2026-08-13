---
description: Browser Playwright（Vite dev server + scenario mock）のfull UI suiteとpackaged smokeを検証する
agent: build
---

Webview UIのcanonicalなPlaywright検証を用途別に実行する。full UIはbrowser Playwright（`vscode/webview/e2e/`、Vite dev server + typed scenario mock）、実変換smokeはpackaged VSIXのElectron Playwrightが担当する。

1. `npm run test:e2e` でbrowser full UI suite（wide + narrow）を実行する
2. 必要なら `npm run visual:capture` で目視レビュー用画像を生成する
3. packaged VSIXの実変換smokeは `npm run test:playwright:smoke`（CIでは `playwright:smoke:docker`）で実行する
4. Linux canonical検証は `npm run playwright:full:docker` / `npm run visual:capture:docker` を使う

実行したコマンド、結果、確認できたこと、未確認事項を報告する。
