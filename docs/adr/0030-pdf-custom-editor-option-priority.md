# ADR-0030: PDF Custom Editorはpriority: "option"にする

## ステータス

採用

## 日付

2026-08-09

## 背景

Graphics Workbench に PDF を表示する Custom Editor を追加する。PDF に対しては LaTeX Workshop などの拡張が既に Custom Editor を `priority: "default"` で提供しており、通常の PDF オープン時にどの editor が優先されるかは extension の登録 priority とユーザー設定で決まる。

Graphics Workbench のインストールだけで既存の PDF Viewer や他拡張の挙動を奪うのは避けたい。特に、LaTeX Workshop の通常の PDF 表示フローを Graphics Workbench が邪魔しないことを重視する。

## 決定

Graphics Workbench の PDF Custom Editor は `priority: "option"` で登録する。

- Graphics Workbench をインストールしただけでは既存の PDF Viewer や他拡張の挙動を奪わない。
- `.pdf` を通常どおり Explorer から開いた場合は、既存のデフォルト Editor とユーザー設定を尊重する。
- `Reopen Editor With...` / `Open With...` では Graphics Workbench を選択肢として表示できる。
- Graphics Workbench で開いた場合は、PDF Preview に加えて Crop など Graphics Workbench 固有の操作を提供する。
- ユーザーが Graphics Workbench を PDF のデフォルト Editor として明示的に設定した場合は、そのユーザーの選択を尊重する。

## 理由

- LaTeX Workshop など `priority: "default"` の PDF Custom Editor が存在する環境で、Graphics Workbench が通常オープンを奪わない。
- PDF 表示は Graphics Workbench の主目的ではなく、既存フローを維持しつつ必要なときに選択できる形が適切。
- priority を `option` にすれば VS Code 標準の Editor Association / `Reopen Editor With...` の仕組みだけでデフォルト選択が制御でき、独自設定を持たずに済む。

## 代替案

### `priority: "default"` で登録する

通常オープンでも Graphics Workbench が使われるが、LaTeX Workshop などの既存 PDF Viewer と競合し、インストールしただけで既存挙動を変えてしまうため採用しない。

### 「他の PDF Viewer がなければ自動的に使う」条件付き priority

他拡張の存在を検出して動的に priority を決める案。他拡張の状態に依存する複雑な挙動になり、VS Code の標準仕組みから逸脱する。今回の実装対象外とし、必要になった場合に改めて検討する。

## 結果・影響

- 意図した挙動:

  ```text
  通常:
  .pdf を開く
  → 既存の PDF Viewer / ユーザー設定を尊重

  必要なとき:
  Reopen Editor With...
  → Graphics Workbench
  → PDF Preview + Crop 等

  ユーザーが明示的に GW をデフォルト指定:
  .pdf を開く
  → Graphics Workbench
  ```

- Graphics Workbench 独自の「PDF Viewer priority」のような設定は追加しない。VS Code 標準の Editor Association / `Reopen Editor With...` に任せる。

## 見直す条件

- Graphics Workbench 固有の操作を PDF の通常オープンから直接提供する必要が生じた場合。
- 「他拡張が PDF Viewer を提供していない環境では自動的に Graphics Workbench を使う」ことを利用者が一貫して求めるようになった場合。
