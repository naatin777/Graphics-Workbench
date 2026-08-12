# Refactor Backlog

気になる実装は、すぐ直さずここに記録する。

リファクタリングは、気持ち悪さを消すためではなく、具体的な変更コスト・バグリスク・テスト困難を減らすために行う。

## Rule

リファクタしてよい条件。

- バグリスクがある
- 次の機能追加を妨げている
- テストしづらい
- 同じ問題が3回出た
- ファイルや責務が大きくなり、理解が難しくなっている

リファクタしない条件。

- なんとなく綺麗にしたい
- 命名が気になるだけ
- 軽微な重複
- MVP前の構成整理
- 機能追加のついで

## Template

### タイトル

- Area:
- Type:
  - Duplication
  - Naming
  - Architecture
  - Testability
  - Bug risk
  - Readability
  - Preference

- Why it bothers me:
- Concrete problem:
- Do now?
  - Yes / No

- Condition to do:
- Related files:

---

## Items

### PDF/SVGのstaging batch重複

- Area: conversion operations
- Type: Duplication
- Concrete problem: PDF/SVG operationにもstaging・concurrency・commit・cleanupの似た処理が残っている。
- Evidence: `vscode/src/operations/conversion/convert_to_pdf.ts`と`vscode/src/operations/conversion/convert_to_svg.ts`はraster batchとは別の形式固有pipelineを持つ。
- Trigger: PDF/SVGの安全性変更が同じ境界で3回以上必要になったとき。
- Why not now: PDF/SVGはrasterと異なるtool/encoder差分があり、今回の共通化でgeneric conversion engineへ近づけない。
- Related files: `vscode/src/operations/conversion/convert_to_pdf.ts`, `vscode/src/operations/conversion/convert_to_svg.ts`, `core/src/operations/lifecycle/run_staged_conversion_batch.ts`
- Expected test impact: PDF/SVGの実変換、external tool failure、cleanup、Safe Modeの全suite。
- Reversibility: 形式固有のまま小さいhelperを導入できる。

---

### 重いmupdf処理をExtension Host外へ隔離する

- Area: performance / cancellation
- Type: Architecture
- Concrete problem: 並び替え・回転・分割・結合は`readFile`で入力全体を読み込み、`openPdfDocument` / `graftPage` / `saveToBuffer`の同期区間ではキャンセルが反映されない。大きな入力ではExtension Hostのイベントループが塞がり、キャンセルやOOM時のcleanupが遅れる。
- Evidence: `vscode/src/operations/pdf/reorder_pdf.ts`、`rotate_pdf.ts`、`split_pdf.ts`、`merge_pdf.ts`。
- Trigger: PDF・画像のmupdf/Sharp同期処理が原因の障害報告が再現したとき、またはキャンセル保証を「best effort」から強保証へ上げる必要が出たとき。
- Why not now: Worker Thread / 子プロセスへの隔離は配布物パッケージ、プロセスライフサイクル、staging/Undo契約をまたぐ大規模変更。現状はDraw.io、rsvg-convert、pdftocairo、Mermaidなどの外部toolはprocess単位で終了要求を伝播できる一方、MuPDF/Sharpのprocess内処理はbest effortと明記（ADR-0028）。
- Related files: `vscode/src/operations/pdf/*.ts`、`core/src/operations/lifecycle/run_staged_conversion_batch.ts`。
- Expected test impact: mupdf系操作のキャンセル・OOM・staging/Undoの全suite。
- Reversibility: 操作単位で1つずつ隔離できる。
