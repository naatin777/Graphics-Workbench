---
name: graphics-workbench-webview-feature
description: Graphics Workbenchのcrop / merge / split / rotate / reorderのようなWebview機能を追加・変更するときの標準構造と設計判断。host↔webviewのprotocol境界、SolidJSのstate設計、PDF.js、CSP、layout、テストを扱う。単なるUI文言変更では使用しない。
---

# Webview 機能

Webview機能を追加・変更するとき、最も近い既存Webviewを参照する。各Webviewはhost側command、protocol、SolidJS appの3領域に分かれる。

## 参照する既存実装

- host側: `src/commands/pdf/<feature>_configure.ts` と `src/commands/lifecycle/pdf_configure_session.ts`(共有セッション)
- protocol: `src/shared/protocols/<feature>_protocol.ts`
- app: `webview/apps/<feature>/src/`
- テスト: `test/commands/<feature>_configure_command.test.ts`、`webview/apps/<feature>/src/app.test.tsx`

## host側

- `startPdfConfigureSession`(共有セッション)を使う。個別にWebview panelを再実装しない。
- `isWebviewToHostMessage`・`isApplyMessage`・`buildInitMessage`・`runApply`を定義する。
- `localResourceRoots`にapp asset、PDF.js asset、webview shared asset、入力ディレクトリを含める。
- WebviewのCSPとasset URIは`getWebviewHtml` / `getPdfJsAssetsRoot` / `getWebviewSharedAssetsRoot`を再利用する。
- 出力・Undo・Safe Mode・キャンセルは既存のconversion lifecycleを再利用する。

## protocol境界

host↔webview messageはexternal / unknown境界として扱う。

- `isWebviewToHostMessage`で型を絞り、payloadをruntime validationする。
- `protocol_utils.ts`の`hasExactKeys`・`isString`・`isPositiveInteger`・`isWebviewUri`等を再利用する。
- hostile-objectテストを無関係な内部型にまで大量追加しない。境界を越えるmessageだけを検証する。

## state設計

**DOMをapplication stateの正本にしない。**

- ページ順、選択状態、編集状態は明示的stateに保持する(SolidJSのsignal / store)。
- DOM上にmountされている要素数やvirtualized renderingをbusiness stateとして利用しない。
- 大量ページ・virtualization・lazy renderingが導入されても動作する構造を優先する。
- 例: reorderの「32ページ制限を外す」変更では、virtualized previewがstateと独立していることを確認する。

## 確認対象(必要なものだけ)

- host-side command / configure command
- protocol / runtime validation
- Webview initialization / message handling
- application state
- labels / localization(`webview/apps/<feature>/src/labels.ts`、`messages.ts`)
- SolidJS app / shared components(`webview/shared/ui/`、`webview/shared/SplitPane.tsx`)
- PDF.js asset / Vite config / Vitest config / CSP / resource URI
- disposal / loading / error / disabled state
- wide layout / narrow layout / many-page behavior

全ての変更で全項目を確認しない。変更した挙動に関係する状態だけを選ぶ。

## テスト

- protocolのruntime validationはUnit Test。
- host↔webview message処理はIntegration Test。
- SolidJS appの表示・操作は`webview/apps/*/src/app.test.tsx`(Vitest)。
- VS Code上での実表示・幅別layout・PDF.js previewはPlaywright。
- テスト境界と検証方法は`graphics-workbench-verify`を参照。
