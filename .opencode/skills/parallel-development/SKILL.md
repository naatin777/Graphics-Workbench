---
name: parallel-development
description: >-
  複数の独立タスクを最大3つのworkstream（1 independent workstream = 1 worktree = 1 Graphite
  stack）で並列に進める。Graphite stackの構成、worktreeの作成・切替、CI/Auto-merge待ちで
  次のREADY taskへ移る非同期待機、CI failure時の元worktree復帰、merge後のcleanup、
  不要なrestack削減を含む開発作業で使用する。gt操作・stacked PR・CI待ち・PR/Auto-merge待ち
  でAgentが停止しない運用に適応する。Graphite CLIの詳細操作はgraphite-stacked-prに従う。
---

# 並列開発ワークフロー

## 目的

- AgentがCI / Auto-merge / Graphite restack待ちで**停止しない**。
- 不要なrestack・force push・CI再実行を減らす。
- **1 independent workstream = 1 worktree = 1 Graphite stack**（main起点）。

## 原則

1. Graphite stackは「実装した順番」ではなく**コード上の依存関係だけ**を表す。
2. 独立タスクは別worktree / 別stackにする：`main → A`、`main → B`、`main → C`。
   BがAに本当に依存するときだけ `main → A → B` とstackする。
3. 同時に進める独立workstreamは**最大3つ**。
4. CI / Auto-mergeを同期的にwatchして待たない。安全なREADY taskがあれば別worktreeへ移る。
5. Graphite管理branchのhistoryはGraphiteに任せる。Actions側でrebase / force push /
   `gh pr update-branch` する擬似Merge Queueを作らない。
6. 不要な`gt sync` / restackも避け、必要な場合だけ最小範囲で行う。

## 開始前チェック

```bash
git status --short
git branch --show-current
git worktree list
gt log short
scripts/worktree-status.sh   # このskill配下のスクリプト
```

- trunk（`gt trunk`）と現在branch・parent・全worktreeのcheckout状態を確認する。
- 未コミット変更、staged、untrackedを確認する。

## 独立workstreamの判定

- A/B/Cが互いに依存しなければ独立 → それぞれ別worktree / 別stack。
- 本当に依存する場合だけstackし、**依存理由を1文で明示**する。
- 依存・競合リスクが高いタスクは無理に並列化しない。

## 新規workstream作成

trunk（`main`）上で実施:

```bash
git worktree add -b <branch> <path> <main>   # 独立branchを新worktreeでcheckout
cd <path>
gt track <branch> --parent main              # Graphiteに登録（親=main）
# 実装 → ローカル検証 → コミット
gt submit --no-edit                          # PR作成（必要なら --draft）
```

- `gt create --onto main <branch> -m "<msg>"`（既存branchへstack、他のworktreeから）も可。
- **1つのbranchに`gt create`を2回呼ばない**。`gt create`はbranch作成+コミット一体。
- 独立タスクを現在のbranchへ`gt create`で積み重ねない（不要な縦stackの原因）。

## Graphite stackの使い分け

- 新規独立タスク: 上記workflow（親=main）。
- 依存タスク: 親branch上で `gt create <child> -m "<msg>"`。
- stack深さは2〜5が目安。超えそうなら独立PRをtrunkへ分離する。
- stackは下から上へ: 準備/refactor → 基盤 → 本変更 → 呼び出し移行 → 後始末。

## 最大3並列

- 同時進行workstreamは最大3。3つ埋まっているときは、merge済みcleanupか
  CI failureのfixが先。
- 各worktreeのbranchはGraphiteが同時checkoutを禁止するため、同一branchの二重checkoutはない。

## CI / merge待ち

- PR → CI / Auto-mergeを同期的にwatchしない。1回status取得で足りる。
- 待つべき理由（merge直前 / required check / failure調査 / ユーザー明示）以外は次のREADY taskへ。
- 実装が完了していれば `ローカル検証完了 / リモートCI pending` と報告し、停止しない。
- `gh pr checks --watch` の常時watchはしない。

## CI failure時

1. `gh pr checks <PR>` で1回status取得。
2. 失敗PRのworktreeへ戻り修正 → `gt modify -a` → `gt submit --no-edit`。
3. 下流のrestackが必要なら最小範囲で: `gt restack --only` / `--downstack` / `--upstack`。

## merge後のcleanup

- mergeはGraphiteネイティブ `gt merge`（`--dry-run`確認必須）。GitHub Merge button / `gh pr merge`は
  stacked PRでbase branch削除を誘発するため使わない。
- Auto-merge完了後:

```bash
gt sync                                  # merged branch削除 + trunk更新
npm run check:prs-landed -- <PR番号...>  # 実際にmainへlandingしたか確認
git worktree remove <path>               # 空になったworktreeを削除
cd <メインworktree> && git worktree prune
```

## 禁止事項

- GitHub Merge button / `gh pr merge`（stacked PR）。
- `gh pr update-branch` / `git rebase main` / force pushの機械的実行。
- CI failure調査なしの連打`gt sync` / restack。
- 今回のためだけに既存の深いstackを書き換える。

## 詳細

- Graphite CLIの詳細は `../graphite-stacked-pr/SKILL.md` に従う。
- 詳細なlifecycle手順は `references/workstream-lifecycle.md`。
- 状態確認は `scripts/worktree-status.sh`（読み取り専用）。
