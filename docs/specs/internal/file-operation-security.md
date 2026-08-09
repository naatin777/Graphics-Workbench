# ファイル操作のworkspace境界仕様

## 原則

`execPath` と、下記で明示する機密PDF用OS一時領域を除き、拡張機能が読み書きするファイルとディレクトリは、対象workspaceの実体内に存在しなければならない。

workspace外を対象とする操作は、読み取り・書き込みともエラーにする。

例外として、[外部コマンド用ASCII scratch仕様](external-tool-ascii-scratch.md)で定義したWindowsのtool scratchと、機密PDFの専用stagingだけは、検証済みOS一時directory内の読み書きを許可する。この例外をユーザー入力pathや論理出力へ広げない。

## パス判定

文字列のprefix比較だけでは判定しない。

以下の両方を確認する。

1. `path.resolve` した論理パスがworkspaceの論理パス内にある
2. `realpath` で解決した既存部分の実体がworkspaceの実体内にある

workspace直下そのものはworkspace内として扱う。

兄弟ディレクトリ、共通prefixを持つ別ディレクトリ、`..` でworkspace外へ出るパスは拒否する。

## 読み取り

読み取り対象は存在している必要がある。

対象とworkspaceを `realpath` で解決し、対象の実体がworkspaceの実体内にある場合だけ許可する。

workspace内に置かれたsymlinkがworkspace外を指す場合は拒否する。

## 書き込み

書き込み対象が存在する場合は、その実体を `realpath` で検証する。

書き込み対象が未作成の場合は、最も近い既存の親ディレクトリを探し、その実体がworkspaceの実体内にあることを検証する。

workspace内に置かれたsymlinkディレクトリを経由してworkspace外へ書き込む場合は拒否する。

## workspaceがsymlinkの場合

workspace自体がsymlinkでもよい。

workspaceの `realpath` を境界として使用し、その実体内の読み書きを許可する。

## execPath

Ghostscriptなどの `execPath` はworkspace外を許可する。

`execPath` はファイル入出力パスの境界検証へ渡さない。

## OS一時scratch

OS一時scratchはworkspace境界とは別の専用境界として扱う。

- scratch baseをユーザー設定から受け取らない
- `mkdtemp`で作成した専用rootだけを使用する
- scratch root内の論理pathと実体pathを検証する
- scratch root外とsymlink経由の操作を拒否する
- workspaceとのfile移動はNode.js `copyFile`で行う
- 外部コマンドへworkspace pathを直接渡さない
- scratchからユーザー指定outputPathへ直接書き込まない

## 機密PDF用OS一時staging

暗号化・復号のqpdf処理では、平文になり得る入力copyと完成artifactをworkspaceへ置かない。

- `mkdtemp`で作成した専用rootを使用し、POSIXではroot `0700`、file `0600`を設定する。WindowsではユーザーのOS一時directoryから継承したACLを使用する。
- staging rootにPID、開始時刻、operationを記録したmanifestを置く。
- qpdfへ渡す秘密情報はjob-json fileへ書き、process argvにはpasswordを含めない。job-json fileはqpdf実行後に必ず削除する。
- `PreparedConversionOutput.stagingWorkspacePath`でworkspace境界と専用staging境界を分離する。
- success時にUndoが参照するrootだけを保持し、failure・cancel・Undo後はrootを削除する。
- activation時は現ユーザー所有のdirectoryだけを対象に、manifestのPIDが不在で、かつ24時間を超えた専用rootだけを削除する。symlink、現役PIDのroot、manifestを書き込む途中の新しいrootは削除しない。workspace全体や未知のtemporary directoryは走査しない。

## 競合

Node.jsの標準ファイルAPIにはportableな`openat`やconditional renameがないため、最終検証と`open` / `rename`の間にある極小のTOCTOUを完全なCASとして排除することはできない。

長いhash / copy区間の後にpathとfile identityを再検証し、owned handleから書き込むことで、重要な書き込みまでの競合窓を実用上可能な限り短くする。厳密な排他保証が必要になった場合は、OS固有primitiveの導入を別途判断する。

出力pathの重複判定は、OS名を固定条件にせず出力先の実体directoryへcase probeを行う。case-insensitive volumeでは小文字化し、すべてのvolumeではUnicodeをNFCへ正規化してから、同一batch内のrequested path、Keep Bothの予約path、available suffixを比較する。

## commitとrollback

最終出力へ反映する経路は、stagingから`commitConversionOutputs`を通る。

- overwrite対象はconflict表示前のSHA-256をstreamingで記録し、判断中に変更された場合は上書きしない。
- overwrite前のbackup作成後にcopyが失敗した場合は、現在処理中の出力を含めてbackupから復元する。
- 新規出力はexclusive placeholderで拡張機能が作成したfile identityを記録する。copy失敗時に別プロセスが置き換えたpathは削除しない。
- 既に成功した出力と現在処理中の出力をrollback対象にする。
- rollbackの各失敗は元のcommit errorと別に保持し、対象pathとともにOutput Channelへ記録する。
- rollback失敗に関連するbackupは、手動確認のためcleanup対象から保護する。
- rollbackが全件成功した場合だけ、commit errorを通常の失敗として返す。

大きなPDF・画像の比較は、全内容を`readFile`で同時にメモリへ載せず、file size確認後にNode.js streamからSHA-256を計算する。

## 起動時cleanup

v1ではsession ownershipを証明できないため、拡張機能起動時に`.graphics-workbench`全体を削除しない。別windowのactive staging、Undo backup、未知のdirectory、harness log、symlink先を残す。

通常のsuccess/failure/cancellation/Undoに伴うcleanupは、artifact lifecycleで明示された今回のoperation rootに限って実行する。機密PDF用の専用rootだけはmanifestとPIDを使って次回起動時に孤立判定し、孤立したrootを削除する。
