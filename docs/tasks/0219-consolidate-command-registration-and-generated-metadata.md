# 0219: command登録と生成metadataの正本を整理する

Status: Done

## Objective

command ID・runtime登録・生成metadataの正本が分散していた状態を整理し、manifest / binding / runtime登録 / テストの集合を常に一致させる。

## Problem

command情報が以下へ分散し、manifestから削除された旧commandがruntime登録に残る不整合が発生していた。

- `package.json`の`contributes.commands`
- 生成された`publicCommandIds`
- `src/extension.ts`の個別`registerFileCommand`呼び出し（約260行・34個）
- `PUBLIC_COMMAND_IDS` / `INTERNAL_COMMAND_IDS` / `REGISTERED_COMMAND_IDS`
- `scripts/generate-extension-meta.ts`内の手書き配列
- Extension Host test内の期待command一覧
- `src/generated-extension-meta.ts` / `src/generated-extension-config.ts`の2生成ファイル

## Changes

### PR #119: generated manifestとconfig adapterの分離

- `src/generated-extension-meta.ts` → `src/generated/extension_manifest.ts`（pure、`vscode`非依存を維持）
- `getExtensionConfiguration`を生成物から外し、手書き`src/config/extension_configuration.ts`（唯一のVS Code adapter）へ
- generatorはpure manifestのみ生成。check modeは新生成物を検証し、旧生成ファイルの残存をscripts testで検出
- `test/workspace/.gitkeep`がテスト実行で消える問題を修正（workspaceクリア時に`.gitkeep`だけ維持）

### PR #120: command bindingの正本化とdata-driven登録

- `src/commands/shared/command_bindings.ts`: 全34個のpublic commandの実装bindingを型付き宣言（`id: CommandId`、`module`、export名、`adapter`、固定`options`）で集約
- `src/commands/shared/command_registrations.ts`: bindingをdata-drivenに登録。adapterは`file` / `fileWithContext` / `fileWithOptions` / `extensionCommand`の4種類のみ。dynamic import・lazy load計測を維持
- `src/extension.ts`: 個別登録約260行と`PUBLIC_COMMAND_IDS`を削除し、activation orchestrationだけに限定
- `toggleSafeMode`を`toggleSafeModeCommand`としてexport化し、command登録だけbinding経由に
- **バグ修正**: `extensionCommand` adapterが引数0で`command(...args, dependencies)`を呼ぶと`dependencies`が第一引数に化け、undoが`newer-conversion`扱いでmodalハングする問題を修正
- knip: binding経由の動的importを追跡できないため、lazily loadedなcommand moduleをentry登録

### PR #121: binding/manifest整合性の検証

- `test/commands/command_bindings.test.ts`: binding↔`publicCommandIds`完全一致・重複なし・module/export実在・登録集合一致・旧`convertPngToPdf`非登録・adapter別引数・`ExtensionContext`・fixed options・lazy load計測・例外伝播を検証
- `command_registrations.ts`: resolver注入（`registerCommandBindings`）を追加しテスト可能に

### PR #122: package.json由来のExtension metadata生成とmanifest検証

- `extensionIdentity`（name/publisher/id/displayName/version/repository/configurationNamespace）を生成し、config adapter・integration test・Output Channel名に利用
- `commandContributions`（titleKey/category）＋ `submenuContributions`（labelKey）＋ `SubmenuId`を生成し、manifest整合テストで利用
- `externalToolTimeoutConfigurationKeys`を`externalTools.*.timeoutSeconds`から導出し、`external_tool_settings.ts`のtool一覧の重複を削減（`ExternalToolId = keyof ...`）。CLI名`rsvg-convert`は内部ID`rsvgConvert`と分離
- generator検証: command/submenuのnamespace・重複、menuの未定義command/submenu参照・同一menu内重複・when句の未定義config参照を生成時に拒否
- 実在した重複（commandPaletteの`mergePdf.configure`2件）を削除
- generatorをunit test可能にし、generator unit test（identity/contributions/keys生成、validation 14件）を追加

## 最終構成

```text
package.json
  └─ Extension identity / command contributions / submenu contributions / configuration schema
command binding definition (src/commands/shared/command_bindings.ts)
  └─ command ID / module / export / adapter / fixed options
src/generated/extension_manifest.ts      # pure metadata（vscode非依存）
src/config/extension_configuration.ts    # VS Code configuration adapter
src/commands/shared/command_registrations.ts  # data-driven command registration
src/extension.ts                         # activation orchestration
```

## Verification

- `npm run check:all`（lint / format / typecheck×4 / check:extension-meta / check:nls / knip / test:scripts）
- `npm run build`
- `npm run test:scripts`: 27 pass（pure import・stale file・generator unit test含む）
- `npm test`: 514 passing / 6 pending
- PR #119–#121は全CI green確認後マージ
- PR #122も全CI green（12 checks）確認後マージし、`main`へ統合完了
