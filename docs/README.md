# Documentation

このdirectoryは、現在の実装を補う情報だけを役割ごとに置く。コード、型、manifest、tests、scriptsから復元できる一覧はここへ転記しない。

## Current knowledge

- [`specs/product/`](specs/product/): ユーザーから観測できる現在の挙動。
- [`architecture.md`](architecture.md): package間、command、operation、frontendの現在の境界。
- [`safety.md`](safety.md): workspace、staging、commit、rollback、Safe Mode、Undo、cleanup、cancellationの非自明な不変条件。
- [`refactor-backlog.md`](refactor-backlog.md): 将来の判断に値する未着手の改善候補だけ。

## Decisions and evidence

- [`adr/`](adr/): 将来も再検討され得る設計判断と、その理由。
- [`research/`](research/): 現在の実装判断に再利用できる外部仕様・実測結果。

## Work in progress

- [`tasks/`](tasks/): 未完了の作業候補だけ。完了した作業はGit履歴に任せる。

## Maintenance rule

新しい文書は、現在の判断に必要な情報がコード・型・tests・manifest・scriptsから復元できない場合だけ追加する。理由はADR、外部事実はresearch、現在の利用者向け挙動はproduct specへ置き、同じ内容を複数の場所へ写さない。
