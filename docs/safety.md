# File safety invariants

Graphics Workbenchはユーザーのworkspace内のファイルを読み書きする。以下は実装の細部ではなく、変更時に維持する不変条件である。具体的な検証方法と現在の緩和策は`core/src/security/`と`core/src/operations/lifecycle/`、関連testsを正本とする。

## Workspace and staging

- 入力、出力、staging、backupは論理pathとreal pathの両方で許可されたworkspace境界を検証する。symlink/junctionで境界を抜ける経路を許可しない。
- 変換中のprepared outputとbackupは、最終出力とは分離したstaging領域に置く。正常終了、失敗、キャンセルの各経路で不要なartifactをcleanupする。
- 外部CLIがpath制約を持つ場合も、通常のworkspace stagingと最終commitを迂回せず、必要なscratchだけを別の一時領域へ作る。

## Commit, conflict, and rollback

- 全入力のstagingが成功し、キャンセルされていないことを確認してからcommitする。部分的に成功したbatchを最終出力へ反映しない。
- 既存出力のconflictはcommit layerで解決する。Safe Mode、keep-both、cancel、overwriteの選択をoperationごとの事前存在チェックで置き換えない。
- commit前の既存出力snapshotを使い、外部変更・symlink・file identityを再検証する。overwriteではbackupを保持し、途中失敗時はrollbackする。
- rollbackやUndoは、対象が自分の処理による期待状態か再確認してから変更する。外部変更の疑いがある場合は上書き・削除せず、recovery artifactを保持する。

## Cancellation and Undo

- AbortSignalはplanning、変換、外部CLI、commit境界へ伝播し、キャンセル後に新しい最終出力を確定しない。
- VS Codeの成功した変換はUndo記録と結び付ける。Undo対象のdigest・path・workspace境界を検証し、session historyの範囲を越えて復元しない。
- cleanup失敗は黙って捨てず、再試行に必要な追跡情報を保持する。成功時に不要な通常artifactを残さない。
