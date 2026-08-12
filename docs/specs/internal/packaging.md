# VSIX packaging仕様

## dependency source

repository rootはprivate npm coordinatorで、npm workspaceは`core/`と`vscode/`で構成する。VSIXはrepository rootで`npm ci`と`npm run build`を実行した後、`npm run package:vsix -- --target <platform>-<architecture>`で生成する。package scriptは`core/`と`vscode/`をtarball化し、repository外の一時directoryへtarget用production dependency closureをinstallしてから、staged `vscode/package.json`をmanifestとしてローカルVSCEを実行する。一時directoryは成否にかかわらず削除する。

rootの`package-lock.json`はnpm workspace用の正本とする。target用staging installはworkspace symlinkを持ち込まず、pack済みtarballから`--package-lock=false`で使い捨てのproduction treeを解決する。`tui/`はnpm workspaceへ含めず、独立した`tui/bun.lock`と生成済み`tui/.core-package`を使うBun packageとし、TUI/OpenTUI/native dependencyをVSIX stagingへ含めない。

production dependencyが正常に含まれることをstaging treeと生成VSIXの内容で確認する。pack済み`vscode/package.json`の`files` allowlistをstagingで除去し、`vscode/.vscodeignore`と追加のgenerated test/source-map除外を適用する。変更時は各OS runnerでnative packageと生成VSIXを再確認する。

## target

package scriptはtarget未指定時にはrunnerの`process.platform`と`process.arch`からtargetを求め、明示的なtarget指定時には6つのsupported targetを受け付ける。staging installはnpmの`--os`、`--cpu`、Linuxの`--libc=glibc`、`--include=optional`を使ってoptional dependency treeをtargetごとに解決する。対応targetは`win32-x64`、`win32-arm64`、`darwin-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`で、Alpineは含めない。

targetとrunnerの対応:

| target         | runner             | 実行                                      |
| -------------- | ------------------ | ----------------------------------------- |
| `win32-x64`    | `windows-latest`   | native                                    |
| `win32-arm64`  | `ubuntu-latest`    | cross（`windows-11-arm`はPublic preview） |
| `darwin-x64`   | `macos-15-intel`   | native                                    |
| `darwin-arm64` | `macos-latest`     | native                                    |
| `linux-x64`    | `ubuntu-latest`    | native                                    |
| `linux-arm64`  | `ubuntu-24.04-arm` | native                                    |

`sharp@0.35.3`はWindows向けに`@img/sharp-win32-*`を提供し、独立した`@img/sharp-libvips-win32-*`を提供しない。Windows VSIXはtarget用`@img/sharp-win32-*`を必須とし、macOS / glibc Linuxではtarget用`@img/sharp-*`と`@img/sharp-libvips-*`の両方を必須とする。

6 target package jobはVSIX内容を検証し、runnerとtargetが一致する5 targetでは`scripts/test-sharp.mjs`（sharp import、libvipsロード、PNG生成、platform / arch / Node / N-API / sharp / libvips versionログ）を実行する。crossの`win32-arm64`は生成・内容検証のみでnative実行しない。既存の3 OS `package-smoke` jobは、runner上で生成したVSIXを実VS Code Electronへinstallするrelease smoke evidenceを維持する。

VSIXのtarget内容は生成後にZIP central directoryをNode.jsで検査し、`node_modules/sharp`、target native package、不要な他platform native package、直接devDependencyの混入を確認する。

## Marketplace publish

Marketplace公開はEntra ID認証を使う。Azure DevOps PATは2026-12-01に廃止されるため使わない。

公開前に必要な設定:

1. Visual Studio Marketplaceのpublisher管理ページ（`marketplace.visualstudio.com/manage`）でpublisher `naatin777` を作成する
2. Azure ADアプリ登録（またはuser-assigned managed identity）を作成する
3. GitHub Actions用のOIDC federated credentialを登録する（subject: `repo:naatin777/Graphics-Workbench:ref:refs/tags/v*`）
4. Marketplace publisherのメンバーにそのidentityを追加し、Contributorロールを付与する
5. GitHub Actions Secretに`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_SUBSCRIPTION_ID`を設定する

workflowは`azure/login@v2`（`permissions: id-token: write`）で認証を確立し、`vsce publish --azure-credential --skip-duplicate`で各VSIXを公開する。認証情報が未設定の間はpublish stepをskipし、公開処理を有効化しない。

