# 0216: PDF回転とページ並び替えを追加する

Status: Implemented — Branch 1〜3 Done

## Objective

PDFページの回転（QuickPick方式とConfigure Webview方式）と、ページ並び替え（Configure Webview方式）を追加する。

## Decision

既存のcrop / split / mergeと同一のoperation → staging → Safe Mode → Undo → commit境界に従う。回転はQuickPick版（全ページ90/180/270）とWebview版（選択ページ）の2方式、並び替えはWebview版とする。

## gt stack

1. `feat(pdf): rotate PDF via quick pick` — `rotatePdfFiles`操作 + `rotatePdf.rotate`コマンド + NLS + manifest + spec + 操作テスト
2. `feat(pdf): rotate PDF configure webview` — `rotate_pdf_protocol` + Webview app + `rotatePdf.configure`コマンド
3. `feat(pdf): reorder PDF pages` — `reorder_pdf_protocol` + Webview app + `reorderPdf.configure`コマンド

## Changes (Branch 1)

- `src/operations/pdf/rotate_pdf.ts` — `rotatePdfFiles`（pdf-lib `copyPages` + `setRotation(degrees(angle))`、`pageIndices`で選択ページ、省略時は全ページ）
- `src/commands/pdf/rotate_pdf.ts` — `rotatePdfCommand`（QuickPick 90/180/270）
- `src/extension.ts` — `graphics-workbench.rotatePdf.rotate`登録
- `package.json` / `package.nls.json` / `package.nls.ja.json` — command / submenu / menus / `outputPath.rotatePdf` / `contextMenu.rotatePdf.enabled`
- `src/generated-extension-meta.ts` — 再生成
- `docs/specs/product/rotate-pdf.md` / `docs/specs/internal/rotate-pdf.md`
- `test/operations/rotate_pdf.test.ts`

## Changes (Branch 2)

- `src/application/protocols/rotate_pdf_protocol.ts` — init / applyプロトコルとランタイムguard
- `webview/apps/rotate_pdf/` — SolidJS app（ページサムネイル選択 + 90/180/270ラジオ + select all + Apply）
- `src/commands/pdf/rotate_pdf_configure.ts` — `rotatePdf.configure`（Webview起動 → apply → `rotatePdfFiles`）
- `src/extension.ts` — `graphics-workbench.rotatePdf.configure`登録
- `package.json` / NLS — configureコマンド、webviewラベル、`compile:webview:rotate_pdf` / `test:webview:rotate_pdf`
- `docs/specs/product/rotate-pdf-configure.md` / `docs/specs/internal/rotate-pdf-configure-protocol.md`
- `test/operations/rotate_pdf.test.ts` — protocol guardテスト追加
- `webview/apps/rotate_pdf/src/app.test.tsx` — vitest 3件

## Changes (Branch 3)

- `src/operations/pdf/reorder_pdf.ts` — `reorderPdfFiles`（`copyPages`で`pageOrder`順に出力、順列を検証）
- `src/application/protocols/reorder_pdf_protocol.ts` — init / applyプロトコルとランタイムguard
- `webview/apps/reorder_pdf/` — SolidJS app（ページ上下移動 + Apply）
- `src/commands/pdf/reorder_pdf_configure.ts` — `reorderPdf.configure`
- `src/extension.ts` — `graphics-workbench.reorderPdf.configure`登録
- `package.json` / NLS — reorder manifest / ラベル / scripts
- `docs/specs/product/reorder-pdf-configure.md` / `docs/specs/internal/reorder-pdf-configure-protocol.md`
- `test/operations/reorder_pdf.test.ts` — 操作 + protocol guardテスト
- `webview/apps/reorder_pdf/src/app.test.tsx` — vitest 3件

## Verification

- `npm run check` / `npm run check:nls` / `npm run test:webview`（5 app・18 tests）: pass
- 操作テスト（回転・並び替え・既存出力・キャンセル・範囲外）はvscode-testで実行が必要

## Completion conditions

- [ ] 回転QuickPickで全ページを90/180/270度回転できる
- [ ] 回転Configure Webviewで選択ページを回転できる
- [ ] 並び替えConfigure Webviewでページ順を変更できる
- [ ] staging / Safe Mode / Undo / commit境界を維持する
- [ ] 関連テスト・型チェック・lint・buildが通る
