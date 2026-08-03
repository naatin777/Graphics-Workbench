# ADR-0026: 6 target VSIXをネイティブランナーで生成しsharpを実行検証する

## ステータス

採用

## 日付

2026-08-03

## 背景

ADR-0023で、6 targetのVSIXを`ubuntu-latest`上でnpm platform overrideによりcross-package生成し、ネイティブ実行はlinux-x64の最小Sharp smokeと既存3 OS packaged smokeに委ねると決めた。

この方式は生成と内容検証はできるが、darwin-x64、win32-arm64、linux-arm64のVSIXに同梱するsharpネイティブバイナリを実環境で実行できない。配布物に含まれるバイナリが実際にロード可能かを、可能な限り対象と同一のrunnerで確認したい。

## 決定

releaseの`package` jobは、対象と同一OS・CPUのGitHub-hosted runnerが利用可能なtargetはそのrunnerで生成し、native sharp smokeを実行する。

- `win32-x64` → `windows-latest`（x64）
- `darwin-x64` → `macos-15-intel`（Intel）
- `darwin-arm64` → `macos-latest`（Apple Silicon）
- `linux-x64` → `ubuntu-latest`（x64）
- `linux-arm64` → `ubuntu-24.04-arm`（arm64）
- `win32-arm64` → `windows-11-arm`はPublic previewのため使わず、`ubuntu-latest`でcross-package生成・内容検証のみ

各targetで`npm ci --include=optional`（runner一致）または`--os` / `--cpu` / `--libc`（cross）でoptional dependencyを解決し、`npm run build`、`scripts/verify-vsix.mjs --check-install`、native runnerでは`scripts/test-sharp.mjs`（sharp import、libvipsロード、PNG生成、versionログ）を実行してから`vsce package --target`でVSIXを生成し、`scripts/verify-vsix.mjs --vsix`で内容を検証する。

Marketplace公開は`azure/login`でEntra ID認証を確立し、各VSIXを`vsce publish --packagePath ... --azure-credential --skip-duplicate`で順に公開する。Azure DevOps PATは2026-12-01に廃止されるため使わない。`AZURE_CLIENT_ID`等の認証情報が未設定の間はpublish stepをskipし、失敗させない。GitHub ReleaseはMarketplace公開成功後に実行する。

## 理由

- ネイティブrunnerでは`npm ci --include=optional`だけでtarget一致の`@img` packageがinstallされ、不要な他platform packageが混入しない
- sharpのネイティブバイナリを実際にロードしPNGを生成できるtargetがlinux-x64の1つから5つへ増える
- Windows ARM64 runnerがPublic previewの間は、cross-package生成と内容検証を維持してtargetを落とさない
- `--skip-duplicate`で同一version再公開時に失敗せず冪等にできる
- Azure DevOps PATは2026-12-01に廃止されるため、長期間有効なEntra ID認証（`--azure-credential`）を使う
- 認証情報が未設定のまま公開jobが失敗してrelease全体を止めない

## 制約

- `win32-arm64`は`windows-11-arm`がPublic previewのため、native実行はしない。VSIX生成と内容検証（`@img/sharp-win32-arm64`同梱確認）のみ
- ネイティブrunnerのsharp smokeは各runner上のNode.jsで実行する。VS Code Extension Host上の実行確認は既存3 OS packaged smokeに委ねる
- Marketplace公開はAzure Entra ID（`azure/login` + `--azure-credential`）を使う。publisherへContributorメンバーとしてidentityを追加し、GitHub ActionsのOIDC federated credential設定が事前に必要
- GitHub ReleaseとMarketplaceの受理、署名、registry側の公開状態はworkflow実行時の外部証拠であり、ローカルテストでは保証しない

## 関連

- [ADR-0023: npm platform overrideで6 targetのVSIXを生成する](0023-build-six-target-vsix-with-npm-platform-overrides.md)
- [ADR-0015: npmからOS別VSIXを生成する](0015-build-platform-specific-vsix-from-runtime-staging.md)
- [VSIX packaging仕様](../specs/internal/packaging.md)
- [Task 0214: 6 target VSIXをネイティブランナーで生成・検証・公開する](../tasks/0214-native-runner-platform-vsix-release.md)
