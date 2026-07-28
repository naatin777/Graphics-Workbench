# 0207: パッケージ済みPlaywrightテストの実行時間を短縮する

Status: In progress — 2026-07-28

## Objective

パッケージ済みElectron Playwrightテストで、Windows上の繰り返しVSIX展開・削除による待ち時間を減らす。

## Scope

- VS Code実行ファイルとインストール済みVSIXをspec単位で共有する
- 各テストのworkspace、user-data、shared-data、Electronプロセスは分離したまま維持する
- テストの検証内容とパッケージの実行対象は変更しない

正解画像・正解PDFの内容比較を追加する作業、およびElectronテストの全面置換は対象外とする。

## Completion checks

- [x] VSIXインストールをspec開始時の1回に集約する
- [x] 各テストの一時workspaceとuser-dataを個別に作成・削除する
- [x] 既存の8件のパッケージ済みElectronテストがローカルで成功する
- [x] typecheck、check、buildが成功する
- [ ] Windows CIで速度と安定性を確認する

## Follow-up

- Windows CIで改善幅を確認する
- 必要なら、テストごとのElectron起動・終了もスイート単位へ集約できるか、分離条件を再確認して判断する
