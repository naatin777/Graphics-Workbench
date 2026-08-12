---
description: Linux target VSIXのPlaywright full suite（wide+narrow）をDockerで検証する
agent: build
---

canonicalなLinux Playwright検証を用途別Dockerコマンドで実行する。

1. `npm run playwright:full:docker` でpackage後、wide + narrowの全ケースを実行する
2. 必要なら `npm run visual:capture:docker` で目視レビュー用画像を生成する

実行したコマンド、結果、確認できたこと、未確認事項を報告する。
