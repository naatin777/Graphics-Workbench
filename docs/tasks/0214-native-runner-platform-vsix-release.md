# 0214: 6 target VSIXをネイティブランナーで生成・検証・公開する

Status: Implemented

## Objective

6 targetのVSIXを、可能な限り対象と同一OS・CPUのGitHub-hosted runnerで生成し、`sharp`のネイティブバイナリを実環境でロード・実行検証してからMarketplace / GitHub Release / Open VSXへ公開する。Windows ARM64はrunnerがPublic previewのためcross-package生成・内容検証のみに分離する。

## Decision

[ADR-0026](../adr/0026-native-runner-platform-vsix-release.md)に記録した。ADR-0031を置き換え済みにした。

## Changes

- `scripts/test-sharp.mjs`を新設。sharp import、libvipsロード、2x2 PNG生成、非空Buffer確認、platform / arch / Node / N-API / sharp / libvips versionをログ出力する
- `.github/workflows/release.yml`
  - `package` jobのrunnerをネイティブランナーへ変更
    - `win32-x64` → `windows-latest`、`darwin-x64` → `macos-15-intel`、`darwin-arm64` → `macos-latest`、`linux-x64` → `ubuntu-latest`、`linux-arm64` → `ubuntu-24.04-arm`
    - `win32-arm64` → `windows-11-arm`はPublic previewのため`ubuntu-latest`でcross-package維持
  - インストールを「runner一致なら`npm ci --include=optional`、crossなら`--os` / `--cpu` / `--libc`」に分岐
  - ネイティブランナーで`scripts/test-sharp.mjs`を実行（旧linux-x64のみのインラインsmokeを置換）
  - `publish-marketplace`: Entra ID認証（`azure/login` + `vsce publish --azure-credential --skip-duplicate`）で公開。Azure DevOps PATは2026-12-01廃止のため不使用。`AZURE_CLIENT_ID`未設定時はpublish stepをskip、6個の一覧確認
  - `publish-github`: `publish-marketplace`成功後に実行（job失敗時はskip。認証情報未設定でpublish stepがskipされてもjobは成功扱いのためGitHub Releaseは継続）
  - `publish-open-vsx`: `OVSX_PAT`未設定時はpublish stepをskip
- `docs/adr/0026`新設、`docs/adr/0031`を置き換え済みに更新
- `docs/specs/internal/packaging.md`のtarget節を更新
- `README.md` / `README.ja.md`にプラットフォーム別パッケージ対応表、Remote挙動、非対応環境を追記

## Verification

- `scripts/test-sharp.mjs`をmacOS local（darwin-arm64）で実行し、PNG生成とversionログを確認
- `npm run test:scripts`、`node scripts/verify-vsix.test.mjs`通過
- `npm run package:vsix`（darwin-arm64）で生成し、`node scripts/verify-vsix.mjs --vsix ... --target darwin-arm64`で内容検証
- `release.yml`をYAML parseし、matrix runnerとpublish順序を確認
- `git diff --check`

## Completion conditions

- [x] 5 targetがネイティブランナーで生成され、sharpの実ロード・PNG生成を検証する
- [x] `win32-arm64`はcross-package生成・内容検証のみ（native実行なし）と明記する
- [x] Marketplace公開がEntra ID（`--azure-credential`）と`--skip-duplicate`で冪等、認証情報未設定時は失敗しない
- [x] Azure DevOps PATを使わない
- [x] GitHub ReleaseがMarketplace公開成功後に実行される
- [x] Universal VSIXを作らない
- [x] ADR-0026が採用、ADR-0031が置き換え済み

## Related files

- `.github/workflows/release.yml`
- `scripts/test-sharp.mjs`
- `scripts/verify-vsix.mjs`
- `scripts/package-vsix.mjs`
- `docs/adr/0031-build-six-target-vsix-with-npm-platform-overrides.md`
- `docs/adr/0026-native-runner-platform-vsix-release.md`
- `docs/specs/internal/packaging.md`
- `README.md` / `README.ja.md`
