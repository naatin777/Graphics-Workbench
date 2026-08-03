# ADR 0024: PlaywrightスクリーンショットをArtifactで配布する

- Status: 置き換え済み（[ADR-0025: Playwright基準画像をローカルで確定してGit管理する](0025-commit-playwright-baselines-from-local-docker.md)で置き換え）
- Date: 2026-08-03

## Context

PRごとのPlaywrightスクリーンショットを画像URLとして表示するために、Actions実行ごとに専用の`ci-screenshots-*`ブランチを作成していた。この方式はPRコメントの画像参照を維持できる一方、実行のたびにリモートブランチが増え、通常のソースブランチと区別しにくい。

## Decision

スクリーンショットは既存の`playwright-screenshots-linux` Actions Artifactとして保存する。Artifactの保持期間は7日間とする。PRには固定マーカー付きのコメントを1件だけ作成または更新し、Actions実行ページへのリンクとArtifact名を掲載する。

スクリーンショットのためのコミット、ブランチ作成、ref pushは行わない。`[update-snapshots]`によるLinux snapshotの更新コミット処理は、ソースコード上のsnapshotを更新する目的があるため従来どおり維持する。

## Consequences

- 新しいPlaywright実行で`ci-screenshots-*`ブランチが増えない。
- 画像の確認にはActions実行ページからArtifactをダウンロードする必要がある。
- PRコメントは画像一覧ではなくArtifactへの導線になる。
- `playwright` jobが失敗した場合も、取得できたArtifactへの導線を投稿できるようにコメントjobは`always()`で評価する。
- 既存コメントや過去の検証結果を壊さないため、既存の`ci-screenshots-*`ブランチはこの変更では削除しない。
