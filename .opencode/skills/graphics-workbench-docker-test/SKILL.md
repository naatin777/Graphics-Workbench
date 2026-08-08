---
name: graphics-workbench-docker-test
description: Graphics WorkbenchのローカルテストはDockerで実行する。check / webview / scripts / Extension Host / Playwright smokeの実行手順、buildはhost・testはDockerの分担、node_modules volumeの再利用、Xvfbの起動条件、Dockerfile / entrypoint変更時の確認事項を扱う。テスト実行前またはDocker関連ファイル（Dockerfile / docker/ / scripts/test-in-docker.sh / entrypoint.sh）の変更時に使用する。
---

# ローカルDockerテスト実行

PR時のCIは停止済み（workflow_dispatchのみ）。ローカルテストは基本的にDockerで実行する。リポジトリはnpmを使う（`pnpm`ではない）。

## 基本原則

- **buildはhost、testはDocker**。`npm run build`（および `out/` / `media/` の生成）はhostで実行する。コンテナ内buildはviteのpdfjs asset copyがmacOS bind mountでEACCESになるため行わない。
- `npm run test:docker -- <npm-script> [more...]` でテストを実行する。リポジトリはbind mountされ、hostでビルドした `out/` / `media/` をそのまま読む。
- hostのmacOS `node_modules` はコンテナへ混入しない。Docker用のLinux `node_modules` はnamed volumeに保持される。

## 実行手順

```bash
npm run test:docker -- check:all
npm run test:docker -- test:webview
npm run test:docker -- test
npm run test:docker -- package:vsix test:playwright:smoke
```

- Extension Host / Playwright（VS Code Electron）にはhost側で事前に `npm run build` が必要。
- Playwrightはコンテナではpackaged smokeのみ実行する。full suite（configure specのPDF描画）はhost / releaseで検証する。
- 複数scriptを渡せる（例: `package:vsix test:playwright:smoke`）。

## node_modules volume

- `package-lock.json` のSHA-256先頭16桁でkey付けされたnamed volume `graphics-workbench-node-modules-<hash>` を再利用する。
- **lockfile未変更 → 同一volume再利用、lockfile変更 → 別volume**（初回はimage内のLinux installをseed）。
- 古いvolumeは自動削除されない。不要になったら `docker volume ls` で確認して手動pruneする。
- キャッシュを無効化したい場合は該当volumeを削除する。

## git worktree

- `test-in-docker.sh` はworktree（`.git` がfile）を検出し、実gitdirとcommon dirをコンテナへmountする。これがないとknipがgit hooksを解決できず `check:all` がknipでexit 1になる。
- 通常リポジトリ（`.git` がdirectory）ではこのmountは発生しない。

## Xvfb

- GUIが必要なscript（`test` / `test:coverage` / `test:coverage:run` / `test:playwright:vsix` / `test:playwright:smoke` / `visual:capture`）が含まれる場合だけ、entrypointがXvfbを起動して`DISPLAY`を設定する。
- `check:all` / `test:webview` / `test:scripts` / `package:vsix` では起動しない。
- 複数scriptのうち1つでもGUIが必要なら、Xvfbは1回起動して全scriptで共有される。

## Docker関連ファイル変更時の確認事項

- `Dockerfile` は `COPY . .` を使わない。imageへは `package.json` / `package-lock.json` / `docker/test/entrypoint.sh` のみCOPYする。ソース変更で重いlayer（apt / Mermaid / Draw.io / npm ci）が再実行されない構造を維持する。
- layerは安定優先の順序（npm → apt → Mermaid → chrome wrapper → drawio → npm ci → entrypoint）を維持する。
- Mermaid CLI install時は `PUPPETEER_SKIP_DOWNLOAD=true` を維持する（コンテナはbase imageのChromiumを `google-chrome` wrapper経由で使う）。
- npm install系はBuildKit cache mount（`--mount=type=cache,target=/root/.npm`）を使う。
- apt installはまとめて1 RUNにする。xvfb / fonts-liberationはbase image（`mcr.microsoft.com/playwright:v1.62.1-noble`）に含まれるため重複installしない。fonts-noto-cjkは日本語描画のため維持する。
- `.github/scripts/install-test-tools-linux.sh` はGitHub Actions用であり、Docker buildでは使わない。
- 変更後は `npm run test:docker -- check:all` と `npm run test:docker -- package:vsix test:playwright:smoke` で実動作を確認する。

## 確認

- テストの選択は `graphics-workbench-verify`、VS Code / Extension Host / Playwrightのテスト方法は `graphics-workbench-vscode-testing` を参照する。
