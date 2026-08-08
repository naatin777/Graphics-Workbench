# 0229: Safe Mode周辺UIをControlsパネルへ整理する

## Status

Done

## 目的

Safe Mode単独のツールバーボタンをやめ、アイコンのみのControlsボタンに置き換える。クリックで開く1つの小さなポップオーバー（QuickPick）に「その場で切り替えたい項目」と「実行環境の状態」をまとめる。VS Code Settingsを置き換えるものではない。

## 変更内容

- `src/commands/lifecycle/controls_panel.ts`（新規）: `$(sliders)`アイコンのみのstatus bar item（tooltip: `Graphics Workbench Controls`）を配置し、`graphics-workbench.openControls`でQuickPickポップオーバーを開く。パネルは以下3ブロック。
  - Tools: SVG → PDF変換エンジンをラジオ選択（`convertToPdf.svg.engine`へ保存）。Autoなし、自動フォールバックなし。
  - Safe Mode: 既存`SafeModeState`（globalState `safeMode.enabled`）をSingle Source of TruthとしてON/OFFだけ同期。
  - Feature availability: PDF operations / Images / SVG → PDF / Draw.io / Mermaid を機能単位で✓/✕表示し、`Check again`で再チェック。
- `src/commands/lifecycle/safe_mode.ts`: 単独のSafe Mode status bar item作成と`updateStatusBar`を削除。`getSafeModeState()`を公開。
- `src/commands/shared/environment_check.ts`: ユーザー視点の機能単位で利用可否を返す`runFeatureAvailabilityChecks`を追加。内部で既存のtool probe（drawio/mermaid CLI/chrome/SVG→PDF）を再利用。
- `graphics-workbench.openControls` commandを`package.json`・`command_bindings.ts`へ追加しmanifest再生成。NLSキー（en/ja）追加。
- ツールバー上のSafe Modeボタン削除に伴い`safe_mode_status_bar.test.ts`を`controls_panel.test.ts`へ置き換え。

## 検証

- `npm run check`（lint / format / typecheck / typecheck:test / typecheck:webview / typecheck:webview:test）
- `npm test` 585 passing（controls_panel 7件・runFeatureAvailabilityChecks 5件を含む）
- `npm run check:extension-meta` / `npm run check:nls` / `npm run check:unused` / `npm run test:scripts`
