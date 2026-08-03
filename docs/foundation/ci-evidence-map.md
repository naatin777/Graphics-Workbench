# v1 CI Evidence map

- 状態: 監査用draft
- 対象: `check.yml`, `test.yml`, `playwright.yml`, `release.yml`, root package scripts
- 重要: workflowが`pull_request`で起動することと、GitHub branch protectionでmerge必須に設定されていることは別である。後者はこの文書では`unknown`。
- test file / caseの完全列挙は[test-file-inventory](test-file-inventory.md)を参照する。過去のBrowser / Electron比較は履歴資料として[browser-electron-overlap](browser-electron-overlap.md)に残す。

## 1. Workflow map

| Workflow        | Trigger              | Docs-only behavior | Platform                | Main command / Evidence                                                                                                                                                                                           | Failure artifact                           | Evidence class                                                                                   |
| --------------- | -------------------- | ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Check           | PR、main push        | skipしない         | Linux                   | `npm run check`                                                                                                                                                                                                   | なし                                       | lint、format、4種typecheck                                                                       |
| Test            | PR、main push        | skipしない         | Linux / macOS / Windows | `build` → `test` + `test:webview`                                                                                                                                                                                 | Extension Host user-data directory         | Host、operation、filesystem、JSDOM component test                                                |
| Playwright      | PR、main push        | skipしない         | Linux / macOS / Windows | Linux: `xvfb-run npm run test:playwright:vsix`（33 cases、wide+narrow pixel）; macOS / Windows: `npm run test:playwright:vsix -- --project=vscode-electron electron/packaged_conversion_smoke.spec.ts`（3 cases） | Playwright report / test-results           | Linux full visual / responsive; 3 OS wide packaged conversion smoke                              |
| Release package | tag                  | 対象外             | Linux / macOS / Windows | 全OS: `npm run test:playwright:vsix`（33 cases、pixel比較なし、各OS screenshot artifact）                                                                                                                         | `test-results/`, screenshot artifact, VSIX | runner-matched artifact, native dependency, successful packaged conversion, manual visual review |
| Release publish | tag、package全成功後 | 対象外             | Linux                   | downloaded VSIX artifactsをpublish                                                                                                                                                                                | registry response                          | distribution action                                                                              |

## 2. Local command semantics

| Command                                                                                                | Includes                                                                                                              | Excludes                        | Interpretation                                             |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| `npm run check`                                                                                        | lint、format、4種typecheck                                                                                            | runtime tests、package、NLS     | static verification                                        |
| `npm run build`                                                                                        | clean、compile、test compile、Webview build                                                                           | runtime tests、package          | shared prerequisite                                        |
| `npm test`                                                                                             | fixed VS Code Extension Host test-cli                                                                                 | Browser、Electron、package      | Host / operation integration                               |
| `npm run test:webview`                                                                                 | crop、merge、split JSDOM component tests                                                                              | PDF.js real rendering、Electron | fast component interaction checks                          |
| `npm run test:playwright:vsix`                                                                         | packaged `graphics-workbench.vsix`のwide / narrow full suite（PR Linuxではpixel比較、releaseではscreenshot artifact） | Browser、Host Mocha             | full installed VSIX visual / responsive journey            |
| `npm run test:playwright:vsix -- --project=vscode-electron electron/packaged_conversion_smoke.spec.ts` | macOS / Windowsではwideの3 packaged conversion smoke                                                                  | Browser、Host Mocha、narrow UI  | cross-platform artifact / bridge / native conversion smoke |
| `npm run package:vsix`                                                                                 | runner-matched target package                                                                                         | installed execution             | artifact creation only                                     |
| `docker buildx build ... docker/playwright-visual/Dockerfile`                                          | 固定Linux wide+narrow full visual image（amd64 / arm64）                                                              | native macOS / Windows          | local full Playwright reproduction / snapshot regeneration |

## 3. PR Evidence currently available

### Static

- lint
- format
- production TypeScript
- test TypeScript
- Webview production / test TypeScript
- NLS key / placeholder consistency

### Runtime on three OS

Test workflowはLinux、macOS、WindowsでVS Code Extension Host suiteを実行する。

現在このsuiteへ混在するもの:

- real VS Code activation / command / provider
- pure data / protocol
- Node filesystem safety
- PDF / image operation
- external tool wrapper

したがって3 OS Evidence自体は存在するが、test failureがVS Code integration由来かpure operation由来かをjob名から判断しにくい。

### Packaged Electron on three OS

Playwright workflowはLinux、macOS、Windowsでrunner-matched VSIXをpackageし、`graphics-workbench.vsix`としてそのVSIXだけをElectronへinstallして実行する。PRはLinuxでwide / narrowのfull UI・responsive・pixel snapshotを、macOS / Windowsでwideの3 conversion smokeを実行する。release packageは3 OSすべてでwide / narrow full suiteを実行し、pixel比較なしのscreenshot artifactを保存して目視確認する。DockerはActionsの通常jobには組み込まず、Linux full Playwrightのローカル再現とsnapshot regenerationに使う。

