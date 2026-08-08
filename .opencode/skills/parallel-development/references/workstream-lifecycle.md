# workstream lifecycle 詳細手順

`1 independent workstream = 1 worktree = 1 Graphite stack`。stackはコード依存のみを表す。

## 開始: 新規独立workstream

trunk（`main`）を親とする独立branchを、専用worktreeで開始する。

```bash
# メインworktree（trunk上）から
git worktree add -b <branch> <path> <main>
cd <path>
gt track <branch> --parent main
```

`gt track`はGraphiteメタデータに`<branch>`を登録し親を`main`にする。
Graphiteはbranchのgit履歴から親を推測できるが、`--parent`を明示して誤推測を防ぐ。

以後の作業（実装・ローカル検証・コミット）はすべてこのworktree内で行う。

### 他worktreeからtrunkへ積む場合

他のworktreeに居ながらtrunk上のbranchを作る:

```bash
gt create <branch> -m "<msg>" --onto main
```

`gt create`は「branch作成＋staged変更のコミット」を一体で行う。
変更がまだ無い状態で`gt create <name>`すると**空branch**になるため、
新しいタスク開始では`git worktree add -b` + `gt track`を推奨する。

## コミットとPR作成

```bash
gt add <paths>          # 対象だけstage（gt addはGraphiteが認識）
gt commit               # または git commit
# ローカル検証（このrepoのgraphics-workbench-verifyに従う）
gt submit --no-edit     # PR作成。必要なら --draft
```

`gt submit`はリモートへforce pushするため、必ずユーザー承認を得る。

## 依存タスクを積む場合

本当の依存があるときだけ:

```bash
gt checkout <親branch>   # 親worktree内、または gt branch checkout
gt create <child> -m "<msg>"
```

## CI / Auto-merge待ち

PRのCIとAuto-mergeは同期的に待たない。

- `gh pr checks <PR>` で1回statusを確認。
- pendingなら次のREADY taskのworkstreamへ移動して実装を続ける。
- 待つのは「merge直前」「required check」「failure調査」「ユーザー明示」だけ。

## CI failure時の復帰

```bash
# 失敗PRのworktreeへ
cd <該当worktree>
gh pr checks <PR>
# 修正
gt modify -a
gt submit --no-edit
# 下流のrestackが必要なら最小範囲で
gt restack --only            # 現在branchのみ
gt restack --downstack       # 自分と祖先
gt restack --upstack         # 自分と子孫
```

## merge後のcleanup

Graphiteネイティブの`gt merge`を使う:

```bash
gt merge --dry-run     # 対象PRを確認
gt merge --confirm     # ユーザー承認後に実行
gt sync                # merged branch削除 + trunk更新 + 残存stackのrestack
npm run check:prs-landed -- <PR番号...>
git worktree remove <path>   # 空になったworktreeを削除
git worktree prune
```

`gt sync`はGraphiteがmerged branchを削除しtrunkを更新する。手動で`git branch -D`しない。

## 注意

- 既存の深いstackは今回のためだけに書き換えない。問題があれば改善案だけ報告する。
- Graphite CLIの詳細・recovery・submit/merge手順は
  `../graphite-stacked-pr/SKILL.md` とその`references/`を参照。
