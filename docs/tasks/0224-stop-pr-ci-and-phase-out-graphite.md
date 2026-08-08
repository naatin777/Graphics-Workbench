# 0224: PR CIを停止し、Graphite廃止し、ローカルDocker test環境を導入する

Status: Done

## Objective

Stacked PR開発を続ける上で重荷になっているPR時CI（3 workflow）を全停止し、branch protection rulesetのrequired status checksを緩和する。あわせてGraphite廃止（plain git + ghへの移行）の手順を確定し、実装する。

## Background

- PRごとに `check.yml` / `test.yml`（3OS Extension Host coverage + Webview）/ `playwright.yml`（3OS packaged smoke）が走り、3つともruleset `protect-main` のrequired status checkになっている。
- Stacked PR（A修正→B/C restack）で各PRに重いCIが走り、開発がボトルネックになる。
- 本格的なCI再構成は作業が多いため、まずCI全停止で自由を取り、ローカルでのDockerテスト運用へ移行する。
- Graphiteはrebaseが発生するため廃止し、plain git + ghへ戻す方向。

## Changes

### Phase 1: CI全停止 + ruleset緩和

- `check.yml` / `test.yml` / `playwright.yml` の `on:` を `workflow_dispatch` のみにする（PR / pushで自動実行しない）。
- ruleset `protect-main` から `required_status_checks` ruleを外す（PR mergeがブロックされないようにする）。PR必須・linear history等の他のruleは維持。
- `release.yml`（tag時）は変更しない。

### Phase 2: Graphite廃止

ユーザー判断: Graphiteを廃止し、plain git + ghへ戻す（rebaseが発生するため）。

実装済み:

1. `scripts/check-prs-landed.mjs` + `scripts/check-prs-landed.test.mjs` + `package.json` の `check:prs-landed` を削除
2. `.opencode/skills/graphite-stacked-pr/` と `.opencode/skills/parallel-development/` を削除
3. `origin/graphite-base/215-219` はmerge時にGitHubが削除済みであることを確認し、staleなlocal refを `git fetch --prune` で除去
4. 参照の掃除: `never-disable-git-hooks` skill内のGraphite言及、`docs/tasks/0223` のgraphite-stacked-pr項目を削除
5. plain git + gh運用の手順書・AGENTS.md反映は後続タスク（Docker test環境と併せて）

### Phase 3: ローカルDocker test環境

ユーザー判断: local（PRを除く）testは全部Dockerで実行する。

実装済み:

- `Dockerfile`: `mcr.microsoft.com/playwright:v1.62.1-noble` base + npm 12.0.1固定 + `npm ci` + `install-test-tools-linux.sh`（rsvg/mermaid/chrome）+ drawio（arch別deb）+ fonts-noto-cjk（日本語PDF描画用）+ `google-chrome`/`drawio`ラッパー（`--no-sandbox --disable-gpu --disable-dev-shm-usage`）
- `docker/test/entrypoint.sh`: Xvfb起動後、渡されたnpm scriptを直列実行
- `scripts/test-in-docker.sh` + `package.json` の `test:docker`: イメージビルド + コンテナ実行。リポジトリをbind-mount、node_modulesは匿名ボリューム（イメージのLinux依存）
- `.vscode-test.mjs` / `vscode_electron_test.ts`: chromeを`which google-chrome`で解決（コンテナのchromiumラッパー）
- `package.json` の `test:playwright:smoke`: コンテナ用smoke専用script

コンテナ検証済み:

- `check` / `test:webview` / `test:scripts`: pass
- Extension Host full suite: 560 passing
- Playwright packaged smoke（`package:vsix test:playwright:smoke`）: 4 passing

制約:

- buildはホストで実行（コンテナ内buildはviteのpdfjs asset copyがmacOS bind-mountでEACCES）
- Playwright full suite（configure specのPDF描画）はコンテナ外（ホスト/local/release）で検証。コンテナではsmokeのみ

## Non-goals

- CIの本格再構成（どのjobをどのトリガーで走らせるか）はPhase 1完了後に別途判断する
- release.ymlの変更
- branch protection rulesetの完全撤去（PR必須は維持）
- コンテナ内build / Playwright full suiteのコンテナ実行（ホストとreleaseで検証）

## Acceptance criteria

- PRを作成してもCIが自動実行されない
- PRがrequired status checkでブロックされずmergeできる
- Graphite廃止が実行されている（script / skill / 残骸ブランチの削除）
- local test（check / webview / scripts / Extension Host / Playwright smoke）が`npm run test:docker`で実行できる
