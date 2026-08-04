# Tasks

## Current Task

- [0208: oxlintの制限を段階的に強化する](0208-gradually-strengthen-oxlint.md) — In progress — Phase 55（0違反のESLintルール群＋prefer-template）Done

## On hold

- なし

## Task boundaries

Taskは小さな作業手順やPR単位ではなく、達成する成果または意思決定を単位とする。

1つのtaskは複数のphase、experiment、PRを含んでよい。

次の理由だけでは新しいtaskを作成しない。

- PRやbranchが別になる
- localとCIで実行場所が異なる
- 実験結果の記録が必要
- script名を変更する
- policy文書を更新する
- maintainerによる判断が必要

新しいtaskへ分けるのは、次のいずれかを満たす場合とする。

- 単独で利用価値がある
- 必要な意思決定が独立している
- 変更範囲またはリスクが大きく異なる
- 別担当で並行して完了できる

## Planned

- なし

## Backlog

ここにあるtaskは未着手または完了条件の再確認が必要な候補であり、Current Taskではない。Statusの変更や完了taskへの移動は、実装・Evidence・maintainer判断を確認してから行う。

### Verification pending

- なし

### Product and architecture decisions

- [0099: Mermaid描画設定の仕様を決める](0099-design-mermaid-render-settings.md) — Spec Complete
- [0119: LaTeX挿入フォーマットの仕様を決める](0119-design-latex-insertion-format.md) — Spec Complete
- [0128: 変換入力preflightの仕様を決める](0128-design-input-preflight-validation.md) — Superseded

### Implementation

_No pending implementation tasks._

### Migration and conditional maintenance

_No pending migration tasks._

## Not Planned

以下はmaintainer判断により実施しない。task fileは履歴として保持する。

- [0106: splitPdf.configure GUIの仕様を決める](0106-design-split-pdf-configure-gui.md)
- [0107: splitPdf.configure GUIの失敗テストを追加する](0107-add-split-pdf-configure-gui-tests.md)
- [0108: splitPdf.configure GUIを実装する](0108-implement-split-pdf-configure-gui.md)
- [0109: mergePdf GUIの仕様を決める](0109-design-merge-pdf-gui.md)
- [0110: mergePdf GUIの失敗テストを追加する](0110-add-merge-pdf-gui-tests.md)
- [0111: mergePdf GUIを実装する](0111-implement-merge-pdf-gui.md)
- [0127: PDF処理バックエンドを比較評価する](0127-evaluate-pdf-processing-backends.md)
- [0097: PDFページを1つの画像へ結合する仕様を決める](0097-design-pdf-pages-to-single-image.md)
- [0134: splitPdfのoutputPath事前検証失敗テストを追加する](0134-add-split-output-path-preflight-tests.md)

## Recent Completed

