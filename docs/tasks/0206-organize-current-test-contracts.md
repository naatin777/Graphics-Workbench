# 0206: 現行テスト契約を整理する

## Status

Done — 2026-07-28

## Objective

正解画像・正解PDFを導入する前に、現在のテストを仕様上の責務と実行レイヤーに合わせて整理し、未着手の内容oracleを明確にする。

## Scope

- pureな形式判定テストを適切なapplication testへ集約する
- `docs/test-matrix.md`の現行ファイル数、パス、runtime、既知gapを同期する
- 正解画像・正解PDFを使った内容比較は追加しない
- 既存の変換仕様、出力path、安全性、cancel、Undoの挙動は変更しない

## Completion conditions

- [x] `.eps`形式判定が`source_format.test.ts`で確認できる
- [x] 形式判定だけを目的とする重複ファイルが残っていない
- [x] test matrixのパスと実行結果が現行構成と一致する
- [x] 正解fixtureを必要とするcontent oracleを後続作業として区別できる
- [x] 関係するcheck、build、Extension Host test、Webview testが成功する

## Deferred

- 正解画像・正解PDFの作成
- fixtureのライセンス、特徴、比較許容値の決定
- 各変換形式のpixel/content oracle強化
- packaged VSIXの追加public journey
