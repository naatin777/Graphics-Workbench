# VSIX packaging仕様

## dependency source

VSIXはrepository rootで`npm ci`、`npm run build`、ローカルVSCEのNode entrypointを`node node_modules/@vscode/vsce/vsce package --target <platform>-<architecture>`として実行して生成する。依存lockfileは通常の`package-lock.json`だけを使い、VSIX専用lockfileやstaging内の依存再解決は行わない。

production dependencyが正常に含まれることを`npm ls --omit=dev`と生成VSIXの内容で確認する。変更時は各OS runnerでnative packageと生成VSIXを再確認する。

rootの`package.json`をそのまま使い、`.vscodeignore`でruntimeに不要な開発ファイルを除外する。

## target

package scriptはtarget未指定時にはrunnerの`process.platform`と`process.arch`からtargetを求め、明示的なtarget指定時には6つのsupported targetを受け付ける。releaseのpackage matrixはUbuntu runner上でnpmの`--os`、`--cpu`、Linuxの`--libc=glibc`を使ってoptional dependency treeをtargetごとに解決する。対応targetは`win32-x64`、`win32-arm64`、`darwin-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`で、Alpineは含めない。

`sharp@0.35.3`はWindows向けに`@img/sharp-win32-*`を提供し、独立した`@img/sharp-libvips-win32-*`を提供しない。Windows VSIXはtarget用`@img/sharp-win32-*`を必須とし、macOS / glibc Linuxではtarget用`@img/sharp-*`と`@img/sharp-libvips-*`の両方を必須とする。

6 target package jobはVSIX内容を検証し、実行テストはrunnerとtargetが一致する`linux-x64`で最小Sharp smokeを行う。既存の3 OS `package-smoke` jobは、runner上で生成したVSIXを実VS Code Electronへinstallするrelease smoke evidenceを維持する。

VSIXのtarget内容は生成後にZIP central directoryをNode.jsで検査し、`node_modules/sharp`、target native package、不要な他platform native package、直接devDependencyの混入を確認する。

## CLI

packagingはrootの`npm`と`npx --no-install`を使う。Windowsを含む全platformでshell command stringを組み立てず、argument arrayと`shell: false`を使う。

Windowsを含む全platformでshell command stringを組み立てず、argument arrayと`shell: false`を使う。

## packaged smoke

各targetのVSIXは同じrunnerの実VS Code Electronへinstallする。PRではLinuxがCrop / Merge / Splitのwide+narrow pixel snapshotとfull responsive suiteを実行し、macOS / Windowsはwide packaged conversion smokeを実行する。release前はLinux / macOS / Windowsの全wide+narrow suiteを実行し、pixel比較ではなく各OSのscreenshot artifactを目視確認する。全OSでCrop Configureの小さいApply、PNG→JPEG、PDF→JPEGのsuccessful packaged conversion smokeを確認する。PDF→JPEG smokeはconfigured `pdftocairo`、Unicode / space path、WindowsのASCII scratch、Sharp encode、staging / commit、success notificationまで確認する。PNG→JPEGの成功はVSIX内のSharp native dependencyがloadできた証拠とする。外部CLIのmissing / failure boundaryはLinuxのfull suiteとExtension Host testでownerを明示する。外部CLIはVSIXへbundleせず、各runnerのinstall / verify scriptで用意する。ローカルLinux full visualの再現・snapshot regenerationは、Actions native runnerとは別に`docker/playwright-visual/Dockerfile`で行う。

## version

VS Code integration testは固定versionを使う。互換性確認用のlatest stable testを追加する場合はrequired testと混同しない別jobにする。

## dependency security policy

