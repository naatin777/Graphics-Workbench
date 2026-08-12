# ADR-0029: MermaidとSVG→PDFにはCLIプロセスを使う

## ステータス

採用

## 日付

2026-08-06

## 背景

Mermaidは`@mermaid-js/mermaid-cli`のJavaScript APIを専用IPC child process経由で呼んでいた。SVG→PDFのChrome backendはPuppeteer APIでpageを構成してPDFを生成していた。

どちらもブラウザを起動するが、process lifecycle、エラー、設定経路が外部toolと異なっていた。Mermaid CLIが提供する通常の`mmdc` invocationとChromeのheadless印刷を使う方針へ変更する必要がある。

## 決定

Mermaid変換は、同梱`@mermaid-js/mermaid-cli`の`mmdc` entrypointをNode child processとして実行する。themeとChrome launch設定はmmdcが受け取る一時JSON設定fileへ渡す。

SVG→PDFの`chrome` backendは、Chrome実行ファイルを`--headless --no-pdf-header-footer --print-to-pdf=...`とSVGのfile URLで直接実行する。`rsvg-convert` backendは維持する。

両経路は`graphics-workbench.execPath.chrome`を共有し、指定がない場合はOS標準のChrome commandまたはlocationを使う。Puppeteer APIとFirefox選択設定は公開しない。

## 理由

- MermaidとSVG→PDFを外部processとして同じcancel・timeout・process-tree cleanup contractへ接続できる
- Mermaidの実装をmmdc CLIの公開interfaceへ合わせられる
- Chrome PDF出力を指定したheadless commandとして明示できる
- `puppeteer-core` direct dependencyとIPC固有のprotocol/lifecycleを不要にできる

## 代替案

### Mermaid APIとPuppeteer APIを維持する

browser操作を細かく制御できるが、変換経路ごとに異なるlifecycle実装を維持する必要があり、CLIを直接使う方針と一致しないため採用しない。

### rsvg-convertだけをSVG→PDF backendにする

Chromeが利用できる環境で追加のrsvg-convert installを要求するため採用しない。

## 結果・影響

- Mermaid、Chrome SVG→PDFとも外部tool runnerのdiagnostic、cancel、process-tree cleanupを使う
- Chromeを明示指定する場合は`execPath.chrome`を設定する。Firefox backendは利用できない
- mmdc内部が受け取るPuppeteer設定fileは一時artifactであり、extensionはPuppeteer APIを直接利用しない
- Mermaid CLIのtransitive `puppeteer`はChromium downloadを行わない設定を維持し、実行にはsystem Chromeを使う

## 見直す条件

- mmdc CLIが現在の引数または一時設定fileの受け取りを廃止した場合
- Chromeのheadless印刷がSVG入力で再現可能な破損または安全性の問題を起こした場合
- rsvg-convertが全対象platformで十分な互換性を持ち、Chrome backendを維持する理由がなくなった場合

## 関連

- [ADR-0010: CIの外部ツール検証はVS Code設定経由で行う](0010-verify-external-tools-through-vscode-settings.md)
- [`docs/architecture.md`](../architecture.md)
- [Mermaid描画設定](../specs/product/mermaid-render-settings.md)
