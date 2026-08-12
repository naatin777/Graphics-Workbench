# Product Spec

Graphics Workbenchは、VS Code上でPDF、画像、Draw.io、LaTeX挿入に関する作業を扱うextensionである。利用者はExplorer、Command Palette、PDF editor、Webview、drag & drop、clipboardから操作を開始し、変換・PDF編集・コード挿入の結果をworkspaceへ保存できる。

利用者向けの個別挙動は、このdirectoryのtopic specを正本とする。command ID、設定一覧、対応形式の完全な一覧、test runner、build/package手順はmanifest、型、tests、`package.json` scriptsを正本とし、ここでは重複管理しない。

すべてのファイル操作は、失敗やキャンセルでユーザーの既存ファイルを壊さず、複数入力の処理では成功した結果だけを一括して確定する。現在の安全性不変条件は[`docs/safety.md`](../../safety.md)を参照する。
