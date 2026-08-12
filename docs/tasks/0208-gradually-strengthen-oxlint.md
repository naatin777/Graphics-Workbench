# 0208: oxlintの制限を段階的に強化する

Status: On hold — Phase 59（バグ検出ルール群）Done

既存コードを一度に大量修正せず、現在の違反を解消したlint ruleから段階的にerrorへ昇格する。Phaseごとの詳細と完了履歴はGit履歴を参照する。

## Remaining scope

- 次のlint rule群をerrorへ昇格できる状態か、実際の違反・例外・test overrideを再確認する。
- production、Webview、script、testの対象範囲を混同しない。
- 外部API・動的JSON・VS Code/Webview境界では型付けまたはruntime validationを優先する。

## Resume condition

新しいruleを追加する必要が生じ、既存違反を一括修正できる見込みと関連testの検証方法が揃った場合に再開する。lint設定の現在値は`package.json`、`oxlint.config.ts`、関連scriptを正本とする。