Open VSX公開はOpen VSX固有の`OVSX_PAT`を使う。これはAzure DevOps PATとは別系統であり、上記の廃止対象ではない。

## CLI

packagingはrootの`npm`と`npx --no-install`を使う。Windowsを含む全platformでshell command stringを組み立てず、argument arrayと`shell: false`を使う。

Windowsを含む全platformでshell command stringを組み立てず、argument arrayと`shell: false`を使う。

## packaged smoke

各targetのVSIXは同じrunnerの実VS Code Electronへinstallする。PRではLinuxがCrop / Merge / Splitのwide+narrow full responsive suiteを実行し、macOS / Windowsはwide packaged conversion smokeを実行する。release前はLinux / macOS / Windowsの全wide+narrow suiteを実行し、`visual:capture`で生成した各OSのscreenshotを目視確認する。全OSでCrop Configureの小さいApply、PNG→JPEG、PDF→JPEG、Draw.io→PDFのsuccessful packaged conversion smoke 4 casesを確認する。PDF→JPEG smokeはconfigured `pdftocairo`、Unicode / space path、WindowsのASCII scratch、Sharp encode、staging / commit、success notificationまで確認する。PNG→JPEGの成功はVSIX内のSharp native dependencyがloadできた証拠とする。Draw.io→PDF smokeはconfigured `drawio` CLI（各OSのinstall / verify scriptで用意する）、単純な`.drawio` fixture、実CLI起動、PDF出力の生成と読み込みまで確認する。外部CLIのmissing / failure boundaryはLinuxのfull suiteとExtension Host testでownerを明示する。外部CLIはVSIXへbundleせず、各runnerのinstall / verify scriptで用意する。見た目の検証はpixel比較でなく、`visual:capture`で生成した画像を人間が目視確認する。

## version

VS Code integration testは固定versionを使う。互換性確認用のlatest stable testを追加する場合はrequired testと混同しない別jobにする。

## dependency security policy

