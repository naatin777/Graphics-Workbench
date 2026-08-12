# ADR-0011: プロジェクト成果物ごとの言語を決める

## ステータス

採用

## 日付

2026-07-01

## 決定

- `docs/`、ADR、research、未完了task、`AGENTS.md`は日本語を基本とする。
- 公開向けREADME、CHANGELOG、PR title、commit message、branch名、CI名、コード識別子、設定keyは英語を基本とする。
- `README.ja.md`は日本語版、`README.md`は公開向け英語版とする。
- VS Codeの既定localeは英語、日本語localeは日本語とする。
- PR bodyは英語を基本とし、複雑な判断には日本語を併記してよい。

## 理由

仕様と判断はメンテナが正確に記録できることを優先し、公開履歴・API識別子・CI表示は外部ツールと公開環境で扱いやすい英語に揃える。成果物ごとの境界を固定することで、毎回言語を判断する必要をなくす。

## 見直す条件

外部コントリビューターの継続参加、公開成果物の要件、またはVS Codeのlocale運用が変わった場合に見直す。

## 関連

- [ADRの運用方針](README.md)
- [AI向け作業ルール](../../AGENTS.md)
- [README.ja.md](../../README.ja.md)
- [README.md](../../README.md)
