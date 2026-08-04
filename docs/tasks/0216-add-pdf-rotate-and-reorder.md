# 0216: PDF回転とページ並び替えを追加する

Status: In progress — Branch 1（rotate quick pick）Implemented

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

## Verification

- `npm run typecheck` / `typecheck:test` / `check:nls` / oxlint: pass
- 操作テスト（回転・選択ページ・既存出力・キャンセル・範囲外）はvscode-testで実行が必要

## Completion conditions

- [ ] 回転QuickPickで全ページを90/180/270度回転できる
- [ ] 回転Configure Webviewで選択ページを回転できる
- [ ] 並び替えConfigure Webviewでページ順を変更できる
- [ ] staging / Safe Mode / Undo / commit境界を維持する
- [ ] 関連テスト・型チェック・lint・buildが通る
