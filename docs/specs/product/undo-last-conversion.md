# 直前の変換を安全に取り消す仕様

## ユーザー操作

変換成功後の通知に「取り消す」を表示する。選択すると専用command `graphics-workbench.undoLastConversion`を実行する。通常の`Ctrl+Z` / `Cmd+Z`は変更しない。

古い通知から取り消しを選んだ時点で、より新しい変換が成功している場合は何も削除しない。

## 取り消し前の安全確認

取り消し対象のすべての出力について、存在、workspace境界、生成直後からの変更有無を確認する。1件でも確認に失敗した場合は、どの出力も削除・復元しない。

## 結果

- 新規作成した出力は削除する。
- 「両方残す」で作成した出力は削除する。
- 上書きした出力は、生成後に変更されていない場合だけ元の内容へ復元する。
- 取り消し後は対象の取り消し記録を破棄し、同じセッション中は一つ前の変換を取り消せる。
- cleanupに失敗しても、出力の取り消し結果は成功として扱う。ただし失敗は通知またはOutputへ記録する。

## 履歴の範囲

- 取り消し履歴はextensionのセッション中だけ保持する。
- 履歴は最大10件まで保持し、作成時刻から24時間を超えたrecordは保持しない。上限またはretention期限を超えたrecordは、参照していたstaged backupごと破棄する。
- extension restart後の履歴復元は行わない。Undo操作自体はrestart後には復元されない。
- `workspaceState`のmanifest（`graphics-workbench.undoHistory`）はUndoの復元用ではなく、前回セッションから残ったstaged backupの孤立掃除用に保持する。manifestにはセッション内のrecord（最大10件・24時間以内）だけを書き、次回activation時にretention期限を過ぎたentryのbackupを掃除してentryを削除する。
- cleanup失敗時は出力の取り消し結果は成功として扱う。ただし失敗は通知またはOutputへ記録する。

## 対象外

- VS Code再起動後の取消
- 通常Undoへのkeybinding追加
