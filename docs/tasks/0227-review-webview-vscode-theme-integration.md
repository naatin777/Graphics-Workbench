# 0227: Webview UIをVS Codeのテーマ・フォント・Zoomへ自然に追従させる

## Status

Done

## 目的

Graphics Workbenchの全Webview（crop / split / merge / rotate / reorder）のCSS / UI実装をレビューし、VS CodeがWebviewへ提供するCSS variablesとブラウザ標準のレイアウト機能を使ってユーザー環境（テーマ・UIフォントサイズ・ウィンドウZoom・Editor幅）へ自然に適応させる。VS Codeっぽい見た目を自前で再現しない。

## 変更内容

- `webview/shared/ui/ui.css`: base化。`body`のfontは`--vscode-font-family` / `--vscode-font-size`、`button/input/select/textarea { font: inherit }`、`* { box-sizing }`、`.sr-only`、`:root { font-size: var(--vscode-font-size) }`（rem基準）を集約。固定font-size（12px/13px/11px）を`inherit` / `em`へ、固定min-heightを`em`へ。未使用の`.gw-form` / `.gw-field*` / `.gw-divider` / `.gw-sash` / `.preview-panel` / `.preview-scroll-area` / `--gw-*`aliasを削除。`.field` / `.field__label`を集約。
- 全appの`styles.css`: `body` / `:root` / box-sizing / font inherit / `.sr-only`の重複を削除し、ui.cssへ委譲。制御スタイル（`.input` / `.button` / `.target` / `.actions`）の重複定義を削除。
- 右側設定パネル幅: 固定px（360 / 300 / 260px）を`flex: 0 0 clamp(min, vw, max)`（rem + vw）へ。Zoom 200% / narrow editor / Editor group分割でも破綻しない。
- split: ハードコードされたダークテーマfallback色（`#cccccc`等）を削除。`group-row__output-path`を`--vscode-editor-font-family`へ。`.segmented__button:focus-visible`を追加。
- rotate / reorder: `opacity`による色表現を`--vscode-descriptionForeground`へ。`@media (max-width: 820px)`の縦積みbreakpointを追加。High Contrast用に`--vscode-contrastBorder`境界を追加。reorderのページ上コントロール背景を半透明→solid（HCはsolid背景）。
- markup整理: crop / splitの冗長class（`input` / `target`）を削除、splitのAdd buttonを`gw-button gw-button--secondary`へ。
- VS Code window zoomの独自補正・`window.zoomLevel`参照は元から無いことを確認（追加しない）。PDF Preview Zoomはcanvasの`width/height`のみでUIと独立していることを維持。
- `knip.json`: Docker pre-push hookの`check:all`がknipの`lefthook`誤検出（CI env / git hooks無しのため未使用扱い）で失敗する既存問題を修正（`ignoreDependencies`へ追加）。webview変更とは独立のinfrastructure fix。

## 対象外

- PDF処理ロジック、crop計算、conversion lifecycle、staging、rollback、command architecture、extension API
- SolidJS component分割（CSS整理に直接必要なもの以外）
- SplitPaneのドラッグ最小幅JS値（240/120pxは操作制約でありCSSではない）
- Excalidraw webview（Node側jsdom用でありユーザー向けWebviewではない）

## 確認方法

- `npm run check`（lint / format / typecheck / typecheck:test / typecheck:webview / typecheck:webview:test）
- `npm run test:webview`（5 appのvitest）
- `npm run check:webview-warnings` / `npm run check:unused`
- `npm run compile:webview`
- 手動: VS Code Zoom 100/150/200%、Editor幅（広・通常・narrow・split）、テーマ（Dark / Light / High Contrast / High Contrast Light）、UIフォントサイズ変更

## 結果

完了。全Webview（crop / split / merge / rotate / reorder）をVS Code CSS variablesとremベースのレイアウトへ移行し、テーマ・UIフォントサイズ・ウィンドウZoom・Editor幅へ自然に適応させた（PR #236）。
