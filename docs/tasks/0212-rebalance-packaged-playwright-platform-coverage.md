# 0212: package済みPlaywrightのOS別責務を再配分する

Status: Implementation complete; Docker linux/amd64 evidence pending — maintainer direction recorded 2026-08-02

## Implementation evidence (2026-08-02)

- `npx playwright test --list --project=vscode-electron --project=vscode-electron-narrow`: 33 tests in 4 files（wide 18 / narrow 15）。Smoke file単独は3 tests。
- `CI=true npx playwright test --project=vscode-electron electron/packaged_conversion_smoke.spec.ts`: 3 passed in 15.5s（MediaBox / CropBox oracle追加後の再実行）。
- `CI=true npx playwright test --project=vscode-electron electron/crop_pdf_configure.spec.ts`: 7 passed in 27.8s。
- `CI=true npx playwright test --project=vscode-electron-narrow`: 15 passed in 1.3m（macOS local; macOSではsnapshot比較を無効化）。
- `CI=true npx playwright test --project=vscode-electron electron/merge_pdf_configure.spec.ts electron/split_pdf_configure.spec.ts`: 8 passed in 48.8s（macOS local）。
- `npm run check`, `npm run typecheck:test`, `npm run build`, `npm run package:vsix`, `npm run test:webview`, `.github/scripts/*.test.mjs`, changed TypeScript `oxlint`, YAML parse, and `git diff --check`: passed。
- The packaged Electron tests passed locally on macOS after granting GUI process execution. Linux, Windows, and GitHub Actions release-package execution remain unverified here.
- GitHub Actions run [30733186958](https://github.com/naatin777/Graphics-Workbench/actions/runs/30733186958) passed the Linux, macOS, and Windows packaged Playwright jobs, snapshot commit, and PR screenshot comment for the preceding clean implementation commit. The current uncommitted workflow/Docker changes still require a fresh run.
- Clean PR head `d0466bd` in [PR #93](https://github.com/naatin777/Graphics-Workbench/pull/93) passed the refreshed packaged Playwright workflow [30780708280](https://github.com/naatin777/Graphics-Workbench/actions/runs/30780708280) and Extension Host coverage workflow [30780708248](https://github.com/naatin777/Graphics-Workbench/actions/runs/30780708248) on Linux, macOS, and Windows before merge.
- The normal packaged Playwright run recorded Linux 7m22s, macOS 3m26s, and Windows 5m28s for the platform jobs; the workflow elapsed 7m47s. This confirms the intended PR case-count reduction on macOS / Windows while preserving the Linux full suite.
- ARM64 Docker verification: `docker build --platform linux/arm64` passed, conversion-tool verification passed, and `docker run --shm-size=2g ...:arm64` completed all 33 Linux wide+narrow cases in 3.4 minutes with no retry. The local Docker CLI has no `buildx` plugin, so the amd64 build/runtime remains unverified on this ARM host even though the official base image and Dockerfile are multi-architecture.
- Docker entrypoint starts Xvfb explicitly and waits for its display socket; the standard run uses `--shm-size=2g`. Each packaged spec's prepare hook allows 180 seconds so a first-run VS Code download does not become a false flaky result.
- A local process-count check was unavailable because the macOS `sysmond` service is not present in this environment; the existing Electron disposal/process-tree cleanup code was not changed.

### Snapshot baseline audit

The repository contains 18 `*-vscode-electron-linux.png` wide baselines and 18 `*-vscode-electron-narrow-linux.png` narrow baselines. The snapshot helper compares both Linux projects when `PLAYWRIGHT_VISUAL_SNAPSHOTS=true`; macOS/Windows PR and all release runs still attach screenshots but disable pixel comparison.

The Linux wide and narrow images from successful Actions run [30733186958](https://github.com/naatin777/Graphics-Workbench/actions/runs/30733186958) were reviewed visually. The previous Split wide images showed an empty preview and disabled Apply state; the artifact images show the selected page, `Pages: 1`, and the enabled Apply action. All 18 wide and 18 narrow Linux baselines were copied from the reviewed artifact; macOS and Windows images were not copied into the Linux baseline.

### Docker visual runner boundary

GitHub Actions remains native: the PR Linux job owns wide+narrow pixel comparison, while PR macOS / Windows run the wide packaged conversion smoke. Release package runs the full wide+narrow suite on all three OSes and uploads screenshots for manual review. Docker is not nested inside those Actions jobs. It is the reproducible local runner for the Linux full suite and snapshot regeneration, with the same pinned Playwright/npm versions, repository lockfile, and verified conversion-tool setup, without introducing a second CI execution path.

The image is `docker/playwright-visual/Dockerfile`, based on the pinned official Playwright image and the repository lockfile. The image supports both `linux/amd64` and `linux/arm64`; build and copy-back commands are documented in [`docker/playwright-visual/README.md`](../../docker/playwright-visual/README.md). It packages the current source into a VSIX before launching Electron and runs all 33 Linux wide+narrow cases; only Linux snapshot baselines are compared or regenerated.

## Objective

package済みVSIXを対象とするElectron Playwrightを、必要なoracleに沿ってOS別に再配分する。

- PR LinuxをWebview UI / responsive layout回帰の正本にする。wide+narrowのpixel snapshotとsemantic assertionを実行する
- PR macOS / Windowsでは、そのOSで生成したVSIXを実VS Codeへinstallし、wide packaged conversion smokeを実行する。pixel比較は行わない
- release前はmacOS / Windowsを含む3 OSで全theme・全snapshot・全幅・全UI操作を実行し、artifact画像を目視確認する
- releaseでは、検証を通したOS別VSIXそのものを再生成せずpublishする既存境界を維持する
- 3 OSのpackage / install / activation / Host bridge / native dependency / external process境界を弱めず、通常PRの待ち時間を短縮する

このtaskの目的は「Playwrightを3 OSから外す」ことではない。3 OSで守るべき配布物contractを、全UI重複から実変換smokeへ絞り直すことである。

## Maintainer direction

2026-08-02の相談で、次の方向性をmaintainerと確認した。

- PRのWindows / macOSではPlaywrightを実行し、WebviewとExtension Host/Nodeのbridge・変換を確認する
- PRのpixel visual comparisonはLinuxに限定する
- release前はWindows / macOSを含む3 OSで全Playwrightを実行し、画像を目視確認する
- Windows / macOSでpackageしたVSIXから、特に実際の変換が正しく成功することを確認する
- ローカルの全PlaywrightはDocker Linuxで再現できるようにする

採用方向は「PR: Linux full visual + macOS / Windows packaged conversion smoke、release: 3 OS full screenshot review、local: multi-arch Docker Linux full」である。具体的なcase分割とworkflow実装はこのtaskで完了させる。

## Why this is a new task

[0211](0211-stabilize-packaged-playwright-e2e.md)は、同じ17ケースをwide / narrowの2 projectで安定して実行し、幅別UI回帰を成立させるtaskだった。本taskはその成果を否定しない。

本taskでは、成立した34ケースをどのOSと幅へ割り当てるかを変更し、さらに従来対象外だったpackage後の外部CLI成功変換を3 OSのsmokeへ追加する。守るEvidenceとCI責務が変わるため、0211とは独立した目的として扱う。

## Required reading before implementation

- [PROJECT_STATE](../../PROJECT_STATE.md)
- [test policy](../specs/internal/test-policy.md)
- [packaging仕様](../specs/internal/packaging.md)
- [ADR-0015: npmからOS別VSIXを生成する](../adr/0015-build-platform-specific-vsix-from-runtime-staging.md)
- [ADR-0017: 配布済みVSIXをElectron E2Eとreleaseの検証単位にする](../adr/0017-use-installed-vsix-for-electron-e2e.md)
- [Task 0180: package済みVSIXのoffline 3 OS smoke](0180-add-packaged-vsix-offline-smoke-tests.md)
- [Task 0207: package済みPlaywrightの高速化](0207-speed-up-packaged-playwright-tests.md)
- [Task 0211: Electron E2Eの安定性・幅別UI検証](0211-stabilize-packaged-playwright-e2e.md)

## Current installed-VSIX boundary

この境界は変更しない。

1. 各GitHub Actions runnerで`npm ci`とbuildを実行する
2. `scripts/package-vsix.mjs`がcurrent runnerと一致するtargetだけをpackageする
3. 生成した`graphics-workbench-<OS>.vsix`を`graphics-workbench.vsix`としてE2Eへ渡す
4. VS Code CLIで隔離したextensions directoryへVSIXを実installする
5. source directoryをExtension Development Hostとして起動しない
6. 実VS Code windowとinstall済みextensionだけをPlaywrightで操作する
7. releaseではE2E済みVSIX artifactをpublish jobへ渡し、publish jobでbuild / packageし直さない

正本:

- `.github/workflows/playwright.yml`
- `.github/workflows/release.yml`
- `scripts/package-vsix.mjs`
- `test/playwright/electron/helpers/packaged_vsix.ts`
- `test/playwright/electron/helpers/electron_test_env.ts`

## Baseline observed on 2026-08-02

### Case count

次のcommandで3 spec、34 cases（17 unique cases × 2 widths）を確認した。

```sh
npx playwright test --list --project=vscode-electron --project=vscode-electron-narrow
```

projects:

- `vscode-electron`: native content width 1280px
- `vscode-electron-narrow`: native content width 600px

両projectが同じ3 spec / 17 casesを列挙するため、幅に依存しないactivation、native Sharp、network、外部CLI欠損、package module確認も2回ずつ実行される。

### Setup multiplicity

各specの`beforeAll`が`prepareElectronTest()`を呼び、VSIXをspec単位でinstallする。現在は3 spec × 2 projectsなので、各OSで最大6回package済みVSIXの展開・install準備が発生する。

各testは`setupElectronTest()`で個別のuser-data / shared-data / Electron processを起動する。workspaceは既存方針どおり各testの前後にresetされる。0211で確立したprocess tree cleanup、1 worker、固定sleep禁止は維持する。

### GitHub Actions timing evidence

通常実行の参考値:

- [run 30697590493](https://github.com/naatin777/Graphics-Workbench/actions/runs/30697590493)
- Linux: Playwright step 2分22秒、job全体 4分11秒
- macOS: Playwright step 5分10秒、job全体 7分29秒
- Windows: Playwright step 5分59秒、job全体 9分01秒

このrunは最新34 cases追加前の通常実行なので、現在の全件時間そのものとしては扱わない。速度差とpackage / setupの下限を知る参考値である。

34 casesとsnapshot再生成を含む参考値:

- [run 30733186958](https://github.com/naatin777/Graphics-Workbench/actions/runs/30733186958)
- Linux: Playwright step 5分59秒、job全体 7分47秒
- macOS: Playwright step 7分42秒、job全体 9分58秒
- Windows: Playwright step 13分19秒、job全体 16分47秒

snapshot再生成は通常実行より重いため、通常PR時間の推定には使わない。ただし、OS別snapshotを3 OSで維持するcostがWindowsで大きいEvidenceとして扱う。

実装後は同種の通常runとsnapshot更新runを分けて計測し、「commandを実行した」と「testがpassした」を分離して記録する。

## Current Evidence audit

### Strong packaged user-journey Evidence

#### Crop Configure → Apply

`test/playwright/electron/crop_pdf_configure.spec.ts`の
`Crop Configure Webviewを開きPDFを表示しApplyして正しいPDFを出力できる`は、次を実際に通る。

- package済みVSIXのinstall
- extension activation
- Explorer context menuとcommand contribution
- Crop WebviewとPDF.js asset
- Webview → Extension Host message bridge
- Extension Host上の`pdf-lib`処理
- staging / commit
- 出力PDFのpage count、MediaBox、CropBox

これは3 OSに残すべきcontractを持つ。PRではLinux wide+narrow full journeyと、macOS / Windows wide packaged smokeで確認する。release前とlocal Dockerでは15ページPDFを含む全wide+narrow suiteを実行する。

#### PNG → JPEG

`native Sharp dependencyをloadしてPNG→JPEG変換できる`は、Explorer context menuから実commandを実行し、Extension Hostでpackage済みSharp native dependencyをloadする。

これはOS別VSIXの最重要Evidenceである。現在のoracleは出力fileが非空であることまでなので、package smokeでは次へ強化する。

- Sharp等で出力を再読込できる
- metadata formatがJPEGである
- width / heightが期待値と一致する
- 可能なら入力にspace / Unicodeを含むpathを使う

検証側がrepository rootのSharpを使って出力を読むことと、変換側がinstall済みVSIX内のSharpを使うことを混同しない。変換command自体は必ず実Extension Hostで実行する。

### Medium Evidence that must not be called a Host journey

`package済みmoduleでMergeとSplitが動く`は、Electronを起動した後、`loadPackagedOperation()`でinstall先の`out/operations/pdf/merge_pdf.js`と`split_pdf.js`をPlaywright test runnerのNode processへ直接importする。

確認できること:

- moduleがVSIXに含まれる
- package先からdependency解決できる
- module単体でPDFを生成できる

確認できないこと:

- Extension Hostでmoduleをloadできる
- command登録が正しい
- Webview / commandからoperationへ到達できる
- notification / progress / configurationが動く

このcaseをWindows / macOSの代表的な「package後のユーザー変換成功」と数えない。Linux wideまたはpre-package Extension Host testへownerを寄せるか、必要なら実command journeyへ置き換える。

### External CLI Evidence

通常の`.github/workflows/playwright.yml`は各OSへ次をinstall / configureする。

- Ghostscript
- pdftocairo
- rsvg-convert
- qpdf
- Chrome executable path

`verify-image-tools-*`はtool pathとversionを確認し、rsvg-convert → PDF、pdftocairo → PNGの小さいtool単体smokeを実行する。

しかしpackage済みVSIXの現行E2Eでは、外部CLIについて確認しているのは主に次である。

- 存在しないpdftocairo pathを設定する
- PDF → JPEG commandを開始する
- error notificationが表示される
- 出力fileが残らない

したがって、次は未確認である。

- package済みextensionが設定済みpdftocairo pathを読む
- Extension Hostが各OSの実行fileをspawnする
- Windowsの`.exe` pathとASCII scratchを通る
- 外部CLI出力をSharpで目的形式へencodeする
- stagingした結果を最終outputへcommitする
- 成功notificationを表示する

### Why this gap exists

Task 0180は、外部networkなしでactivation、PDF.js、`pdf-lib`処理が動き、外部CLI欠損を誤って成功扱いしないことを目的にしていた。外部CLIのinstall方式と成功変換は明示的に対象外だった。

今回のmaintainer要求は、この意図的な旧スコープを拡張し、Windows / macOSでpackage後の代表的な成功変換を直接確認することである。

### Release gap

`.github/workflows/release.yml`のExtension Host jobは外部toolをinstallするが、OS別VSIXを作る`package` jobは別runnerであり、現状は外部toolをinstallしない。

release package jobで現在確認できるもの:

- current runner向けVSIX package
- install / activation
- PDF.js / Webview
- `pdf-lib`処理
- package済みSharp
- 外部CLI欠損error boundary

release package jobで現在確認できないもの:

- package済みVSIXからの外部CLI成功変換

新しいPDF → JPEG成功smokeをreleaseでも実行する場合、releaseのpackage jobにも必要なexternal tool install / settings作成が必要である。別jobでinstallしたtoolやsettingsはrunnerをまたいで引き継がれない。

## Target Evidence allocation

| Contract / oracle                           | Linux PR                              | macOS PR                        | Windows PR                      | Release                            |
| ------------------------------------------- | ------------------------------------- | ------------------------------- | ------------------------------- | ---------------------------------- |
| runner-matched VSIX package                 | Required                              | Required                        | Required                        | Required on each artifact          |
| VSIX install / activation                   | Required                              | Required                        | Required                        | Required                           |
| Webview → Extension Host bridge             | Full + smoke                          | Smoke                           | Smoke                           | Smoke                              |
| `pdf-lib` output                            | Full + smoke                          | Smoke                           | Smoke                           | Smoke                              |
| packaged Sharp native load                  | Smoke                                 | Smoke                           | Smoke                           | Smoke                              |
| successful external CLI conversion          | Smoke                                 | Smoke                           | Smoke                           | Smoke                              |
| wide / narrow responsive layout             | Full                                  | PR: Not required; release: Full | PR: Not required; release: Full | Full on all 3 OS                   |
| theme / high contrast                       | Full                                  | PR: Not required; release: Full | PR: Not required; release: Full | Full on all 3 OS                   |
| pixel snapshot                              | Linux wide+narrow canonical           | Not required                    | Not required                    | Not compared; screenshots reviewed |
| zoom / focus / detailed Webview interaction | Full                                  | PR: Not required; release: Full | PR: Not required; release: Full | Full on all 3 OS                   |
| external network block                      | Required once                         | Not required                    | Not required                    | Linux or one shared smoke          |
| missing external CLI failure                | Required once or Extension Host owner | Not required                    | Not required                    | Not required on every artifact     |

macOS / WindowsのPR smokeでも、Webviewが作成され、Host bridge、主要control、変換outputが成立し、error UIへ落ちないことを確認する。OS別pixel snapshotは持たない。Linux PR wide/narrowはpixel比較とsemantic responsive assertionを行う。release前は3 OSの全suite screenshotをartifactへ添付し、目視で壊れていないか確認する。

## Required three-OS packaged conversion smoke

smokeはwide 1 project、1 specにまとめることを第一候補とする。caseごとのElectron process分離は維持し、VSIX installはspec開始時の1回に共有する。

### 1. Small Crop Configure → Apply

目的:

- activationを独立caseなしでも証明する
- package内Webview assetとPDF.jsを読む
- Webview → Extension Host bridgeを通る
- `pdf-lib`で実際に変換する
- staging / commitを通る

fixture / oracle:

- 15ページfixtureではなく小さい複数ページPDFを使う
- Webview heading、canvas作成、Apply buttonを確認する
- crop値を変更してApplyする
- output PDFを開き、page count、MediaBox、CropBoxを確認する
- full Linux testが担う全ページscroll、全theme、snapshotを重複させない

### 2. PNG → JPEG

目的:

- OS別VSIXに正しいSharp native packageが含まれる
- Explorer menu → command → Extension Host → staging / commitが動く

fixture / oracle:

- spaceまたはUnicodeを含む入力pathを優先する
- success notificationを確認する
- outputが存在するだけでなく、JPEGとしてdecodeできることを確認する
- format、width、heightを確認する

### 3. PDF → JPEG successful external conversion

目的:

- package済みextensionが外部tool設定を読む
- Extension Hostから実pdftocairoを起動する
- pdftocairoのPNG intermediateをpackage済みSharpでJPEGへencodeする
- staging / commit / notificationを通る
- Windows固有の実行pathとASCII scratchを実際に通す

fixture / oracle:

- inputは`資料 sample.pdf`のようにspace / Unicodeを含める
- WindowsでASCII scratch fallbackが必要になるpathを使う
- output枚数がPDF page countと一致する
- 各outputをJPEGとしてdecodeできる
- format、width、heightが妥当である
- 詳細pixel差分はpre-package Extension Hostのfixture oracleへ任せ、package smokeではOS renderer差で不安定にならないcontent oracleを使う

このcaseはpdftocairoとSharpを同時に通る。ただし失敗原因を切り分けるため、直接PNG → JPEGのSharp caseも残す。

## Existing 17 cases: proposed ownership

実装開始時にtitleとcase countを再取得し、変更されていた場合はこの表を同期する。

| Existing case                                                         | Proposed owner                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| インストール済みVSIXからextensionをactivateできる                     | 3 OS smoke journeyへfold。独立caseを残す場合はwideのみ               |
| Crop Configure Webviewを開きPDFを表示しApplyして正しいPDFを出力できる | Linux full。軽量版を3 OS smokeへ追加                                 |
| PDFプレビューのズーム操作が表示倍率とスクロールを維持する             | Linux UI                                                             |
| Crop dark/light themeへ追従しcanvasが読める                           | Linux wide+narrow pixel                                              |
| Crop high contrastと極端な配色でもcanvasが読める                      | Linux wide+narrow pixel                                              |
| package済みmoduleでMergeとSplitが動く                                 | Linux wideまたはExtension Host owner。3 OS Host journeyとは数えない  |
| native Sharp dependencyをloadしてPNG→JPEG変換できる                   | 3 OS packaged smoke、wideのみ、oracle強化                            |
| 外部networkが遮断されている                                           | Linux wide 1回                                                       |
| pdftocairo欠損時に期待するfailureになる                               | Linux wide 1回またはExtension Host owner                             |
| Merge dark/light themeへ追従しcanvasが読める                          | Linux wide+narrow pixel                                              |
| Merge high contrastと極端な配色でもcanvasが読める                     | Linux wide+narrow pixel                                              |
| Split dark/light themeへ追従しcanvasが読める                          | Linux wide+narrow pixel                                              |
| Split high contrastと極端な配色でもcanvasが読める                     | Linux wide+narrow pixel                                              |
| Split PDFプレビューのズーム入力とCtrlまたはCommandホイールが動作する  | Linux UI。macOS Meta coverageはPR smokeの既知gap、release fullで確認 |
| Split分割ペインが幅に応じて配置され長幅でドラッグ調整できる           | Linux wide+narrow pixel + semantic responsive                        |
| Splitグループ入力中にフォーカスを維持する                             | Linux UI。幅ごとの必要性を再確認                                     |
| 入力したグループ設定でSplit PDFを実行できる                           | Linux full。Crop smokeが3 OS bridge / pdf-lib代表を担う              |

## Decision record

### macOS Meta-wheel coverage

現行Split zoom caseはmacOSで`Meta`、他OSで`Control`を使う。PRではmacOS / Windowsをwide packaged conversion smokeに限定するため、macOS Meta-wheelの実Electron確認はrequired scopeから外し、既知gapとして記録する。release前の3 OS full suiteでMeta-wheelを含む全UI操作を実行し、各OSのscreenshot artifactを目視確認する。Linux PRではControl pathとwide+narrowのpixel / semantic assertionをcanonical ownerとする。

### Full 3 OS release run

release前のpackage jobでは、Linux / macOS / Windowsすべてでwide+narrow full suiteを実行する。pixel比較は無効にし、各OSのscreenshot artifactをmaintainerが目視確認する。PRのmacOS / Windowsはwide smokeだけに留め、同じ全suiteを毎回重複しない。

### External tool install scope in release

PDF → JPEG smokeに必要なのはpdftocairoである。既存install scriptはGhostscript、rsvg-convert、qpdf、Chromeも設定する。

既存scriptをrelease package jobでも再利用し、PRとreleaseのsettings差を作らない実装にする。setup時間の最適化は、まず各OSの実測後に別taskとして判断する。新しい汎用installer frameworkは追加しない。

## Workflow changes expected

### `.github/workflows/playwright.yml`

- Linux: full UI / responsive suite（wide+narrow pixel comparison）を実行する。wide packaged conversion smokeもこのfull suiteに含む
- macOS / Windows: wideのpackaged conversion smokeを実行する
- changed-fileによるCI scope classifierは廃止し、PR / main pushでは定義済みのTest・Playwright jobを常時実行する。変更漏れによる誤skipを避け、workflowを単純化する
- macOS / Windowsからsnapshot updateを外す
- screenshot artifact / PR commentはLinux snapshotを正本として扱う
- failure時のPlaywright report、trace、actual image、diagnostic、Extension Host log uploadは維持する

### `.github/workflows/release.yml`

- package jobの各runnerへ、successful external conversion smokeに必要なtoolとsettingsを準備する
- Linux / macOS / Windows artifact: wide+narrowのfull Playwrightを実行し、screenshot artifactを目視確認用に保存する
- smoke成功後に同じVSIX fileをartifact uploadする
- publish jobでbuild / packageし直さない

### Snapshot regeneration

- Linux wide+narrow snapshotだけをcanonicalにする
- PR title / commit markerによる更新対象をLinuxへ絞る
- macOS / Windows既存snapshotはPR/releaseのpixel gateから外し、削除する場合は別途対象を明示してreviewする
- Linux wide+narrowでpixel snapshot比較を行い、両方がcanonical baselineを持つ
- snapshot更新runと通常runのtimingを混同しない
- GitHub Actionsの通常PRはnative Linux runnerで比較する。DockerはActionsへ組み込まず、ローカルまたは明示的な再生成時だけ使う
- releaseはpixel比較をgateにせず、3 OSのtest-result screenshotをartifactとして保存する

## Test organization expected

第一候補:

- `test/playwright/electron/packaged_conversion_smoke.spec.ts`を追加する
- 3 OS smoke対象を1 specへ集め、VSIX installをspec単位で1回共有する
- packaged conversion smoke specはnarrow projectから除外し、wide projectだけがこのspecを実行する
- Linux PRのUI specはwide / narrow両方でsnapshotとsemantic assertionを実行する
- release/local Dockerはwide+narrowの全suiteを実行する

選択方法は、既存構成へ最小変更で入るものを使う。

- dedicated spec + project `testMatch` / `testIgnore`
- または明示的なPlaywright tag（例: `@packaged-smoke`）と`--grep`

file nameやtag自体をcontractにしない。重要なのは、どのoracleをどのOSで守るかである。

避けること:

- `process.platform`による大量のtest.skipをspec内へ散らす
- fixed timeout / `page.waitForTimeout`で速度やflakinessを隠す
- source extension fallback
- workspace / user-data共有によるcase間汚染
- 速度のために1 worker方針を外す
- package moduleの直接importをHost journeyと表現する
- file存在だけで「正しく変換できた」と判定する

## Expected scale after reallocation

実装前は17 cases × 2 project = 34 casesだった。実装後のlist結果は次のとおりである。

- Linux wide: 18 cases（既存Linux UI 15 + 3 packaged conversion smoke）
- Linux narrow: 15 cases（packaged conversion smokeはwide専用）
- Linux合計: 33 cases
- macOS / Windows PR: 各3 cases（wide packaged conversion smoke）
- macOS / Windows release: 各33 cases（wide+narrow full suite、pixel比較なし）

したがって、PRのOSごとのPlaywright実行数はLinux 33、macOS 3、Windows 3となる。releaseとlocal Dockerは各33 casesを実行する。Linuxではactivation単独とPNG成功の重複をsmoke specへ移した。

速度目標は固定分数ではなく、次で評価する。

- PR macOS / WindowsのPlaywright case countが意図したsmoke数になる
- release macOS / Windowsも全33 casesを実行する
- spec / projectごとのVSIX install回数が減る
- 通常runのPlaywright stepとjob全体を実測する
- Windowsのpackage / setup時間は残るため、test case削減とjob全体削減を分けて報告する
- 変更前後でflaky retry、timeout、orphan processが増えない

## Completion conditions

- [x] Linuxがwide / narrow Webview UI・responsive回帰のcanonical ownerになっている（wide+narrow pixel比較）
- [x] macOS / Windowsの通常PRはwide packaged conversion smokeを実行し、releaseは全33 casesを実行する
- [x] 各OSでcurrent runner向けに生成したVSIXだけをinstallしている
- [x] source extension fallbackが存在しない
- [x] small Crop Apply smokeが3 OSで実Extension Host bridgeと正しいPDF outputを確認する実装になっている
- [x] PNG → JPEG smokeが3 OSでpackage済みSharpを使い、decode / format / dimensionsを確認する実装になっている
- [x] PDF → JPEG成功smokeが3 OSで実pdftocairo、Sharp、staging、commit、notificationを確認する実装になっている
- [x] Windows smokeがspace / Unicode pathとASCII scratchを通るfixture / operation pathを使う
- [x] release package jobでもsuccessful external conversion smokeを実行するtool setupがある
- [x] release publishはE2E済みVSIX artifactを再生成せず公開する既存境界を維持している
- [x] direct-import Merge / Split testをHost journeyとして数えていない
- [x] macOS Meta-wheel coverageをPR smokeではgapとして記録し、release full suiteで確認する
- [x] macOS / Windows pixel snapshotをrequired canonical Evidenceから外している
- [x] Linux snapshot更新とPR screenshot commentの対象をLinuxへ絞っている
- [x] PR Linux wide+narrow pixel比較、release 3 OS screenshot artifact、Docker local full runnerの責務を分離している
- [x] `docker/playwright-visual/Dockerfile`とmulti-arch build / snapshot copy-back手順を追加している
- [x] Docker daemon上で`linux/arm64`のvisual runnerを実行し、同一手順で33 casesがpassしている
- [ ] Docker daemon上で`linux/amd64`のvisual runnerをbuild / 実行している（このARM hostのDocker CLIに`buildx` pluginがなく、legacy builderがplatform mismatchで停止）
- [x] 1 worker、per-test workspace / user-data / process isolation、process tree cleanupを維持している
- [x] fixed Playwright sleepを追加していない
- [x] 実装後のproject / spec / case countを記録している
- [x] macOS / Windowsの変更前後timingを通常runで記録している（[30780708280](https://github.com/naatin777/Graphics-Workbench/actions/runs/30780708280)）
- [x] test policy、packaging仕様、CI Evidence map、test matrix、task記録のcase countと責務を同期した
- [x] GitHub ActionsのLinux / macOS / Windows package smokeがcleanなPR headでpassしている（[PR #93](https://github.com/naatin777/Graphics-Workbench/pull/93)、head `d0466bd`）

## Verification plan

### Before editing

```sh
git status --short
npx playwright test --list --project=vscode-electron --project=vscode-electron-narrow
```

- current branch / base / unrelated changesを確認する
- current case titleとcountをこのtaskのbaselineと照合する
- localに残るVS Code / Electron processは、このrepository由来だけを数える

### Static and build verification

変更fileに応じて少なくとも次を実行する。

```sh
npx oxlint <changed-files>
npm run typecheck:test
npx oxfmt --config ./oxfmt.config.ts --check <changed-files>
npm run build
npm run package:vsix
npm run test:webview
node --test .github/scripts/*.test.mjs
git diff --check
```

workflow classifierやsnapshot helperを変更した場合、対応するscript testを追加・更新する。

### Local Playwright verification

1. packaged conversion smokeだけを実行する
2. Linux相当のwide UIを実行する
3. narrow UIを実行する
4. full Linux allocationをlistし、意図したcaseだけが含まれることを確認する
5. smokeをlistし、macOS / Windowsで3 casesまたは最終決定数だけになることを確認する
6. snapshot更新と通常comparisonを別commandで実行する
7. test前後でrepository由来VS Code process数が増えないことを確認する

macOS localしか利用できない場合、Windows成功を推測で完了扱いしない。GitHub ActionsをWindows Evidenceの正本にする。

### GitHub Actions verification

- Linux full UIがpassする
- Linux PR wide+narrow snapshot artifact / commentが期待どおりになる
- release packageのLinux / macOS / Windows screenshot artifactでpixel比較なしの画像を目視確認できる
- Docker visual runnerが`linux/amd64`と`linux/arm64`で全33 casesを同じ手順で実行できる
- macOS package smokeがpassする
- Windows package smokeがpassする
- PDF → JPEG成功caseが各OSの実tool pathを使っている
- release workflow相当のpackage jobで同じsmokeがpassする
- failure artifactが各OSで取得できる
- 通常runのstep durationとjob durationを記録する
- snapshot regeneration runを通常runの速度Evidenceとして使わない

実際のrelease tag作成・公開は、maintainerが明示的に依頼しない限りこのtaskの検証で実行しない。

## Documentation updates required

- `docs/specs/internal/test-policy.md`
  - PRはLinux wide+narrow pixel + 3 OS packaged conversion smoke、releaseは3 OS full screenshot reviewへ責務を明文化する
- `docs/specs/internal/packaging.md`
  - 現行のexternal CLI failureだけでなく、representative successful external conversionをpackaged smoke contractへ追加する
- `docs/foundation/ci-evidence-map.md`
  - PR / releaseのOS別Evidenceとcommandを同期する
- `docs/test-matrix.md`
  - package済み成功変換、platform coverage、既知gapを同期する
- `docs/foundation/test-file-inventory.md`
  - spec / case countを同期する
- `test/playwright/electron/helpers/electron_snapshot.ts`
  - Linux wide+narrowをpixel baseline比較のownerとし、macOS/Windowsとreleaseでは比較を無効化する
- `docs/tasks/README.md`
  - task statusを同期する
- `PROJECT_STATE.md`
  - 完了後にCurrent priority / In progress / Important Decisionsを必要な範囲で同期する
- `~/.codex/skills/graphics-workbench-e2e-stability/SKILL.md`
  - 現在の`30 cases`記載は実測34 casesとずれている
  - 実装後のLinux full / 3 OS smoke allocationへ更新する

repository外のpersonal Codex skill更新がworkspace権限外の場合、黙って未更新にせず最終報告へ残す。

## Known stale records at audit time

2026-08-02のaudit時点で、少なくとも次が実測とずれている。

- `docs/test-matrix.md`: Playwright Electronを13 cases × 2 widths = 26と記載
- personal `graphics-workbench-e2e-stability` skill: verification欄に`currently 30 cases`と記載
- `npx playwright test --list`: 17 cases × 2 widths = 34

実装開始時に最新branchへ追従した上で再確認し、古い数を機械的に34へ置換するのではなく、再配分後の正しいproject / case countへ更新する。

## Non-goals

- Playwright、Mocha、Vitestのrunner移行
- Browser Playwrightの復活
- 3 OS Extension Host suiteの削減
- 全変換formatをpackage E2Eで重複実行すること
- Draw.io本体のCI installを新たに成立させること
- production conversion codeのrefactor
- workspace isolation、staging、Safe Mode、rollback、cleanupの回避
- worker並列化
- required status / branch protectionの変更
- release tagの作成または公開
- UI snapshotの許容差を広げてflakinessを隠すこと

## Risks and accepted trade-offs

### Linux visual canonical cannot prove identical OS pixels

font metrics、native scrollbar、input control、anti-aliasはOSで異なる。Linuxをvisual正本にすると、macOS / Windows固有のpixel差はrequired gateで検出しない。

代わりにPRのmacOS / Windows smokeとrelease前の3 OS full screenshot reviewで次のEvidenceを残す。

- Webviewが作成される
- canvasと主要controlがvisibleになる
- error表示へ落ちない
- Host bridgeと変換outputが成立する

### External tool success adds environment failures

package jobへpdftocairo等をinstallすると、download、package manager、tool versionによる失敗が増える。しかし今回のmaintainer要求は「package後に実際に変換できること」であり、tool単体verifyだけでは代替できない。

tool setup failureとextension conversion failureをstep名とartifactで区別する。

### Smoke is representative, not exhaustive

3 OS package smokeはbackend familyと境界を代表する。

- `pdf-lib`: Crop Apply
- package済みnative dependency: PNG → JPEG
- external process + native encode: PDF → JPEG

Ghostscript、qpdf、rsvg-convert、Mermaid、Draw.ioの詳細な正常系と異常系はpre-package Extension Host / operation testsをownerとする。package omission riskが実測で見つかった場合は代表smoke追加を別途判断する。

### One spec improves install cost but must retain diagnosability

smokeを1 specへ集めるとVSIX install回数を減らせる。一方、1つの巨大test caseに全変換を詰めるとfailure原因が分かりにくい。

推奨は1 spec内の3 independent test casesであり、1 caseへ直列統合するのは実測でElectron起動が依然支配的な場合だけ再検討する。

## Handoff checklist

次の担当は、実装済みの責務を変更せず、次の順で検証を引き継ぐ。

1. `PROJECT_STATE.md`、このtask、test policy、packaging仕様、CI Evidence mapを読む
2. `npx playwright test --list --project=vscode-electron --project=vscode-electron-narrow`でLinux 33 cases（wide 18 + narrow 15）を確認する
3. PR workflowのLinuxが33 cases、macOS / Windowsが各3 smoke casesになることをworkflow commandとlist結果で確認する。CI scope classifier jobが存在しないことも確認する
4. release workflowの3 OSが各33 casesを実行し、各OSのscreenshot artifactを保存することを確認する
5. Linux wide 18枚 + narrow 18枚のbaselineを目視確認し、PRのsnapshot update対象がLinuxだけであることを確認する
6. Dockerを`linux/amd64`と`linux/arm64`でbuildし、全33 Linux casesとsnapshot copy-backを実行する（daemonが使えない場合は未検証として記録する）
7. static check、build、Webview test、script test、packaged smokeを実行する
8. cleanなPR headのGitHub ActionsでLinux full、macOS / Windows smokeを実行し、3 OSのtiming・artifact・orphan processを記録する
9. release相当の3 OS full screenshot artifactを目視確認する。pixel比較はreleaseのgateにしない
10. 未実行検証、失敗、残るgap（特にmacOS Meta-wheelのPR gap）を完了報告へ明記する

## Related files

- `.github/workflows/playwright.yml`
- `.github/workflows/release.yml`
- `.github/scripts/install-test-tools-linux.sh`
- `.github/scripts/install-image-tools-macos.sh`
- `.github/scripts/install-image-tools-windows.ps1`
- `.github/scripts/verify-image-tools-unix.sh`
- `.github/scripts/verify-image-tools-windows.ps1`
- `playwright.config.mjs`
- `test/playwright/electron/crop_pdf_configure.spec.ts`
- `test/playwright/electron/packaged_conversion_smoke.spec.ts`
- `test/playwright/electron/merge_pdf_configure.spec.ts`
- `test/playwright/electron/split_pdf_configure.spec.ts`
- `test/playwright/electron/helpers/crop_pdf_webview.ts`
- `test/playwright/electron/helpers/electron_test_env.ts`
- `test/playwright/electron/helpers/packaged_vsix.ts`
- `test/playwright/electron/helpers/vscode_electron_test.ts`
- `test/helpers/external_tool_settings.ts`
- `test/vscode-settings/settings.json`

## Audit provenance

- Audit date: 2026-08-02 JST
- Local branch at audit: `08-01-feat_webview_apply_unboxed_vertical_layout_to_crop_and_merge_pdf`
- Local commit at audit: `ae000d5`
- Working tree was clean before the audit handoff document was added; implementation changes were made afterward in this task
- GitHub repository: `naatin777/Graphics-Workbench`
- Implementation changed only test/config/workflow/documentation/snapshot scope: `playwright.config.mjs`, packaged Electron specs, PR/release workflows, Docker visual runner files, `.vscodeignore`, the 18 Linux-wide and 18 Linux-narrow canonical snapshots reviewed from successful Actions artifact `30733186958`, and the synchronized policy/matrix/task documents. No production conversion code, commit, push, PR, release, or external system state was changed.
- Local verification: `npm run typecheck:test`, `npm run build`, `npm run package:vsix`, `npx oxlint` (changed TypeScript/config files), YAML parse, Playwright list (33 tests), packaged smoke (3 passed in 15.5s), and Linux full-owner crop spec (7 passed in 27.8s).
- Cross-platform GitHub Actions timing and Windows/macOS runner evidence remain pending; the local macOS GUI run required escalated Electron launch permission.