- [0219: command登録と生成metadataの正本を整理する](0219-consolidate-command-registration-and-generated-metadata.md) — Done — command binding正本化・data-driven登録・pure manifest/config adapter分離・metadata生成・manifest検証（PR #119–#122、全CI green・マージ済み）
- [0218: 途中移行・互換残骸を監査して削除する](0218-audit-remove-migration-compat-leftovers.md) — Done — `convertPngToPdf`内部alias・wrapper・旧NLSを削除し、canonicalへ統合。Integration Testと再発防止ルールを更新（PR #118）
- [0217: 入力制限・タイムアウト方針を確定する](0217-finalize-input-limit-and-timeout-policy.md) — Done — `confirmLargeOperation`削除、外部ツールtimeout既定0/`undefined`、ADR-0028・AGENTS.md・README反映、CI検証済み
- [0216: PDF回転とページ並び替えを追加する](0216-add-pdf-rotate-and-reorder.md) — Done — rotate quick pick / configure webview、reorder configure webviewを追加（PR #111-113）
- [0215: Playwrightのpixel matchingを廃止し目視レビューへ移行する](0215-drop-playwright-pixel-matching.md) — Done — `toMatchSnapshot` / `__snapshots__` / `PLAYWRIGHT_VISUAL_SNAPSHOTS` / Docker visual runnerを削除し、`visual:capture`（OS非依存）＋目視レビューへ移行。ADR-0027新設・ADR-0024/0025置き換え
- [0214: 6 target VSIXをネイティブランナーで生成・検証・公開する](0214-native-runner-platform-vsix-release.md) — Done — 5 targetをネイティブランナーで生成しsharpを実実行検証、win32-arm64はcross維持、`--skip-duplicate`とPAT未設定ガード、ADR-0026新設・ADR-0023置き換え
- [0213: Playwright基準画像の更新をCIからローカルへ移す](0213-move-playwright-baseline-updates-locally.md) — Done — CIから`[update-snapshots]` / artifact配布 / bot commit / PRコメントを削除し、基準画像更新をローカルDocker + git pushへ一本化。ADR-0025新設・ADR-0024置き換え
- [0212: package済みPlaywrightのOS別責務を再配分する](0212-rebalance-packaged-playwright-platform-coverage.md) — Done — PRはLinux full visual + macOS / Windows packaged smoke、releaseは3 OS full screenshot artifact、localはmulti-arch Docker Linux full。Docker amd64のEvidenceはpending
- [0211: パッケージ済みElectron E2Eの安定性・幅別UI検証を改善する](0211-stabilize-packaged-playwright-e2e.md) — Done — Electron E2Eを17ケース×2幅へ安定化し、重複テストを統合
- [0210: 変換機能と出力パス設定の仕様調査・互換コード削減](0210-investigate-conversion-spec-and-compat.md) — Done — 到達不能分岐修正・二重キー削除・orphan NLS削除・テスト追加
- [0209: P1レビュー指摘の修正](0209-fix-p1-review-findings.md) — Done — Undo履歴・dynamic import・Mermaidキャンセル・PDF Progress・実行パスscope
- [0207: パッケージ済みPlaywrightテストの実行時間を短縮する](0207-speed-up-packaged-playwright-tests.md) — Done — VSIX installation shared per spec; Windows Playwright 7.6m → 2.0m
- [0206: 現行テスト契約を整理する](0206-organize-current-test-contracts.md) — Done — current test matrix synchronized; golden content fixtures deferred
- [0205: v1のtest contractを整理する](0205-organize-test-contracts.md) — Done — Evidence matrix and runtime records synchronized
- [0100: editable Draw.io画像用の元ファイル名テンプレート変数を決める](0100-design-original-source-template-variables.md) — Done — 追加変数なし
- [0098: 既存ペア別outputPath設定の移行方針を決める](0098-decide-pair-output-path-settings-migration.md) — Done — pair-specific outputPathを正本化
- [0203: dev test toolingのserialize-javascript vulnerabilityを更新する](0203-update-dev-test-tooling-serialize-javascript.md) — Done — overrideで7.0.5へ解決
- [0096: 複数画像を1つのPDFへ結合する仕様を決める](0096-design-combine-images-to-single-pdf.md) — Spec + 実装完了
- [0101: sharp更新のDependabot対応を再評価する](0101-evaluate-sharp-dependabot-update.md) — Done — Superseded
- [0202: npm移行で失われた依存install security policyを復元する](0202-restore-npm-dependency-security-policy.md)
- [0180: パッケージ済みVSIXのオフライン3 OS smoke testを追加する](0180-add-packaged-vsix-offline-smoke-tests.md)
- [0204: 変換入力preflightの未実装契約を完了する](0204-complete-input-preflight-implementation.md) — Done
- [0201: Node-level testの実行基盤を決定する](0201-decide-node-test-runtime.md)
- [0200: Node test runtimeを小規模検証する](0200-experiment-node-test-runtime.md)
- [0199: v1 test Evidence inventoryを完了する](0199-complete-test-evidence-inventory.md)
- [0198: v1開発基盤の前提を監査する](0198-audit-v1-development-foundation.md)
- [0197: CI・Playwright・VSIX releaseを4 workflowへ整理する](0197-verify-cross-platform-vsix-release.md)
- [0195: README・NLS・設定・task archiveを同期する](0195-sync-docs-settings-and-task-archive.md)
- [0196: v1構造とハーネスを簡素化する](0196-simplify-v1-architecture-and-harness.md)

## Archive

- [完了task archive](archive/completed.md)

個別のtask fileは削除せず、archiveから参照できる番号範囲に整理する。
