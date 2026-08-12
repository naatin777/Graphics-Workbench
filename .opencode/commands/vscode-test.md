---
description: VS Code拡張またはWebview変更に適切なテストを選択する
agent: build
---

現在の差分を確認し、Unit Test、Integration Test、VS Code Electron、Playwrightのうち必要なテスト境界を選択する。

利用可能なtest scriptとrunnerはroot `package.json`、該当test config、既存testを正本とする。

既存テストを優先し、必要なテストを実行する。

実行したコマンド、結果、未確認事項を報告する。