pnpmからnpmへの移行(PR #367)で失われたinstall時のsecurity policyを、npmの公式機能で復元する。package managerはnpmのまま変更しない。

採用npm versionは`npm@12.0.1`。CIは各workflowで`actions/setup-node`の`node-version: 22.23.1`(npm@12.0.1が要求するNode下限)をsetupしたあと、`npm install -g npm@12.0.1`を実行してから`npm ci`する。Node 22同梱のnpmは10系でinstall-script policyやmin-release-ageを持たないため、明示的に上書きする。localでは`devEngines.packageManager`を`12.0.1`に固定し`onFail: error`とする。これによりnpm 10など12.0.1以外では`npm ci`が`EBADDEVENGINES`で即時失敗し、policyを迂回できない。`packageManager`フィールドだけではnpm versionは切り替わらない。localでもnpm 12.0.1を使うには、corepack/手動でnpm 12.0.1を有効にするか、CIと同じく`npm install -g npm@12.0.1`で上書きする必要がある。

CIのnpm download cacheは各jobで`actions/cache@v4`を使って有効化する。`setup-node@v6`の`package-manager-cache`は`false`のままにする。`setup-node`の自動cacheは、npm 12へupgradeする前のnpm 10で`npm config get cache`を実行し、`devEngines`の`packageManager`制約により`EBADDEVENGINES`で停止するためである。各jobはnpm 12.0.1へのupgrade後に`npm config get cache`でcache directoryを取得し、OS、architecture、Node.js 22.23.1、npm 12.0.1、`package-lock.json`のhashを含むkeyでcacheをrestoreする。`node_modules`はcacheせず、OS別native dependencyのinstallを`npm ci`で継続する。

責務の分離:

- `devEngines.packageManager`(`onFail: error`): localでnpm versionを強制し、12.0.1以外のinstallを即時拒否する。
- `devEngines.runtime`(`>=22.22.2`): repositoryのlocal開発・installに必要な最小Node versionを強制する。これはnpm 12.0.1の実行条件を含む。
- `engines.vscode`(`^1.105.0`): VSIXが対象とするVS Code versionを宣言する。Extension HostのNode versionはVS Codeが管理するため、extension manifestに`engines.node`は置かない。
- CIの`setup-node` + `npm install -g npm@12.0.1`: CI環境でもnpm 12.0.1とNode 22.23.1を確実に用意する。CIの強制は`devEngines`ではなくこのpinで担保する。
- `.npmrc`: install-script policy(`strict-allow-scripts`)、engine厳格化(`engine-strict`)、peer厳格化、release age(`min-release-age`)を定義する。

`.npmrc`のpolicy:

- `engine-strict=true`: `engines`に非互換なpackageのinstallを拒否する(pnpm `engineStrict`相当)。
- `strict-peer-deps=true`: peer dependencyの衝突をerrorにする(pnpm `strictPeerDependencies`相当)。npmのpeer auto-installは既定で有効なため`autoInstallPeers`は別設定不要。
- `strict-allow-scripts=true`: `allowScripts`未レビューのinstall scriptを持つpackageで`npm ci`をexit code 1で失敗させる(pnpm `allowBuilds`のenforcement相当)。`ignore-scripts`と`dangerously-allow-all-scripts`は使わない。
- `min-release-age=1`: 公開後1日未満のversionをdependency解決から除外する(pnpm `minimumReleaseAge: 1440`分=1日相当。npmの単位はday)。`npm ci`はlockfileを再解決しないため、この値は`npm install`時のみ効く。

install scriptの承認は`package.json`の`allowScripts`で管理する。現在のdependency treeを`npm ci`後の`npm install-scripts ls`で列挙し、install scriptを持つpackageは`@vscode/vsce-sign`、`keytar`、`lefthook`、`puppeteer`の4つ(すべてbuild・package・testで実行不要と実測)。`sharp`はprebuilt binary(`@img/sharp-*` optionalDependencies)を使いinstall scriptを持たないため承認対象外。承認は次の基準とする。

- `lefthook: true` — direct devDependency。localのgit hook installのみ。build/package/testに影響しない。version付きapproval(`lefthook@2.1.10: true`)はnpm 12.0.1のlockfile identityと一致せず承認されないため、dependencyをexact pin(`lefthook: "2.1.10"`)してname承認とする。
- `puppeteer@25.3.0: false` — mermaid-cli経由のtransitive。postinstallはChromium download。extensionはpuppeteer-coreでsystem Chrome(channel)またはuser executablePathを使うためbundled Chromeは不要。versionをpinしてdeny。
- `keytar: false` — `@vscode/vsce`経由のtransitive・optional・dev。native credential storage bindingのbuild。packagingはmarketplace認証を使わないため不要。
- `@vscode/vsce-sign: false` — `@vscode/vsce`経由のtransitive。VSIX署名用postinstall。`vsce package`は署名なしで動作するため不要。

`strict-allow-scripts=true`により、上記4つのいずれかがレビュー(true/false)から外れると`npm ci`が`ESTRICTALLOWSCRIPTS`で失敗する。さらに`lefthook`はdependencyをexact pin(`lefthook: "2.1.10"`)しているため、versionを更新するには`package.json`と`package-lock.json`の両方を意図的に変更する必要があり、`npm ci`はlockfile不一致(`EUSAGE`)で失敗する。つまりversion変更は再レビューを伴う明示的な変更として検知される。puppeteer等はversion付きdeny(`puppeteer@25.3.0: false`)でpin外れ時に再レビューが必要になる。CIは既存の`npm ci`がそのままgateになるため、追加の検査commandは不要。

audit: 2026-07-22の更新前full auditはhigh 5件(group)、moderate 2件、low 1件だった。`npm audit fix --package-lock-only`を`--force`なしで実行し、互換範囲内のlockfileだけを更新した。`brace-expansion`(2.1.1→2.1.2およびnested 5.0.6→5.0.7)、`fast-uri`(3.1.2→3.1.4)、`js-yaml`(4.2.0→4.3.0)、`linkify-it`(5.0.1→5.0.2)はdev-onlyで解消し、Mermaid経由のruntime `dompurify`も3.4.11→3.4.12へ更新して解消した。`package.json`、直接依存のversion range、新しいdirect dependencyは変更していない。

現行の`npm audit --audit-level=high`は、dev-onlyの`brace-expansion` chainについてhigh advisoryを残してexit 1となる。`@vscode/test-cli` → `mocha` → `serialize-javascript` chainは`package.json`のoverrideにより`serialize-javascript@7.0.5`へ解決され、serialize-javascriptのadvisoryは検出されない。`npm audit --omit=dev --audit-level=high`はpassし、runtime auditは0件である。security policy復元とvulnerability更新は分離し、auditはCI gateへ追加しない。`--audit-level`の無効化やadvisory ignore、`audit fix --force`は使わない。
