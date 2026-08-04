# 0217: 入力制限・タイムアウト方針を確定する

Status: Implemented

## Objective

入力ファイルサイズ、PDFページ数、処理時間の制限方針を確定し、コード・ドキュメント・開発ルールへ反映する。制限値の追加・削除を繰り返さない状態にする。

## Decision

[ADR-0028](../adr/0028-no-global-input-limits-or-processing-timeout.md)に記録した。

- 入力ファイルサイズ・PDFページ数にアプリケーション共通の固定上限を設けない
- 変換などの本処理にアプリケーション共通の実行タイムアウトを設けない（停止はユーザーのキャンセル）
- ファイルサイズ・ページ数だけを理由とした確認ダイアログを表示しない
- タイムアウトは制御処理（起動確認、通信、キャンセル後の終了猶予）にのみ使用する

## Changes

- 削除: `confirmLargeOperation`（1000ページ / 500MB閾値のモーダル確認）一式
  - `src/commands/lifecycle/large_operation_warning.ts` / `src/config/large_operation_warnings.ts`
  - 呼び出し箇所5件（`run_output_conversion`、`crop_pdf_configure`、`merge_pdf`×2、`split_pdf_commands`×2）
  - package.json `largeOperationWarnings.*`、NLSキー、生成メタ
- `runConversionLifecycle` の警告専用オプション `sourcePaths` / `pdfPageCount` を除去（convert_* 呼び出し元含む）
- 外部ツール `externalTools.*.timeoutSeconds` の既定を0（無効）へ変更。設定機構は残し、ユーザー環境でハングする場合の選択肢を維持
- 維持: `raster.maxInputPixels` / `maxAnimationPixels`（decompression bomb対策）、`preview.maxCanvasPixels` / `maxDevicePixelRatio`（canvas描画制約）、`performance.maxConcurrentHeavyProcesses`（資源安定）、Mermaid WS起動待ち（制御タイムアウト）、staging / cleanup / commit、キャンセル時のプロセス終了（taskkill / SIGTERM）
- ADR-0028作成、AGENTS.mdに再発防止ルール追加、README（ja/en）にユーザー向け説明追加
- テスト: `test/config/large_operation_warnings.test.ts`削除、`generated_extension_configuration.test.ts`更新（qpdf timeout既定0）

## Verification

- `npm run check` / `check:nls` / `typecheck:test`: pass
- 既存テスト（キャンセル時のプロセス終了、staging cleanup、atomic commit）で安全性を担保

## Completion conditions

- [x] 入力ファイルサイズ・PDFページ数に共通固定上限がない
- [x] 本処理に共通実行タイムアウトがない（外部ツールtimeout既定0）
- [x] サイズ・ページ数だけを理由とした確認ダイアログがない
- [x] セキュリティガード（ピクセル上限など）は維持
- [x] 制御タイムアウトと本処理タイムアウトを区別
- [x] キャンセルは外部プロセスまで伝播し、終了しない場合は強制終了
- [x] 方針がADR-0028に記録、AGENTS.mdに再発防止ルール
- [x] lint / 型チェック / テストが通る
