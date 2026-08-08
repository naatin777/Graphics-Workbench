# 0226: 全テスト名を処理フローの日本語訳に全面書き換える

Status: Done

## Result

全106テストファイル・約660テスト名を「そのテストコードが実際に通る処理フローを日本語に翻訳した文章」に書き換え、mainへマージ済み（PR #235）。

内部名称（planner / job / guard / envelope / staging / record / keep-both / newer-conversion 等）を処理内容へ展開した。

## 規約の正本

テスト名の粒度規約は `.opencode/skills/graphics-workbench-vscode-testing/SKILL.md` の「テスト名の粒度（処理フローの日本語訳）」節を正本とする。新規テスト追加・リネーム時はその規約に従う。

## Verification

- `npm run check:all` pass
- Extension Host suite: 576 passing（1件は既存の環境依存flakyタイムアウトテスト、名前変更と無関係）
- 既知のflaky: `run_external_tool.test.ts` の `timeoutMs 200` テストが本環境で失敗（ロジック未変更、名前のみ変更）

## 進め方（記録）

1. test/のファイルを8バッチに分け、並列エージェントでsuite/test名を書き換え
2. 8並列エージェントで内部名称の監査 → 名前文字列のみ修正
3. typecheck / lint / format / コンテナのExtension Hostテストで検証
