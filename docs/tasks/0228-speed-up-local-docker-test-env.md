# 0228: ローカルDockerテスト環境の起動を高速化する

Status: Done

## Objective

`npm run test:docker -- <npm-script>` の2回目以降の起動を高速化する。特に、ソースコードの変更でDockerの重いlayer（apt / Mermaid / Draw.io / npm ci）が再構築されない構造にする。

## Background

- 旧Dockerfileは `COPY . .` でリポジトリ全体をimageへコピーし、その後にツールinstall（rsvg / mermaid / fonts / drawio）を実行していた。そのため `src/**/*.ts` を1行変更するだけで、install-test-tools（約43秒）とdrawio install（約36秒）を含む約1分50秒のlayer再構築が発生した。
- `scripts/test-in-docker.sh` は `/workspace/node_modules` をanonymous volumeでmountしており、`docker run --rm` のたびに新しいvolumeが作られ破棄されていた。
- `docker/test/entrypoint.sh` は渡されたnpm scriptの種類に関係なく常にXvfbを起動していた。
- Mermaid CLI install時にPuppeteerがChromeをdownloadしない設定がなかった。

## Changes

### Dockerfile

- `COPY . .` を削除し、imageへは `package.json` / `package-lock.json` / `docker/test/entrypoint.sh` だけをCOPYする。リポジトリ全体は実行時のbind mountで供給される。
- layer順序を安定優先に変更: npm 12 → apt（librsvg2-bin / fonts-dejavu-core / fonts-noto-cjk）→ Mermaid CLI → google-chrome wrapper → drawio → npm ci → entrypoint。ソース変更ではどのlayerもinvalidateされない。
- `PUPPETEER_SKIP_DOWNLOAD=true` を設定し、Mermaid CLI / PuppeteerがChromeを追加downloadしないようにした。Docker内ではPlaywright base imageのChromiumを `google-chrome` wrapper経由で利用する。
- `npm ci` とグローバルnpm installにBuildKitの `--mount=type=cache,target=/root/.npm` を適用し、npm download cacheを再利用する。
- apt installを1つのRUNにまとめた。xvfb / fonts-liberationはbase image（`mcr.microsoft.com/playwright:v1.62.1-noble`）に含まれることを実機確認し、重複installを削除。fonts-noto-cjk（日本語描画）は維持。
- `.github/scripts/install-test-tools-linux.sh` はGitHub Actions用のまま維持し、Docker buildでは使わない（settings.jsonへの書き込みを伴うため）。

### scripts/test-in-docker.sh

- anonymous volumeをやめ、`package-lock.json` のSHA-256先頭16文字でkey付けしたnamed volume `graphics-workbench-node-modules-<hash>` を `/workspace/node_modules` へmountする。
- volume名の算出は `scripts/docker-node-modules-volume-name.sh` に切り出し、`docker-node-modules-volume-name.test.mjs` で同一lockfile→同一volume名・異なるlockfile→異なるvolume名を検証。
- host macOSの `node_modules` がコンテナへ漏れない保証（volumeがhostのnode_modulesを上書き）は維持。

### docker/test/entrypoint.sh

- `requires_display()` ヘルパーを追加し、XvfbはGUIが必要なscript（`test` / `test:coverage` / `test:coverage:run` / `test:playwright:vsix` / `test:playwright:smoke` / `visual:capture`）が1つでも含まれる場合だけ起動する。GUI不要ならXvfb起動・pollingを完全にスキップする。
- 複数scriptが渡された場合、Xvfbは1回起動しcontainer内で共有する。

## Verification

- `npm run check` pass
- `npm run test:scripts` pass（volume名hash test 3件含む）
- `npm run build` pass
- `npm run test:docker -- check:all` pass（連続2回: 重いlayerがcache hit、node_modules volume再利用、Xvfb未起動）
- `npm run test:docker -- test:webview` pass（全webview app、exit 0）
- `npm run test:docker -- test` pass（577 passing）
- `npm run test:docker -- package:vsix test:playwright:smoke` pass（4 passing、CIと同じretriesで安定）
- Mermaid conversion（puppeteer config + google-chrome wrapper）がDocker内で動作することを確認

計測（変更前 → 変更後）:

- Case A（src変更＋check:all）: 約1分48秒 → 約11秒（buildは全layer cache hit、重いlayer再実行なし）
- Case B（無変更で即再実行）: 約11秒 → 約8秒
- Case C（package:vsix＋smoke）: warmで約50秒 → 約27〜31秒

注意: git worktree内では `.git` がhost外のgitdirを指すためknipがlefthookを「unused」と判定し `check:all` がknipでexit 1になる（変更前から存在するworktree特有の既知挙動。通常のリポジトリでは発生しない）。

## Non-goals

- コンテナ内build（macOS bind mount EACCES）は今回解決しない。buildはhost、testはDockerの基本方針を維持。
- Playwright smokeのElectron session共有は実施しない（各testのlaunch/disposeを共有するとfailure diagnosisとtest isolationが悪化するため）。
- lefthookのpre-pushは2回のDocker起動のまま（persistent cacheにより十分高速）。
- 古いnode_modules volumeの自動削除は今回必須にしない。

## Acceptance criteria

- ソース変更でapt / Mermaid / Draw.io install layerが再実行されない
- 同一lockfileならnode_modules volume再利用、異なるlockfileなら別volume
- host macOS node_modulesがコンテナへ混ざらない
- check:all実行時はXvfb未起動、Extension Host / Playwright実行時はXvfb利用
- Mermaid CLIがDocker内の既存Chromiumで動作し、Puppeteerの不要downloadを防ぐ
- Draw.io / Sharp / MuPDF / Crop Configure packaged smokeが通る
- 既存のテスト責務を削らない
- Dockerfile / shell scriptsが不必要に複雑にならない
