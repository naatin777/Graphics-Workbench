# 0220: 変換commandの境界を段階的に整理する

Status: In progress — Phase 3（JPEG planner切り出し）Done、次はPNG/JPEG raster source plannerの共通境界

## Objective

現在の外部挙動を維持したまま、変換commandの責務を小さな境界へ分ける。行数削減を目的にせず、planner・lifecycle・operationの変更軸を分離して、仕様変更時の変更増幅度とテスト困難性を下げる。

## Scope

- 現在の出力path、出力形式、ページ数、通知、キャンセル、Safe Mode、Undoを維持する
- 既存commandを一度に廃止せず、標準経路へ形式・command単位で移行する
- planner共通化は、入力→jobの契約をテストで固定してから行う
- Webviewのtransport共通化は、protocol境界とstate reducerの契約を先に固定してから行う

## Non-goals

- 新しい変換形式、UI、設定、エラーメッセージの追加・変更
- Safe Mode、staging、commit/rollback、Undoの仕様変更
- operationのraster executorを巨大なformat registryへ統合すること
- リポジトリ全体の削減率やproduction LOCを先に約束すること

## Phase 0 — 現在の契約を固定する

production codeを変更せず、次の入力→出力契約をfixture matrixで追加確認する。

- source / workspace / output path
- PDFのページ展開とpage template
- raster animation frameの扱い
- 同一形式拒否とエラー種別・メッセージ
- configuration fallback
- native Draw.io経路

既存のcommandテスト・operationテストで既に保証されている契約は重複を避け、不足する観測点だけを追加する。

### 実施結果

- 既存のExtension Host / operation / lifecycle testを維持し、挙動の基準として使用した
- PDF圧縮・リニアライズのcommand成功経路を追加確認した
- PNG plannerの直接テストで、PDFページ展開・出力path・同一形式拒否を固定した

## Phase 1 — 既存lifecycleを使い切る（完了）

- `linearizePdf`を`runConversionLifecycle`へ移行する
- `compressPdf`を同じ経路へ移行する
- quality QuickPickはcommand adapterに残す
- operation、output path、メッセージ、Safe Mode、Undoの外部挙動を変更しない

## Phase 2 — PNG plannerの境界を作る（完了）

- `planPngConversionJobs`とPDF page plannerを`convert_to_png.ts`から分離した
- PNG commandはplannerを呼び出すcomposition rootとして維持した
- JPEG、AVIF、TIFFとはまだ共有していない

## Phase 3 — JPEG plannerの境界を作る（完了）

- `planJpegConversionJobs`とPDF page plannerを`convert_to_jpeg.ts`から分離した
- JPEG commandはplannerを呼び出すcomposition rootとして維持した
- JPEG plannerのPDFページ展開・出力path・同一形式拒否を直接テストで固定した
- PNG/JPEGのplannerはまだ共有していない

## Phase 4以降 — plannerを形式ごとに移行する

1. JPEGで同じplannerを利用し、具体例から共通機構を確定する
2. PNG/JPEGへraster source plannerを導入する
3. AVIF/TIFFを個別に移行する（AVIF effortは形式固有のまま保持）
4. 共通性が実証された後にsimple raster command shellを導入する
5. WebP/GIFはanimation output modeだけを共有する
6. Webviewはprotocol envelope → reducer → Rotate → Reorder → Crop/Split/Mergeの順で移行する

旧plannerと新plannerの移行時は、fixture上でjob、エラー、fallback、template展開を正規化して比較する。productionで二重実行はしない。

## Completion criteria

- 公開command IDとpackage.jsonの設定が完全一致する
- 既存テストが全件維持される
- 各phaseが単独でbuild/test可能である
- 出力path、出力形式・ページ数、通知、キャンセル、Safe Mode、Undoがfixtureまたはcommand testで一致する
- 新しいsimple raster形式の追加時、既存形式のcommandを編集せず、形式固有定義・encoder・testを中心に変更できる
- 行数ではなく、仕様変更ごとの変更ファイル数と共通moduleの分岐増加を記録する

## Evidence

- 添付調査結果: 現在の挙動を契約として固定し、テスト可能な境界を作ってから共通化する
- `docs/tasks/0210-investigate-conversion-spec-and-compat.md`: planner共通化は入力形式・出力path・operationを混同しない後続課題
- `src/commands/lifecycle/run_output_conversion.ts`: progress、cancellation、Undo、notification、Output Channelの既存標準経路
- `npm run check:all`: 静的検証と生成metadata/NLS/unused/script検証
- `npm test`: 517 passing / 6 pending（Extension Host、macOS arm64、2026-08-04）
