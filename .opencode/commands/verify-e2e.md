---
description: package済みVSIXのPlaywright full suite（wide+narrow）をローカルで実行して検証する
agent: build
---

`graphics-workbench-verify` Skillを読み込む。

package済みVSIXのPlaywright full suiteをローカルで実行する。

1. `npm run package:vsix` で `graphics-workbench.vsix` を生成する
2. `npm run test:playwright:vsix` で wide + narrow の全ケースを実行する
3. 必要なら `npm run visual:capture` で目視レビュー用画像を生成する

外部ツール（pdftocairo / gs / rsvg-convert / qpdf / Chrome）が無い場合は、`.github/scripts/install-image-tools-macos.sh`（macOS）などを実行する。

実行したコマンド、結果、確認できたこと、未確認事項を報告する。