pnpmからnpmへの移行(PR #367)で失われたinstall時のsecurity policyを、npmの公式機能で復元する。package managerはnpmのまま変更しない。

採用Node.js versionは`24.15.0`、npm versionは`npm@12.0.1`。CIは各workflowで`actions/setup-node`の`node-version: 24.15.0`をsetupしたあと、`npm install -g npm@12.0.1`を実行してから`npm ci`する。Node 24同梱のnpmはrepositoryの固定versionと異なるため、明示的に上書きする。localでは`devEngines.runtime`を`>=24.15.0`、`devEngines.packageManager`を`12.0.1`に固定し、いずれも`onFail: error`とする。これによりNode 24.15.0未満、またはnpm 12.0.1以外では`npm ci`が`EBADDEVENGINES`で即時失敗し、policyを迂回できない。`packageManager`フィールドだけではnpm versionは切り替わらない。localでもnpm 12.0.1を使うには、corepack/手動でnpm 12.0.1を有効にするか、CIと同じく`npm install -g npm@12.0.1`で上書きする必要がある。

CIのnpm download cacheは各jobで`actions/cache@v4`を使って有効化する。`setup-node@v6`の`package-manager-cache`は`false`のままにする。`setup-node`の自動cacheは、npm 12へupgradeする前のNode 24同梱npmで`npm config get cache`を実行し、`devEngines`の`packageManager`制約により`EBADDEVENGINES`で停止するためである。各jobはnpm 12.0.1へのupgrade後に`npm config get cache`でcache directoryを取得し、OS、architecture、Node.js 24.15.0、npm 12.0.1、`package-lock.json`のhashを含むkeyでcacheをrestoreする。`node_modules`はcacheせず、OS別native dependencyのinstallを`npm ci`で継続する。

責務の分離:

- `devEngines.packageManager`(`onFail: error`): localでnpm versionを強制し、12.0.1以外のinstallを即時拒否する。
- `devEngines.runtime`(`>=24.15.0`): repositoryのlocal開発・installに必要な最小Node versionを強制する。これはnpm 12.0.1の実行条件を含む。
- `engines.vscode`(`^1.125.0`): VSIXが対象とするVS Code versionを宣言する。Extension HostのNode versionはVS Codeが管理するため、extension manifestに`engines.node`は置かない。
- CIの`setup-node` + `npm install -g npm@12.0.1`: CI環境でもnpm 12.0.1とNode 24.15.0を確実に用意する。CIの強制は`devEngines`ではなくこのpinで担保する。
- `.npmrc`: install-script policy(`strict-allow-scripts`)、engine厳格化(`engine-strict`)、peer厳格化、release age(`min-release-age`)を定義する。

`.npmrc`のpolicy:

- `engine-strict=true`: `engines`に非互換なpackageのinstallを拒否する(pnpm `engineStrict`相当)。
- `strict-peer-deps=true`: peer dependencyの衝突をerrorにする(pnpm `strictPeerDependencies`相当)。npmのpeer auto-installは既定で有効なため`autoInstallPeers`は別設定不要。
- `strict-allow-scripts=true`: `allowScripts`未レビューのinstall scriptを持つpackageで`npm ci`をexit code 1で失敗させる(pnpm `allowBuilds`のenforcement相当)。`ignore-scripts`と`dangerously-allow-all-scripts`は使わない。
- `min-release-age=1`: 公開後1日未満のversionをdependency解決から除外する(pnpm `minimumReleaseAge: 1440`分=1日相当。npmの単位はday)。`npm ci`はlockfileを再解決しないため、この値は`npm install`時のみ効く。

install scriptの承認は`package.json`の`allowScripts`で管理する。現在のdependency treeを`npm ci`後の`npm install-scripts ls`で列挙し、install scriptを持つpackageは`@vscode/vsce-sign`、`keytar`、`lefthook`、`puppeteer`の4つ(すべてbuild・package・testで実行不要と実測)。`sharp`はprebuilt binary(`@img/sharp-*` optionalDependencies)を使いinstall scriptを持たないため承認対象外。承認は次の基準とする。

- `lefthook: true` — direct devDependency。localのgit hook installのみ。build/package/testに影響しない。version付きapproval(`lefthook@2.1.10: true`)はnpm 12.0.1のlockfile identityと一致せず承認されないため、dependencyをexact pin(`lefthook: "2.1.10"`)してname承認とする。
- `puppeteer@25.3.0: false` — mermaid-cli経由のtransitive。postinstallはChromium download。extensionはmmdcとChromeのdirect CLI実行にsystem Chromeまたは`execPath.chrome`を使うためbundled Chromeは不要。versionをpinしてdeny。
- `keytar: false` — `@vscode/vsce`経由のtransitive・optional・dev。native credential storage bindingのbuild。packagingはmarketplace認証を使わないため不要。
- `@vscode/vsce-sign: false` — `@vscode/vsce`経由のtransitive。VSIX署名用postinstall。`vsce package`は署名なしで動作するため不要。

`strict-allow-scripts=true`により、上記4つのいずれかがレビュー(true/false)から外れると`npm ci`が`ESTRICTALLOWSCRIPTS`で失敗する。さらに`lefthook`はdependencyをexact pin(`lefthook: "2.1.10"`)しているため、versionを更新するには`package.json`と`package-lock.json`の両方を意図的に変更する必要があり、`npm ci`はlockfile不一致(`EUSAGE`)で失敗する。つまりversion変更は再レビューを伴う明示的な変更として検知される。puppeteer等はversion付きdeny(`puppeteer@25.3.0: false`)でpin外れ時に再レビューが必要になる。CIは既存の`npm ci`がそのままgateになるため、追加の検査commandは不要。

audit: 2026-07-22の更新前full auditはhigh 5件(group)、moderate 2件、low 1件だった。`npm audit fix --package-lock-only`を`--force`なしで実行し、互換範囲内のlockfileだけを更新した。`brace-expansion`(2.1.1→2.1.2およびnested 5.0.6→5.0.7)、`fast-uri`(3.1.2→3.1.4)、`js-yaml`(4.2.0→4.3.0)、`linkify-it`(5.0.1→5.0.2)はdev-onlyで解消し、Mermaid経由のruntime `dompurify`も3.4.11→3.4.12へ更新して解消した。`package.json`、直接依存のversion range、新しいdirect dependencyは変更していない。

現行の`npm audit --audit-level=high`は、dev-onlyの`brace-expansion` chainについてhigh advisoryを残してexit 1となる。`@vscode/test-cli` → `mocha` → `serialize-javascript` chainは`package.json`のoverrideにより`serialize-javascript@7.0.5`へ解決され、serialize-javascriptのadvisoryは検出されない。`npm audit --omit=dev --audit-level=high`はpassし、runtime auditは0件である。security policy復元とvulnerability更新は分離し、auditはCI gateへ追加しない。`--audit-level`の無効化やadvisory ignore、`audit fix --force`は使わない。
