# Visual Review

このディレクトリの画像は**pixel matchingには使用しない**。Playwrightで同一の画面状態を再現して撮影し、人間が目視で確認するための参照画像として使用する。OS・ブラウザ・フォント・描画倍率の差によるノイズを排除するため、ピクセル単位の自動比較は行わない。

## 責務の分離

| 領域                                               | 責務                                    | Git管理 |
| -------------------------------------------------- | --------------------------------------- | ------- |
| E2Eテスト（`vscode/extension/test/e2e/electron/`） | DOM・操作・状態遷移・処理結果を自動検証 | する    |
| capture spec（`visual_review_capture.spec.ts`）    | 目視確認用の画面状態を再現して撮影      | する    |
| generated画像（`artifacts/visual-review/`）        | 今回の実行で生成した未確認画像          | しない  |
| reference画像（`references/`）                     | 人間が確認して採用した参照画像          | する    |
| Playwright report / test-results                   | レポート・trace・失敗時画像             | しない  |

## Workflow

1. `npm run package:vsix` でVSIXを生成する（`graphics-workbench.vsix`）
2. `npm run visual:capture` を実行する
   - 出力先: `artifacts/visual-review/<platform>-<arch>/<viewport>/<screen>-<state>.png`
   - viewportは `wide`（1280×900）と `narrow`（600×900）
   - 対象: crop / merge / split のConfigure画面をdark / light / high-contrast / high-contrast-light / red / abyssテーマで、wideとnarrowの両方を撮影
3. 生成された画像を確認する
4. 意図した変更であることを確認する
5. 必要な場合のみreference画像を更新する
6. コード変更と画像変更を一緒にレビューする

撮影は画面ごとにElectronを1回起動し、その同一セッション内でテーマを切り替え、wide撮影後にウィンドウをnarrowへリサイズして再び全テーマを撮影する。テーマごとの再起動は行わない。撮影前には出力ディレクトリを初期化するため、今回撮影しなかった古い画像は成果物へ混入しない。

`visual:capture` は通常のE2Eコマンド（`npm run test:playwright:vsix`）とは分離しており、E2Eの合否には影響しない。撮影に失敗した場合はエラーと出力先パスが表示される。

## 出力ディレクトリ構成

```text
artifacts/
└── visual-review/
    └── <platform>-<arch>/
        ├── wide/
        │   ├── crop-configure-dark.png
        │   ├── crop-configure-light.png
        │   ├── merge-configure-dark.png
        │   ├── merge-configure-light.png
        │   ├── split-configure-dark.png
        │   ├── split-configure-light.png
        │   ├── pdf-preview-dark.png
        │   ├── pdf-preview-light.png
        │   ├── tiff-preview-dark.png
        │   └── tiff-preview-light.png
        └── narrow/
            ├── crop-configure-dark.png
            ├── crop-configure-light.png
            ├── merge-configure-dark.png
            ├── merge-configure-light.png
            ├── split-configure-dark.png
            ├── split-configure-light.png
            ├── pdf-preview-dark.png
            ├── pdf-preview-light.png
            ├── tiff-preview-dark.png
            └── tiff-preview-light.png
```

全テーマ（dark / light / high-contrast / high-contrast-light / red / abyss）について、wideとnarrowが同じ命名規則で生成される。Configure画面（crop / merge / split）は全テーマ、Custom Editor preview（pdf / tiff）はdark / lightの2テーマで撮影する。previewは`workbench.editorAssociations`でCustom Editorをデフォルト指定した状態でファイルを開いて撮影する。

## generated画像とreference画像

- `artifacts/visual-review/` は実行ごとに生成される未確認画像で、Git管理しない
- `references/` は人間が確認して「この見た目が正しい」と採用した画像で、Git管理する
- reference画像を採用する場合は、`artifacts/visual-review/<platform>-<arch>/<viewport>/` から `references/<platform>-<arch>/<viewport>/` へコピーし、コード変更と一緒にcommitする

## reference画像を更新する条件

- UIのレイアウト・配色・コンポーネントを意図的に変更した
- 生成画像を目視確認し、変更後の見た目が正しいと確認できた
- 不要になったreference画像は同じPRで削除する

環境差（フォント、DPI、OS描画）による細かな違いだけの場合は更新しない。

## 現在の標準確認環境

開発者がローカルのOS・CPUで生成した環境を正本とする。出力先ディレクトリが`<platform>-<arch>`で分かれるため、OS・CPUごとに別々のreferenceを管理できる。Linux環境の固定再現用Docker runnerは廃止し、追加しない。

## レビュー方針

UIを変更するPRでは、コード差分と一緒にreference画像の差分もレビューする。GitHubのPR画像差分で確認できるよう、採用したreference画像はコード変更と同じcommitに含める。
