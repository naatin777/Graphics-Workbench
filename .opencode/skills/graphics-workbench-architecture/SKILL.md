---
name: graphics-workbench-architecture
description: Graphics Workbenchの実装時に守るアーキテクチャ・保守方針。入力制限とタイムアウト、途中移行・互換残骸、command登録と生成metadataの正本を扱う。実装やリファクタリングの前に確認する。
---

# アーキテクチャ・保守方針

## 入力制限・タイムアウト

- 入力サイズ・PDFページ数に対する共通固定上限を追加しない。
- 本処理の共通実行タイムアウトを追加しない。停止はユーザーのキャンセルで行う。
- サイズやページ数だけを理由にした確認ダイアログを追加しない。
- 操作固有の制限・タイムアウトは、再現可能な技術的根拠・対象固有の理由・一律制限以外で解決不可・テスト・ADR更新をすべて満たす場合のみ。
- 制御処理（起動確認・通信・キャンセル後の終了猶予）の短いタイムアウトは本処理と混同しない。
- セキュリティガード（decompression bomb対策・パス検証）は任意の入力制限と混同して削除しない。

## 途中移行・互換残骸

- 旧command ID・旧settingを内部aliasやfallbackとして復活させない。
- 一時的なalias・fallback・wrapperは、canonical置き換え先・利用者・public/internal・削除条件・削除予定version・canonical経路のテスト・削除一覧を明記した場合のみ。
- 旧API専用のwrapper・NLS・テストは残さずcanonicalへ統合する。
- command IDとpair-specific outputPath設定キー（`outputPath.convertPngToPdf`等）の粒度を混同しない。

## command登録と生成metadataの正本

- package.json由来のcommand ID・configuration schema・Extension identity・submenu metadataは、`src/generated/extension_manifest.ts`へ手書きしない（`npm run generate:extension-meta`で再生成）。
- public commandの実装bindingは`src/commands/shared/command_bindings.ts`を正本とする。`extension.ts`への個別登録を追加しない。
- generator内へlegacy command IDを直接記述しない。
- 旧command alias・一時的なinternal commandは「念のため」残さない。
