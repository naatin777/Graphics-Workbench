# ADR-0023: npm platform overrideで6 targetのVSIXを生成する

## ステータス

置き換え済み（[ADR-0026: 6 target VSIXをネイティブランナーで生成しsharpを実行検証する](0026-native-runner-platform-vsix-release.md)で置き換え）

## 日付

2026-08-03

## 背景

既存releaseはLinux、macOS、Windowsのrunner上でrunner一致targetを1つずつ生成していた。`sharp`はoptional dependencyとしてOS / CPUごとのnative packageを持つため、6つの配布targetを作るにはtargetごとにdependency treeを分けて解決し、生成VSIXの内容を検証する必要がある。

## 決定

- package managerはnpm、依存lockfileは既存の`package-lock.json`だけを使う。
- releaseの`package` jobは`ubuntu-latest`のmatrixで、次の6 targetを並列生成する。
  - `win32-x64`: `--os=win32 --cpu=x64`
  - `win32-arm64`: `--os=win32 --cpu=arm64`
  - `darwin-x64`: `--os=darwin --cpu=x64`
  - `darwin-arm64`: `--os=darwin --cpu=arm64`
  - `linux-x64`: `--os=linux --cpu=x64 --libc=glibc`
  - `linux-arm64`: `--os=linux --cpu=arm64 --libc=glibc`
- 各matrix jobは`npm ci --include=optional`、`npm run build`、target native package確認、`vsce package --target <target>`、VSIX内容確認、artifact uploadを行う。
- VSIX内容はNode.jsのZIP一覧検査で確認する。`sharp`本体、target native package、platform混在、直接devDependencyの混入を検査する。
- `sharp@0.35.3`のWindows配布構造には独立した`@img/sharp-libvips-win32-*`がないため、Windowsは`@img/sharp-win32-*`を検証し、macOS / glibc Linuxは`@img/sharp-libvips-*`も検証する。
- 既存のrunner一致3 OS packaged smokeは`package-smoke`として維持し、publish jobは6 target packageと既存の全検証jobの成功後に実行する。
- Marketplace、GitHub Release、Open VSXの認証方式とtag `v*.*.*` triggerは変更しない。
- Alpine Linux targetは生成しない。

## 理由

- npmの既存lockfileとoptional dependency解決を維持できる。
- CPUを実行できないtargetでも、VSIX生成とnative packageの同梱内容を検証できる。
- runnerとtargetが一致するLinux x64では、生成後にSharpの最小PNG変換を実行できる。
- 既存の3 OS Electron smokeを残すため、配布物の実行確認を失わない。

## 制約

- `darwin-arm64`、`win32-arm64`、`linux-arm64`のVSIXは、x64 Ubuntu runner上で生成・内容検証するが、そのrunnerではnative Sharpを実行しない。
- GitHub ReleaseとMarketplaceの受理、署名、registry側の公開状態はworkflow実行時の外部証拠であり、ローカルテストでは保証しない。

## 関連

- [ADR-0015: npmからOS別VSIXを生成する](0015-build-platform-specific-vsix-from-runtime-staging.md)
- [VSIX packaging仕様](../specs/internal/packaging.md)
