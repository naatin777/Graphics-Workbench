# 0225: drop/paste edit providerをLaTeX以外の文書形式（Typst / Quarkdown）へ拡張する

Status: Done

## Objective

`src/edit_provider/` のdrag & drop / clipboard paste挿入を、LaTeX専用からTypst・Quarkdownにも対応させる。複数ファイルdrop時は形式別にラップする。

## Background

現行のedit providerは`latex` / `tex`言語のみ対応し、`insertLatex.pdfTemplate` / `insertLatex.imageTemplate`を使う。複数drop時はLaTeXの`subfigure`環境で固定ラップする。

Typst / Quarkdownを追加し、複数dropも形式別ラップに拡張する。

## Changes

- `src/edit_provider/insertion_format.ts`: `InsertionFormat`（'latex' | 'typst' | 'quarkdown'）＋言語selector定義
- `src/edit_provider/latex_template.ts`: format別テンプレート取得（`insertTypst.*` / `insertQuarkdown.*`）を追加
- drop / paste providerをformat対応に
- 複数dropラップ: LaTeX=`subfigure`、Typst=`#grid(columns: 2, ...)`、Quarkdown=`.row alignment:{spacebetween}`
- `package.json`: `insertTypst.*` / `insertQuarkdown.*` 設定、activationEvents（onLanguage:typst / onLanguage:quarkdown）
- `scripts/generate-extension-meta.ts`: `quote()`がシングルクォート文字列内の不要な`\"`エスケープを除去（ダブルクォートを含む既定テンプレート対応）
- NLS（`package.nls.json` / `package.nls.ja.json`）: `insertFigure`ラベル + 設定説明
- `src/generated/extension_manifest.ts`: generatorで再生成
- テスト: `insertion_format_drop.test.ts` / `insertion_format_paste.test.ts` 追加（8件）
- `docs/specs/product/latex-insertion-format.md`: Typst / Quarkdown対応に更新

## Verification

- `npm run check:all` pass
- Extension Host suite: 570 passing（新規8件含む）、0 failing

## Non-goals

- Quarkdownの自動figure化・caption番号制御
- Typstの`figure`補完
- 画像drop（現行はPDFのみdrop、画像はpaste）の追加

## Acceptance criteria

- latex / tex / typst / quarkdown言語のdocumentでdrop / pasteが機能する
- 複数drop時、形式別のラップ（subfigure / grid / .row）が生成される
- 既定テンプレート: Typst=figure、Quarkdown=![name](path 'name')
