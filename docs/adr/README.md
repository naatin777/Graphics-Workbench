# Architecture Decision Records

ADRは、コードだけでは理由を復元しづらく、複数moduleへ継続的に影響する設計判断を記録する。現在の挙動や一覧をADRへ転記しない。

## Add or update

- alternativesと判断理由があり、将来同じ議論が再発し得る場合だけ追加する。
- 実装が変わったら、関連ADRのstatusと影響を更新する。
- obsoleteなmigration、task運用、AI運用、repository housekeepingはGit履歴へ任せ、current treeに残さない。
- 外部仕様や実測結果はresearch、利用者向け挙動は`docs/specs/product/`、安全性の現在形は`docs/safety.md`へ置く。

現在のADRは、workspace file lifecycle、Safe Mode/Undo、conversion command model、外部tool、VS Code test、Node/runtime、VSIX、入力制限、PDF editorなど、将来の境界判断に関係するものだけを含む。