- real VS Code window / Webview / Host bridge
- Linux wide+narrowのtheme / pixel snapshot、Linux wide / narrowのCSP、PDF.js canvas、responsive layout
- 3 OSのpackaged Sharp native loadとPNG→JPEG output decode
- 3 OSのconfigured `pdftocairo`、Unicode / space path、staging / commit、PDF→JPEG success
- OSごとのinstallation、path、native module差

Browser-only runnerやsource directory fallbackは現行構成に存在しない。過去のBrowser test記録は履歴資料として保持する。

## 4. Release Evidence

release package jobは各native runnerで次を実行する。

1. dependency install
2. build
3. runnerに一致するVSIX targetをpackage
4. VSIXを実VS Codeへinstall
5. Electron specをpackaged modeで実行
6. PRはLinux full UI / responsive / wide+narrow pixel snapshot、macOS / Windows wide conversion smokeを実行
7. release packageは3 OSでfull Playwrightを実行し、各OS screenshot artifactを目視確認
8. 小さいCrop Applyで実Extension Host bridgeとPDF outputを確認
9. PNG→JPEGでSharp native dependency、decode / format / dimensionsを確認
10. PDF→JPEG成功でpdftocairo、Unicode / space path、ASCII scratch、staging / commit、notificationを確認
11. Linux full suiteでmissing `pdftocairo` error boundaryを確認

これにより、development extension testでは得られない次を確認する。

- `.vscodeignore` / package content
- production dependency deployment
- native Sharp binary
- installed extension discovery
- controlled external-fetch failureを確認するLinux packaged Webview
- macOS / Windowsのsuccessful external conversion

## 5. Gaps and misleading names

| ID         | Observation                                                                                                     | Risk                                                | Current handling                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| CI-GAP-001 | branch protectionのrequired statusが未確認                                                                      | workflow定義とmerge gateを混同                      | GitHub repository rulesetで別途確認                                              |
| CI-GAP-002 | 3 OSのpackage、VSIX install、Electron E2EはCI実測が必要                                                         | local macOSだけではcross-platform successを証明不可 | GitHub Actionsの結果を正本にする                                                 |
| CI-GAP-003 | VSIX package failure時の詳細ログはrunner output中心                                                             | package failureの再現情報が少ない                   | package commandのstdout/stderrとartifactを確認する                               |
| CI-GAP-004 | Electron E2EはreleaseとPRでOS別allocation（PRはLinux full + macOS / Windows smoke、releaseは3 OS full）が異なる | releaseとPRのcase差を見落とす                       | workflow commandとrunner-matched VSIX artifactを同期し、OS別Evidenceを正本にする |

## 6. Gate model after task 0212

0212でworkflowへ反映したrequired-scope allocationを記録する。branch protectionのrequired status自体は別管理であり、この文書では設定しない。

### PR static gate

- check: lint / format / four typechecks
- pull request description: `## Verification` sectionはPR templateで案内し、CIで強制しない。PR本文のローカルパス漏洩は、push前のpre-commit `environment-paths`とtemplateのPrivacy checklistで防ぐ（PR作成後のCI検知は漏洩を防げないため実施しない）

### PR behavior gate

- 3 OS VS Code Extension Host
- 3 OS JSDOM Webview component tests
- Linux full installed VSIX Electron E2E
- macOS / Windows wide packaged conversion smoke

### PR Electron gate

- Linux: full UI / responsive suite（wide / narrow pixel snapshot canonical）
- macOS / Windows: wide packaged conversion smoke（Crop bridge、Sharp PNG→JPEG、pdftocairo PDF→JPEG）
- macOS / WindowsのPRではpixel snapshotとnarrow UI suiteをrequired scopeにしない。release packageでは3 OSともnarrow UI suiteを実行し、画像artifactを目視確認する

### Pre-release / release candidate gate

- 3 OS package
- 3 OS installed VSIX smoke
- native dependency
- complete offline behaviorの未証明
- external tool missing behavior

### Tag publish gate

- pre-release Evidenceを再利用できるか検討
- current workflowのようにtagから再packageする場合、同じsource SHAであることを明示

## 7. Required decisions

1. branch protection上で必須とするstatus名
2. GitHub ActionsのLinux / macOS / Windows実測結果
3. release artifact download / publish前提の実行結果

## 8. Correction to the initial audit

初稿では`.github/workflows/check.yml`だけを確認し、「通常PRはruntime testへ接続されていない」と記録した。これは誤りだった。

実際には、現行workflowは次のように分離している。

- `check.yml`がstatic checkを実行する
- `test.yml`が3 OSのbuild、VS Code Extension Host、JSDOM component testを実行する
- `playwright.yml`が3 OSのbuild、runner-matched VSIX packageを行い、PRではLinux full wide+narrow pixel E2E、macOS / Windowsではwide packaged conversion smokeを実行する
- `release.yml`が3 OS full Playwrightとscreenshot artifactを通過したrunner-matched VSIXだけをpublishする

Browser-only runner、docs-only classifier、source directory fallbackは現行構成から除去し、過去の監査資料は履歴として保持する。
