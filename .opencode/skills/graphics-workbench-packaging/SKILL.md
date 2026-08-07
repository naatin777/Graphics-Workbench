---
name: graphics-workbench-packaging
description: Graphics WorkbenchのVSIX内容、dependency、bundled asset、native binary、package sizeを扱う。dependency / bundled CLI / pdf.js / Mermaid / Sharp / Webview asset / .vscodeignore / package script / native binary / generated assetを変更するときに使用する。release手順・公開はgraphics-workbench-releaseを参照。
---

# packaging

VSIXを必要以上に巨大化させず、同時にruntime必須ファイルを誤って除外しない。

## 目的

- production dependencyを正確に把握する。
- runtime必須ファイルを`.vscodeignore`で除外しない。
- Webview bundle・PDF.js・native Sharp assetが正しく含まれる。
- VSIXの実際の内容を確認できる。

## 確認すること(必要なものだけ)

- production dependency vs dev dependency vs transitive dependency
- `.vscodeignore`
- package contents(実際のVSIX内容)
- duplicated assets / source maps / docs / examples / test fixtures
- webview bundle(`media/webview/*/index.js`)
- PDF.js assets
- Mermaid assets
- native Sharp assets(`node_modules/@img/*`、target依存)
- OS-specific files
- runtime dynamic import / require
- executable / binary

単純にサイズを減らすためだけにファイルを除外しない。除外前にruntime dependencyか確認する。

## 実際のVSIX内容を確認する方法

- `npm run package:vsix` でVSIXを作成する。
- `npx vsce ls --tree` または `unzip -l graphics-workbench.vsix` で内容を確認する。
- `node scripts/verify-vsix.mjs --vsix <file> --target <target>` でsharp native asset等の整合を検証する。

## 既存の制約

- `.vscodeignore` に既に除外されているもの(src/、test/、scripts/、AGENTS.md、.opencode/等)を誤って必要としない。
- pdf-libのESM/TS/browser配布はpackaged extensionから除外済み(CommonJS entrypointのみ使用)。
- 6 target VSIX生成とsharp実実行検証はrelease workflow(`graphics-workbench-release` / ADR-0026)の対象。

## releaseとの境界

- 本skill: VSIX内容・dependency・sizeの判断。
- `graphics-workbench-release`: versioning・release前検証・公開。

## テスト

- packaged extensionのsmoke test(`test/playwright/electron/packaged_conversion_smoke.spec.ts`)で、除外し過ぎていないことを確認する。
- 新しいnative binaryやbundled CLIを追加した場合は、packaged smokeで実実行する。
