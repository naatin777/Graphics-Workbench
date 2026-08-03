# 0215: Playwrightのpixel matchingを廃止し目視レビューへ移行する

Status: Implemented

## Objective

Playwrightのスクリーンショットをpixel matchingによるVisual Regression Testに使うのをやめ、通常のE2E assertionと、人間が目視確認するスクリーンショット生成に役割を分離する。

## Decision

[ADR-0027](../adr/0027-visual-review-instead-of-pixel-matching.md)に記録した。ADR-0024 / ADR-0025を置き換え済みにした。

## Changes

### pixel matchingの削除

- `test/playwright/electron/helpers/electron_snapshot.ts`（`expectLinuxSnapshot`、`toMatchSnapshot`）を削除
- `test/playwright/electron/__snapshots__/`（144 PNG）を削除
- `playwright.config.mjs`の`snapshotPathTemplate`を削除
- crop / merge / splitのテーマテストから`expectLinuxSnapshot`呼び出しとscreenshot capture / attachを除去し、theme class / body背景色・前景色の変化 / PDF canvas readableのassertionだけに整理
- `.github/workflows/playwright.yml`から`PLAYWRIGHT_VISUAL_SNAPSHOTS` / `snapshot_enabled` / `visual_snapshots`とactual/diff artifactを削除
- `.github/workflows/release.yml`の`package-smoke`から`PLAYWRIGHT_VISUAL_SNAPSHOTS`を削除し、`visual:capture`で生成した画像をreview artifactへ置換

### visual reviewの追加

- `test/playwright/electron/helpers/visual_review.ts` — `artifacts/visual-review/<platform>-<arch>/<screen>-<state>.png`へ書き出すヘルパ
- `test/playwright/electron/visual_review_capture.spec.ts` — crop / merge / splitをdark / light / high-contrast / high-contrast-light / red / abyssで撮影（OS非依存、`page.screenshot()`ベース）
- `package.json`に`visual:capture`を追加し、`test:playwright:vsix`を`--grep-invert "visual review"`でcaptureと分離
- `.gitignore`に`/artifacts/` `/blob-report/`を追加。reference画像は`test/playwright/electron/visual-review/references/`でGit管理
- `test/playwright/electron/visual-review/README.md`を追加

### その他

- `docker/playwright-visual`（snapshot再生成専用）を削除
- 関連ドキュメント（test-policy、packaging、ci-evidence-map、test-matrix、test-file-inventory、browser-electron-overlap、evidence-gaps、test-runtime-inventory、ADR）を同期

## Verification

- `npm run typecheck:test`通過
- `npx oxlint`通過（変更したtestファイル）
- `npm run test:playwright:vsix -- --list`が33 tests（capture除外）
- `npm run visual:capture -- --list`が3 tests（wideのみ）
- `git diff --check`通過

## Completion conditions

- [x] pixel matchingによる合否判定が残っていない
- [x] E2EテストがDOM・状態・操作・結果を検証している
- [x] 目視確認用画像を`visual:capture`で明示的に生成できる（OS非依存）
- [x] generated画像（`artifacts/`）とreference画像（`references/`）が分離されている
- [x] generated / report / test-resultsがGit管理されない
- [x] ファイル名が`<screen>-<state>.png`
- [x] Visual Review READMEに目的と手順が記載されている
- [x] ADR-0027採用、ADR-0024/0025置き換え済み

## Related files

- `test/playwright/electron/*`（spec / helpers / visual-review）
- `playwright.config.mjs`
- `package.json`
- `.gitignore`
- `.github/workflows/playwright.yml` / `release.yml`
- `docs/adr/0024-*` / `0025-*` / `0027-*`
- `docs/specs/internal/test-policy.md` / `packaging.md`
- `docs/foundation/*`
- `docs/test-matrix.md`
