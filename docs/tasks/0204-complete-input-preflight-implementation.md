# タスク: 変換入力preflightの未実装契約を完了する

## Status

Done

## 現在の設計変更（2026-07-26）

形式別の深い入力preflightを削除し、安価なjob/path validationだけに簡素化した。形式固有の妥当性は実際の変換backendが判定する。

削除した検査:

- PDF: %PDF- header、pdf-lib parse、暗号化、page count、MediaBox
- Raster: Sharp metadata、dimensions、pixel上限、page/frame数
- SVG: XML parse、root検査、viewBox/dimensions
- Mermaid: テキスト内容、行数
- Draw.io: mxfile/mxGraphModel文字列検査
- EPS: PostScript header、BoundingBox
- warning確認UI（preflight_warning_confirmation.ts）
- onConfirmWarnings（ConversionExecutionContextから削除）

残す検査:

- 対応形式判定
- file存在、regular file、空でない
- Raw sidecar存在とbyte長一致

## 関連

- [入力job validationの内部契約](../specs/internal/input-preflight.md)
