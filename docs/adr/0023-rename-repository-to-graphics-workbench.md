# ADR-0023: repositoryとextension identityをGraphics Workbenchへ変更する

## ステータス

採用

## 日付

2026-07-29

## 背景

このrepositoryは未リリースで、旧repositoryの既存利用者や公開extensionを引き継がない新しいrepositoryとして運用する。したがって、repository名だけでなく、VS Code extensionのidentity、command ID、user setting key、Marketplace / Open VSXの識別子、workspace staging rootも新名称へ揃える。

## 決定

- repository、製品表示、extension manifestのnameは`Graphics Workbench` / `graphics-workbench`を正本にする。
- command ID、user setting key、menu namespace、Marketplace / Open VSXのextension identifierは`graphics-workbench`へ変更する。
- workspace staging root、CIの環境変数、VSIX成果物名、内部のprotocol aliasとtest用一時directoryも新namespaceへ変更する。
- 旧namespaceのalias、setting fallback、command registration、staging path fallbackは追加しない。
- 既存利用者からの移行は、このrepositoryの責務に含めない。

## 理由

- 新repositoryを旧extensionの互換版ではなく、独立した新しい配布物として扱える。
- source、manifest、設定、test、CI、ドキュメントのnamespaceが一致し、検索時に旧名称が混在しない。
- 旧staging領域を読み取る互換処理を持たないため、Safe Mode、Undo、cleanupのpath契約を新repository内で単純に保てる。

## 代替案

### 旧namespaceを残し、表示名とrepository URLだけを変更する

旧extension identityと新repositoryのidentityが混在し、今回の独立した配布物という目的を満たさないため採用しない。

### 旧namespaceから新namespaceへのalias / fallbackを追加する

未リリースの新repositoryに旧利用者向けの移行コードと削除期限を持ち込むことになり、独立した配布物としての境界を曖昧にするため採用しない。

## 結果・影響

- 旧extensionの設定、command、staging artifact、Marketplace / Open VSX identityは自動移行されない。
- package manifest、source、test、CI、ドキュメントのnamespaceは新名称へ統一される。
- 旧repositoryからの移行を別途行う場合は、旧repository側で案内を提供する。

## 見直す条件

- 旧extensionを利用しているユーザーを新repositoryの配布対象に含めると決めたとき
- 旧設定やstaging artifactの移行要件が明示され、対応期限と削除条件を決められたとき

## 関連

- [`docs/architecture.md`](../architecture.md)
- [`docs/specs/product/output-format-conversion.md`](../specs/product/output-format-conversion.md)
