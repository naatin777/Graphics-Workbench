# ADR-0025: Playwright基準画像をローカルで確定してGit管理する

## ステータス

採用

## 日付

2026-08-03

## 背景

ADR-0024で、PRごとのPlaywrightスクリーンショットを`playwright-screenshots-linux` Actions Artifactとして保存し、PRコメントからActions実行ページへのリンクを掲載すると決めた。また、PR title / commit messageの`[update-snapshots]`マーカーによるCI内Linux snapshot再生成と、生成物をPR branchへ自動commitする処理は従来どおり維持した。

この運用は、基準画像を更新するたびに次を往復させる。

1. PR title / commit messageへ`[update-snapshots]`マーカーを入れる
2. CIのLinux jobが`--update-snapshots`でPNGを再生成する
3. 再生成結果をartifactへアップロードする
4. 専用jobがartifactをdownloadしてPR branchへ自動commit / pushする
5. 別jobがPRコメントで7日間保持のartifactを案内する

基準画像はソースコードの一部であり、Gitの履歴で管理できる。ローカルのDocker visual runner（`docker/playwright-visual`）で再生成し、目視確認してから通常のcommitでpushすれば、CIのartifact経由の往復とbot commitを省ける。

## 決定

Playwright基準画像は、ローカルの`docker/playwright-visual`で再生成し、目視確認してからGitへcommit / pushする。CIは基準画像の比較（verify）だけを行い、CI内での再生成・artifact配布・bot commitは行わない。

- `.github/workflows/playwright.yml`から、`[update-snapshots]`検出、`--update-snapshots`実行、成功時のsnapshot artifactアップロード、`commit-snapshots` job、`comment-screenshots` jobを削除する
- Linux PRのpixel比較は引き続き、commit済みの`*-vscode-electron-linux.png` / `*-vscode-electron-narrow-linux.png`を正本としてCIで行う
- 再生成は`docker/playwright-visual/README.md`の「Regenerate snapshots」手順に従い、生成物を目視確認してから通常のソース変更としてcommitする
- 失敗時のreport / trace / actual / diff画像のartifact保存は維持する

## 理由

- 基準画像の更新が「CIを2回往復させてbotにpushさせる」から「ローカルで生成して目視し、git commitで終わる」へ変わる
- GitHubのPR差分で画像diffを直接確認できるため、7日間保持のartifactをダウンロードするよりレビューが単純になる
- PR title / commit messageのマーカー規約、CI内の状態判定、bot commit jobが不要になる
- 基準画像が通常のソース変更と同一のcommit履歴に載るため、どの変更で画像が変わったか追跡しやすい

## 代替案

### CI内の`[update-snapshots]`とartifact配布を維持する

ADR-0024の現状を維持する案。Linux以外の環境で再生成できない開発者には利便性があるが、CIのjob・状態判定・bot commitの維持costが継続する。ローカルのmulti-arch Docker runnerが用意済みで、maintainer自身の環境で再生成できるため採用しない。

### 基準画像をリポジトリから外し、CIが正本を管理する

今回の見直しとは逆の方向。CIに基準画像の永続化を求めることになり、artifactの保持期間・bot commit・配布経路の設計が必要になる。単純さを損なうため採用しない。

## 結果・影響

- `playwright.yml`からsnapshot更新用のjob / stepが消え、workflowが短くなる
- PRコメントのscreenshot artifactリンクは無くなる
- 再生成はLinux rendererを再現できる環境（Docker、またはLinux環境）でのみ行える
- PRレビューは画像差分をGitHub上で直接見る
- ADR-0024は置き換え済みになる

## 見直す条件

- Linux rendererを手元に持てない開発者が継続的に基準画像更新を必要とする場合
- 画像サイズがリポジトリの運用上限を圧迫する場合
- PR差分での画像レビューが困難になった場合

## 関連

- [ADR-0024: PlaywrightスクリーンショットをArtifactで配布する](0024-artifact-only-playwright-screenshots.md)
- [Task 0213: Playwright基準画像の更新をCIからローカルへ移す](../tasks/0213-move-playwright-baseline-updates-locally.md)
- [`docker/playwright-visual/README.md`](../../docker/playwright-visual/README.md)
- [Task 0212: package済みPlaywrightのOS別責務を再配分する](../tasks/0212-rebalance-packaged-playwright-platform-coverage.md)
