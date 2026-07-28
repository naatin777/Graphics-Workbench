# 0208: oxlintの制限を段階的に強化する

Status: In progress — Phase 12

## Objective

既存コードを一度に大量修正せず、oxlintの制限を段階的に強化する。各段階で現在の違反を基準化し、新しい違反だけを止められる状態を作る。

## Scope

- 警告で運用している既存ルールのうち、現行違反がないものをerrorへ昇格する
- 未使用のlint抑制コメントをerrorとして検出する
- `suspicious`カテゴリ全体や、現行違反が多い型安全ルールは後続phaseで扱う

## Phase 1

次の制限をerrorへ強化する。

- `eqeqeq`
- `no-console`
- `typescript/consistent-type-imports`
- `reportUnusedDisableDirectives`

`test`、設定ファイル、ビルド用スクリプトなど既存の明示的な例外は維持する。

Phase 1はPR #16でmainへ反映済み。

## Phase 2

`unicorn/no-array-sort`をerrorへ強化する。既存の11箇所はNode.js 22で利用できる`toSorted()`へ置き換え、配列の破壊的変更を避ける。

## Phase 3

`typescript/no-unnecessary-type-assertion`をerrorへ強化する。既存の78箇所から不要な非nullアサーションと型アサーションを削除し、型がすでに保証されている箇所での重複した保証をなくす。

## Phase 4

`typescript/no-unsafe-argument`をerrorへ強化する。既存の27箇所でanyのまま関数や外部APIへ渡していた値に型注釈または実行時検証を追加し、型安全な引数だけを渡す。

## Phase 5

`typescript/no-unsafe-type-assertion`をerrorへ強化する。既存の59箇所を、JSON/XML/API境界の実行時検証、テンプレートsuffixの型ガード、型付きのVS Codeテストダブルへ置き換える。

Mermaid CLIのthemeだけは、無効値をCLIへ渡してCLI自身に検証させる既存仕様と、依存パッケージの狭いtheme型が一致しないため、理由を明記した行単位の抑制を残す。

## Phase 6

`suspicious`カテゴリをerrorへ強化する。既存の38件は、Webviewのメッセージ送信、side-effect import、変数shadowing、catchしたエラーのcause、テスト内の曖昧な構文を修正する。

VS Codeの`Webview.postMessage`はブラウザの`window.postMessage`と異なりtarget origin引数を受け取らないため、3箇所は理由を付けた行単位の抑制を残す。Webview側のVS Code APIラッパーは`sendMessage`と命名して、ブラウザのtarget origin検査と混同しないようにする。CSS、Map polyfill、PDF.js workerのside-effect importは、対象を限定したallow設定で維持する。

## Phase 7

`typescript/no-unsafe-return`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。対象範囲の既存9件は、NLS placeholderの戻り値、coverage reportのJSDoc型、ソート結果の型を明示して解消する。

テストコードはVitest/Solidの型定義とテスト用JSON helperに起因する13件を残し、既存のtest overrideで対象外にする。`toSorted()`の戻り値に対するJavaScript/JSDoc型推論の誤検知だけは、coverage report内の4箇所で理由付きの行単位抑制を残す。

## Phase 8

`typescript/prefer-nullish-coalescing`をerrorへ強化する。既存の7件はlocale、ページ範囲、LaTeXテンプレート、Webviewのdrag and drop、coverage report、テスト設定のfallbackを、空文字の意味を維持した明示的な条件または`??`へ置き換える。

## Phase 9

`typescript/no-unsafe-assignment`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。動的JSONとプロパティ境界は`unknown`と実行時検証へ寄せ、coverage reportとNLS checkerの`toSorted()`は理由付きの共通ヘルパーへ集約する。

独自Oxlintプラグインは、未型付けのESTree visitor APIからASTを受け取るため、このルールをファイル単位で対象外にする。テストコードも既存のtest overrideで対象外にする。

## Phase 10

