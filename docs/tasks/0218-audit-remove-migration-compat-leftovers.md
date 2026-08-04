# 0218: 途中移行・互換残骸を監査して削除する

Status: Implemented

## Objective

v1移行で削除すると決定済みの旧command alias・compatibility entrypoint・旧NLS・移行専用テストを監査し、途中移行残骸を削除する。

## Audit result

- `graphics-workbench.convertPngToPdf` の内部alias一式が唯一の途中移行残骸だった
  - `src/extension.ts`: `INTERNAL_COMMAND_IDS` / `REGISTERED_COMMAND_IDS` / convertPngToPdf登録
  - `src/commands/conversion/convert_to_pdf.ts`: `convertPngToPdfInternalCommand` / `pngExtensions`
  - NLS: `message.{progress.,}convertPngToPdf.{title,success,failed,cancelled}`（ja/en）
  - `scripts/generate-extension-meta.ts`: `internalCommandIds` → CommandId型
- 旧settings（`execPath.pdfcrop`等）はpackage.jsonに存在せず、履歴taskとmigration specのみ

## Changes

- `src/extension.ts`: 内部alias登録と`INTERNAL_COMMAND_IDS` / `REGISTERED_COMMAND_IDS`を削除。`PUBLIC_COMMAND_IDS`はmanifestテストが使用するため維持
- `src/commands/conversion/convert_to_pdf.ts`: `convertPngToPdfInternalCommand` / `pngExtensions`を削除し、`convertSelectedSourcesToPdf`をcanonical（`convertToPdf` message / `convert-to-pdf` operation）のみに簡素化
- NLS: 旧alias専用message 4キー×2言語を削除。pair-specific設定説明`config.outputPath.convertPngToPdf`は維持
- `scripts/generate-extension-meta.ts`: `internalCommandIds`を除去し再生成
- `test/integration/extension.test.ts`: 旧alias実行を`convertToPdf`へ変更、旧to-PDF commandがruntimeに登録されていないことを明示確認
- `docs/naming-conventions.md`: 削除済み`convertPngToPdfInternalCommand`を良い例から除去し、無期限alias禁止・alias追加時の明記項目を追記
- `AGENTS.md`: 途中移行・互換残骸の再発防止ルールを追加

## Verification

- `npm run check` / `check:extension-meta` / `check:nls`（364 keys）/ `check:unused` / `test:scripts` / `typecheck:test`: pass
- `convertPngToPdfInternalCommand` / `INTERNAL_COMMAND_IDS` / `REGISTERED_COMMAND_IDS`参照0件
- CommandId型はpublicのみ。pair-specific `outputPath.convertPngToPdf`設定とmigration spec（新旧対応表）は維持
- Extension Host test（integration / package_manifest）はCIで検証

## Completion conditions

- [x] `convertPngToPdf`がmanifest・runtimeに存在しない
- [x] `convertPngToPdfInternalCommand`が存在しない
- [x] 旧alias専用NLSが残っていない
- [x] Integration Testがcanonical commandを使用し、旧ID非登録を確認
- [x] `convertToPdf`によるPNG→PDF変換が維持
- [x] pair-specific outputPath設定とmigration noteが維持
- [x] naming-conventions / AGENTS.mdが現行方針と整合
