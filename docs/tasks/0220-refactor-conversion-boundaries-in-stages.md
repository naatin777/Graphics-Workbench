# 0220: 変換commandの境界を段階的に整理する

Status: Complete — Phase 17（レビュー指摘の反映）Done

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

## Phase 4 — PNG/JPEG raster source plannerの共通境界を作る（完了）

- PNG/JPEGのPDF以外のsource→job変換を`planRasterSourceConversionJobs`へ分離した
- Native Draw.io経路、same-format判定、PDF planner、形式ごとのoutput templateは各plannerへ残した
- PNG/JPEG commandの既存raster source経路を共通planner経由へ移行した
- 共通plannerのraster入力→page job契約を直接テストで固定した

## Phase 5 — AVIF plannerの境界を作る（完了）

- `planAvifConversionJobs`とPDF page plannerを`convert_to_avif.ts`から分離した
- AVIF commandはplannerを呼び出すcomposition rootとして維持した
- AVIF effort設定、PDFページ展開、出力path、同一形式拒否を直接テストで固定した
- PNG/JPEGと共有できるraster source経路は既存の共通plannerへ寄せ、AVIF固有のencoder設定はcommand側へ残した

## Phase 6 — TIFF plannerの境界を作る（完了）

- `planTiffConversionJobs`とPDF page plannerを`convert_to_tiff.ts`から分離した
- TIFF commandはplannerを呼び出すcomposition rootとして維持した
- TIFFのPDFページ展開、出力path、同一形式拒否を直接テストで固定した
- PNG/JPEG/AVIFと共有できるraster source経路は既存の共通plannerへ寄せた

## Phase 7 — simple raster command shellを導入する（完了）

- selected URI、configuration、max input pixels、prepare、planner、executor、lifecycle、error通知を`runSimpleRasterConversionCommand`へ集約した
- PNG/JPEG/AVIF/TIFF commandを共通shell経由へ移行した
- format固有planner、encoder、AVIF effort、外部tool設定は各command / operation側に残した
- WebP/GIFのanimation output modeは変更していない

## Phase 8 — WebP/GIF animation mode plannerを共通化する（完了）

- animated inputの保持、split時のframe展開、animation pixel limit、output template展開を`planAnimationRasterSourceJobs`へ集約した
- WebP/GIF commandの形式固有PDF planner、output mode定義、encoderは各command / operation側に残した
- `preserve` / `auto` / `split`の既存挙動と、非animation rasterのfirst/all frame挙動を維持した

## Phase 9 — Webview protocol envelope契約を作る（完了）

- Webview messageのtop-level `type` / `payload` envelopeを`webview_protocol.ts`へ分離した
- payloadなしcontrol message、payload付きmessage、error messageのruntime validation境界を直接テストで固定した
- 既存Webview appの通信形式と挙動は変更せず、次のRotate移行で利用できる共通契約だけを追加した

## Phase 10 — Rotate Webview protocolを移行する（完了）

- RotateのHost/Webview message guardを共有envelope helper経由へ移行した
- `ready` / `cancel` のtype-only message、`init` / `apply` / `previewLoadFailed`のpayload検証を維持した
- RotateのUI state、preview、operation、command lifecycleは変更していない

## Phase 11 — Reorder Webview protocolを移行する（完了）

- ReorderのHost/Webview message guardを共有envelope helper経由へ移行した
- `ready` / `cancel` のtype-only message、`init` / `apply` / `previewLoadFailed`のpayload検証を維持した
- ReorderのUI state、preview、operation、command lifecycleは変更していない

## Phase 12 — Crop Webview protocolを移行する（完了）

- Cropの`ready` / `cancel` / `apply` / `previewLoadFailed`を共有envelope helper経由へ移行した
- Crop box、target、preview error payloadの余分なキーを拒否し、既存の座標・ページ検証を維持した
- CropのWebview UI state、preview、operation、command lifecycleは変更していない

## Phase 13 — Split Webview protocolを移行する（完了）

- SplitのHost/Webview message guardを共有envelope helper経由へ移行した
- Splitのinit payload、ページgroup、preview errorの既存検証を維持し、余分なenvelope・payloadキーを拒否した
- Splitのページ式解析、Webview UI、preview、operation、command lifecycleは変更していない

## Phase 14 — Merge Webview protocolを移行する（完了）

- MergeのHost/Webview message guardを共有envelope helper経由へ移行した
- Mergeのsource、init payload、preview error、apply source IDの既存検証を維持し、余分なenvelope・payloadキーを拒否した
- MergeのWebview UI、preview、operation、command lifecycleは変更していない

## Phase 15 — Crop child process protocol境界を厳格化する（完了）

- Crop runnerのstarted / success / failure messageを必須キーのexact envelopeとして検証するようにした
- Crop runner requestとcrop box / targetの余分なキーを拒否し、protocol version、request ID、path、座標、ページ検証を維持した
- child processの起動、キャンセル、termination watchdog、staging lifecycleは変更していない

## Phase 16 — Mermaid runner protocol境界を厳格化する（完了）

- Mermaid runnerのrequest / success / failure response contractを形式固有のprotocol moduleへ切り出した
- requestとresponseの余分なキーを拒否する検証を追加し、Mermaidの出力形式、Puppeteer設定、render options、cancel、timeout、failure処理は維持した
- 単独response contractをWebview向け共通envelopeへ統合せず、形式固有の境界として扱った