`typescript/no-unnecessary-condition`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。必須フィールドのfallbackを削除し、非同期で変化するcancel/dispose状態は型チェッカーが追跡できる状態オブジェクトまたは理由付きの局所抑制で表現する。

Phase 9の動的境界は小さな`unknown`型ガードで十分なため、今回のLint強化のために`zod`は導入しない。既存の例外ベースの処理を`neverthrow`へ置き換える必要もない。入力境界が増えた場合に、別taskとして再評価する。

## Phase 11

`unicorn/prefer-string-replace-all`をerrorへ強化する。グローバル正規表現を使う置換を`replaceAll()`へ統一し、複数回の置換が必要なXMLエスケープやLaTeX文字列処理の意図を明確にする。

## Phase 12

`typescript/strict-boolean-expressions`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。nullableな文字列・数値・booleanのtruthiness判定を、空文字・ゼロ・nullishの意味を保った明示条件へ置き換える。テストコードと、未型付けのESTree visitor APIを扱う独自Oxlintプラグインは対象外とする。

## Baseline

- `npm run lint` は変更前に成功
- `eqeqeq`、`no-console`、`typescript/consistent-type-imports` をerrorとして試行しても既存違反なし
- `unicorn/no-array-sort` の既存違反は11件で、スクリプトとテストに限定されていた
- `typescript/no-unnecessary-type-assertion` の既存違反は78件で、主にテストコードの不要な非nullアサーションだった
- `typescript/no-unsafe-argument` の既存違反は27件で、型注釈のないNode.jsスクリプト、外部API境界、テストstubに分散していた
- `typescript/no-unsafe-type-assertion` の既存違反は59件で、JSON/XML解析結果、出力拡張子、VS Code APIのテストダブル、動的importに分散していた
- `typescript/no-unsafe-return` の既存違反は22件で、productionコード・自動化スクリプトに9件、Vitest/Solidとテストhelperに13件あった。Phase 7では前者だけをerror化し、後者はtest overrideで保留する
- `typescript/prefer-nullish-coalescing` の既存違反は7件で、値が未設定の場合のfallbackと、空文字を意味のある値として扱う処理が混在していた
- `typescript/no-unsafe-assignment` の既存違反は62件で、production・自動化コードに24件、独自Oxlintプラグインに7件、テストコードに31件あった。Phase 9ではproduction・自動化コードの24件だけを解消し、残りは境界の制約を理由付きで保留する
- `typescript/no-unnecessary-condition` の既存違反は35件で、production・自動化コードに18件、テストコードに17件あった。Phase 10では18件を解消し、非同期dispose判定の1件だけ理由付き抑制を残す
- `unicorn/prefer-string-replace-all` の既存違反は16件で、出力名の安全化、LaTeX/XML/HTMLエスケープ、テンプレート展開、テストhelperに分散していた
- `typescript/strict-boolean-expressions` の既存違反は72件で、productionコード、Webview本体、Node.js/GitHub Actionsスクリプトに分散していた。Phase 12では、nullableな文字列・数値・booleanを暗黙にtruthiness判定していた箇所を明示条件へ置き換え、テストコードと独自Oxlintプラグインは対象外にする
- `suspicious`カテゴリの既存違反は38件で、postMessageのtarget origin、side-effect import、shadowing、error cause、テンプレート式などに分散していた
- `suspicious`カテゴリ全体をerrorにすると、型アサーション、配列sort、importなどの既存違反が多数あるため、Phase 1では有効化しない

## Completion criteria

- Phase 1からPhase 12までの制限をCIの通常lintで強制できる
- 既存の型チェック、format、テスト、buildを壊さない
- 次に強化する候補と既存違反をtaskへ記録する

## Follow-up

次のphaseでは、対象ディレクトリまたはルール単位で残る型安全ルールの既存違反を小さく解消し、段階的にerrorへ移す。違反が多いルールを一括有効化しない。
