# 0213: Playwright基準画像の更新をCIからローカルへ移す

Status: Implemented

## Objective

Playwright基準画像の更新を、CIのartifact経由の往復から「ローカルで確定してGitにpush」へ一本化する。

CIは基準画像の比較（verify）だけを行い、`[update-snapshots]`による再生成・artifact配布・bot commit・PRコメントの導線を削除する。

## Decision

[ADR-0025](../adr/0025-commit-playwright-baselines-from-local-docker.md)に記録した。ADR-0024を置き換え済みにした。

## Changes

- `.github/workflows/playwright.yml`
  - `workflow_dispatch`の`update_snapshots` inputを削除
  - `[update-snapshots]`マーカー検出step（`snapshot_flag`）を削除
  - 再生成前のLinux snapshot削除stepを削除
  - `--update-snapshots`実行stepを削除し、常時verifyの単一run stepに統合
  - 成功時の`playwright-screenshots-linux` artifactアップロードを削除
  - `commit-snapshots` job（bot commit / push）を削除
  - `comment-screenshots` job（PRコメントのartifact導線）を削除
  - failure時のreport / trace / actual / diff画像のartifact保存は維持
- `docs/adr/0025-commit-playwright-baselines-from-local-docker.md`を新設
- `docs/adr/0024-artifact-only-playwright-screenshots.md`を置き換え済みに更新

## Verification

- `python`または`node`で`playwright.yml`がYAMLとしてparseできること
- `git diff --check`が通ること
- workflowから`[update-snapshots]`、`commit-snapshots`、`comment-screenshots`への参照が残っていないこと
- ローカル再生成経路（`docker/playwright-visual` + `PLAYWRIGHT_UPDATE_SNAPSHOTS`）は変更していないことをdiffで確認

## Completion conditions

- [x] CIはLinux wide+narrowのpixel比較をcommit済みbaselineに対してのみ実行する
- [x] CIのsnapshot再生成・artifact配布・bot commit・PRコメントの導線が存在しない
- [x] ローカルのDocker再生成手順が残っている
- [x] ADR-0025が採用、ADR-0024が置き換え済みになっている

## Related files

- `.github/workflows/playwright.yml`
- `docs/adr/0024-artifact-only-playwright-screenshots.md`
- `docs/adr/0025-commit-playwright-baselines-from-local-docker.md`
- `docker/playwright-visual/README.md`
- `test/playwright/electron/helpers/electron_snapshot.ts`
