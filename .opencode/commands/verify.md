---
description: 現在の変更に必要十分な検証を選択して実行する
agent: build
---

現在の作業ツリーの差分を確認し、変更を検証できる最小限のチェックを選択して実行する。

利用可能な検証scriptと対象範囲はroot `package.json`を確認する。必要なら`check:docker`、`test:docker`、`verify:docker`など、変更に対応するscriptを選ぶ。

実行したコマンド、結果、確認できたこと、未確認事項を報告する。
