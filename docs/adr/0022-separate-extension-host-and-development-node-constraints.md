# ADR-0022: Extension Hostと開発用Node.jsのversion制約を分離する

## ステータス

採用

## 日付

2026-07-28

## 背景

VS Code extensionのproduction codeは、開発者がshellで使うNode.jsではなく、VS Codeが内蔵するExtension HostのNode.jsで実行される。したがって、repositoryのinstall・build・lintに必要なNode.js versionと、extensionが実行されるVS Codeのruntime versionは同じ宣言で管理できない。

現在のrepositoryでは、VS Codeの対応versionを`^1.125.0`とし、repositoryの開発・install環境をNode.js `>=24.15.0`、npm `12.0.1`へ固定している。対応対象に含まれるVS Code 1.125.0のExtension HostもNode.js 24.15.0を使うが、extension runtimeと開発用runtimeは引き続き別の宣言で管理する。

VS CodeのExtension HostがNode.jsを実行runtimeとして持つことは[VS Code公式ドキュメント](https://code.visualstudio.com/api/advanced-topics/extension-host)に記載されている。VS Code 1.125.0はElectron 42.2.0を使い、そのNode.js runtime versionはNode.js 24.15.0である（[Electron releases](https://releases.electronjs.org/)、[VS Code 1.125 package.json](https://github.com/microsoft/vscode/blob/1.125.0/package.json)）。

## 決定

- extension manifestの`engines`には`vscode: ^1.125.0`だけを置き、`engines.node`は宣言しない。
- repositoryのlocal開発・installに必要なNode.jsの最小versionは、`devEngines.runtime: >=24.15.0`で強制する。
- npmのversionは、引き続き`devEngines.packageManager: npm 12.0.1`と`packageManager: npm@12.0.1`で固定する。
- CIとreleaseは、Node.js 24.15.0をsetupし、npm 12.0.1を明示的にinstallする。
- extension runtimeの互換性は、`engines.vscode`とVS CodeのExtension Host testで確認する。CIはcurrent stable（3 OS full）を実行する。repositoryの開発用Node.js versionを、VS Code内蔵Node.jsのversion宣言として扱わない。

## 理由

- VS Code利用者に、Extension Hostでは不要なNode.js 24.15.0以上を要求しない。
- npm 12.0.1のinstall・開発環境に必要なNode.jsの制約は`devEngines`で維持できる。
- npmの`engines`は依存パッケージのversion条件を表し、`devEngines`はsource codeと対話する開発者向けのruntime・package manager条件を表すため、用途を分ける方が宣言の意味と一致する。
- `engines.vscode`を維持することで、extensionが対象とするVS CodeのAPI世代は引き続きpackage manifestから確認できる。

## 代替案

### `engines.node`を`>=22.19.0`へ下げる

VS Code 1.125.0のExtension Hostには適合するが、repositoryのinstall・開発環境とextension runtimeを1つの制約へ混在させる。npm 12.0.1の要求も別に表す必要があり、責務分離にならないため採用しない。

### `engines.node: >=24.15.0`を維持する

開発環境のinstall policyは保てるが、VS Code 1.125.0でも動作可能なextensionに対して、VS Code利用者へ誤ったNode.js下限を示すため採用しない。

### `engines.node`と`devEngines.runtime`を同じversionで併記する

install時のengine enforcementはできるが、同じversionを異なるruntimeの条件として重複宣言し、今回の意味のずれを残すため採用しない。

## 結果・影響

- VSIXの対象runtimeは`engines.vscode`とExtension Host testで判断し、repositoryのNode.js制約は`devEngines`で判断する。
- `npm ci`は`devEngines.runtime`、`.npmrc`の`engine-strict`、CIのNode/npm pinによって、従来どおり開発環境のpolicyを検査する。
- package manifestから`engines.node`がなくなるため、VSIX利用者へrepositoryのnpm toolchain要件を誤って伝えなくなる。
- 将来、extensionがVS Code内蔵Node.jsの新しいAPIを必要とする場合は、先に`engines.vscode`の最小versionとExtension Host testを見直す。

## 見直す条件

- 対応最小VS Code versionまたはExtension HostのNode.js世代を変更するとき
- npm 12.0.1、CIのNode.js version、production dependencyのNode.js要求を変更するとき
- VS Codeがextension manifestでNode.js versionを正式に扱うようになったとき
- Extension Host testで、対応最小VS Codeのruntimeとの互換性問題が確認されたとき

## 関連

- [ADRの運用方針](README.md)
- [ADR-0018: pre-package testはVS Code Extension Hostで実行する](0018-use-extension-host-for-pre-package-tests.md)
- [VSIX packaging仕様](../specs/internal/packaging.md)
- [0202: npm移行で失われた依存install security policyを復元する](../tasks/0202-restore-npm-dependency-security-policy.md)
- [VS Code test設定](../../.vscode-test.mjs)