## Phase 17 — レビュー指摘の反映（完了）

- `hasExactKeys`を`key in value`から`Object.hasOwn`へ変更し、prototypeから継承された必須キーの通過を拒否した（Webview / Crop child process / Mermaid runnerのprotocol境界を一致させた）
- 複数sourceのplanningを`Promise.all`から逐次実行へ変更し、複数PDF選択時にPDF全体を同時にメモリへ読み込む問題を解消した（simple raster shell、WebP、GIF、SVG、EPS、PDF）
- PDFページ展開を`planPdfPageConversionJobs`（fs/pdf-lib読み込み）と純粋な`planPdfPageJobs`（page count→jobs）へ分離し、PNG/JPEG/AVIF/TIFF/WebP/GIFの重複を削除した
- AVIFのraster source経路を`planRasterSourceConversionJobs`へ寄せ、形式固有の再実装を削除した
- WebP/GIFを`convert_to_webp.ts` / `convert_to_gif.ts`（composition root）、`plan_webp_conversion_jobs.ts` / `plan_gif_conversion_jobs.ts`、`run_animated_raster_conversion_command.ts`（animation専用shell）へ分離した
- raster frame job生成を純粋な`createRasterFrameJobsFromMetadata`へ分離した
- simple raster shellとanimation shellのconfiguration / prepareを`runConversionLifecycle`内部へ移し、error通知とOutput Channel記録の責務を一箇所に統一した
- 純粋planner（`planPdfPageJobs`、`createRasterFrameJobsFromMetadata`）のテストを追加し、Extension Hostなしの`mocha --ui tdd`で直接実行できることを確認した

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
- `npm run check:all`: passed（simple raster command shell切り出し後）
- `npm run compile`: passed（simple raster command shell切り出し後）
- `npm run compile:test`: passed（simple raster command shell切り出し後）
- `npm test`: 520 passing / 6 pending（Extension Host、macOS arm64、Phase 4時点、2026-08-04）
- `npm run check:all`: passed（Phase 9 envelope追加後）
- `npm run compile`: passed（Phase 9 envelope追加後）
- `npm run compile:test`: passed（Phase 9 envelope追加後）
- `npm run check:all`: passed（Phase 10 Rotate移行後）
- `npm run compile`: passed（Phase 10 Rotate移行後）
- `npm run compile:test`: passed（Phase 10 Rotate移行後）
- Targeted Extension Host run（`rotatePdf protocol guard`）: test hostが`SIGABRT`でテスト実行前に終了（既知のlocal runtime制約）
- `npm run check:all`: passed（Phase 11 Reorder移行後）
- `npm run compile`: passed（Phase 11 Reorder移行後）
- `npm run compile:test`: passed（Phase 11 Reorder移行後）
- `npm run check:all`: passed（Phase 12 Crop移行後）
- `npm run compile`: passed（Phase 12 Crop移行後）
- `npm run compile:test`: passed（Phase 12 Crop移行後）
- Targeted Extension Host run（`Crop PDF Webviewプロトコル`）: test hostが`SIGABRT`でテスト実行前に終了（既知のlocal runtime制約）
- `npm run check:all`: passed（Phase 13 Split移行後）
- `npm run compile`: passed（Phase 13 Split移行後）
- `npm run compile:test`: passed（Phase 13 Split移行後）
- Targeted Extension Host run（`定義されたプロトコルの型のみを受け付ける`）: test hostが`SIGABRT`でテスト実行前に終了（既知のlocal runtime制約）
- `npm run check:all`: passed（Phase 14 Merge移行後）
- `npm run compile`: passed（Phase 14 Merge移行後）
- `npm run compile:test`: passed（Phase 14 Merge移行後）
- Targeted Extension Host run（`Merge PDF Webviewプロトコル`）: test hostが`SIGABRT`でテスト実行前に終了（既知のlocal runtime制約）
- `npm run check:all`: passed（Phase 15 Crop child process protocol厳格化後）
- `npm run compile`: passed（Phase 15 Crop child process protocol厳格化後）
- `npm run compile:test`: passed（Phase 15 Crop child process protocol厳格化後）
- Compiled protocol smoke: passed（extra message/request keyを拒否）
- Targeted Extension Host run（`IPC protocol envelope`）: test hostが`SIGABRT`でテスト実行前に終了（既知のlocal runtime制約）
- `npm run check:all`: passed（Phase 16 Mermaid runner protocol厳格化後）
- `npm run compile`: passed（Phase 16 Mermaid runner protocol厳格化後）
- `npm run compile:test`: passed（Phase 16 Mermaid runner protocol厳格化後）
- `mocha --ui tdd out/test/operations/mermaid_runner_protocol.test.js`: 4 passing
- `mocha --ui tdd out/test/commands/plan_pdf_page_jobs.test.js out/test/commands/create_raster_frame_jobs_from_metadata.test.js`: 6 passing（Extension Hostなし）
- `mocha --ui tdd out/test/application/webview_protocol.test.js`: 5 passing（継承された必須キー拒否を含む、Extension Hostなし）
- `npm run check:all`: passed（Phase 17レビュー反映後）
- `npm test`: 544 passing / 6 pending（Extension Host、macOS arm64、2026-08-05）
