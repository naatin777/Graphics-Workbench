# 0208: oxlintの制限を段階的に強化する

Status: In progress — Phase 26 (experiment)

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

## Phase 13

`typescript/strict-void-return`をproductionコードとWebview本体でerrorへ強化する。Webviewのref、イベントハンドラ、setter callbackは値を暗黙に返さないブロック本体へ置き換える。Node.jsの`execFile`は、`promisify`がvoid callbackを要求する一方でNodeのoverloadが`ChildProcess`を返す型定義になっているため、9箇所に理由付きの局所抑制を残す。

## Phase 14

`typescript/no-confusing-void-expression`をproductionコードとWebview本体でerrorへ強化する。イベント登録、Solid callback、キャンセル処理でvoid式をarrow shorthandから返さず、明示的なブロック本体へ統一する。Phase 13の`strict-void-return`と同じく、テストコードは対象外とする。

## Phase 15

`unicorn/no-await-expression-member`をproductionコードでerrorへ強化する。`await`式の直後にmember accessやメソッド呼び出しを連結せず、非同期結果を一度ローカル変数へ受けてから利用する。画像・PDF変換jobの計画結果、PDFページ数、生成物の内容検証を対象とし、テストコードは対象外とする。

## Phase 16

`unicorn/no-useless-undefined`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。省略可能な引数やvoid相当の戻り値へ明示的な`undefined`を渡す箇所を、引数省略または値を返さないブロックへ置き換える。テストコードは対象外とする。

## Phase 17

`unicorn/no-nested-ternary`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。入力候補の選択、形式の正規化、生成物の形式判定、ドラッグ状態の選択を明示的な分岐へ置き換え、条件の優先順位を読み取りやすくする。未型付けのESTree visitor APIを扱う独自Oxlintプラグインは対象外、テストコードも対象外とする。

## Phase 18

`typescript/no-non-null-assertion`をproductionコードとWebview本体でerrorへ強化する。配列要素、Raw sidecarのchannel制約、EPS BoundingBoxの座標を、ループ構造・キー型・明示的な要素検証で保証する。テストコードとNode.js/GitHub Actionsスクリプトは対象外とする。

## Phase 19

`unicorn/no-negated-condition`をproductionコード、Webview本体、Webview build configでerrorへ強化する。`undefined`・`false`との否定比較を、欠落時のfallbackや明示的な分岐の肯定条件へ書き換え、条件の意図を読み取りやすくする。テストコードは対象外とする。

## Phase 20

`unicorn/no-object-as-default-parameter`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。オプションオブジェクトの既定値を関数シグネチャから関数本体のローカル値へ移し、呼び出し時の引数契約と既定値の適用箇所を分離する。テストコードは対象外とする。

## Phase 21

`unicorn/no-array-for-each`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。配列処理を`for...of`へ置き換え、インデックスの利用、途中終了、処理順序を明示的にする。テストコードは対象外とする。

## Phase 22

`typescript/promise-function-async`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。Promiseを返す関数へ`async`を明示し、非同期処理であることを関数宣言から読み取れるようにする。テストコードは対象外とする。

## Phase 23

`typescript/explicit-function-return-type`をproductionコード、Webview本体、Webview build config、Node.js/GitHub Actionsスクリプトでerrorへ強化する。公開関数、変換処理、非同期callbackの戻り値型を明示し、処理の境界で返す値とPromise契約を読み取りやすくする。テストコードは対象外とする。

## Phase 24

`promise/prefer-await-to-then`をproductionコードとWebview本体でerrorへ強化する。Promise chainの`.then()`を`await`と`try/catch`へ置き換え、非同期処理の成功経路と例外経路を同じ制御フローで確認できるようにする。テストコードは対象外とする。

## Phase 25

`typescript/no-floating-promises`をproductionコード、Webview本体、Node.js/GitHub Actionsスクリプトでerrorへ強化する。処理結果を待たずに破棄するPromiseを禁止し、変換・dispose・ファイル操作などの失敗を呼び出し側で扱う契約を維持する。意図的なfire-and-forgetは`void`で明示し、テストコードは対象外とする。

## Phase 26

平坦なTypeScript interface/type literalが10項目以上になった場合に、関連項目をネストできないか検討させる独自ルール`project/max-flat-type-members`を追加する。識別子に共通する語を候補グループとして表示するが、意味的なグルーピングを自動確定したり、固定語彙を前提にしたりしない。

既存コードではOptions型、Webview props、プロトコルpayload、ラベル型、テスト環境型など15件が該当した。各型を実際の責務単位へネストし、候補をすべて解消したため、`project/max-flat-type-members`はerrorとして運用する。

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
- `typescript/strict-void-return` の既存違反は25件で、Node.jsの`execFile`とWebviewのref・イベントハンドラ・setter callbackに分散していた。Phase 13では16件のWebview callbackを明示的なブロックへ置き換え、`execFile`の9件はNodeのoverloadと`promisify`の型定義の不一致を理由に局所抑制する
- `typescript/no-confusing-void-expression` の既存違反は31件で、Webviewのイベント・ref・入力callbackと、extension側のイベント登録・キャンセル処理に分散していた。Phase 14ではvoid式を返すarrow shorthandをすべて明示的なブロックへ置き換える
- `unicorn/no-await-expression-member` の既存違反は18件で、画像・PDF変換jobの計画結果、PDFのページ数、画像buffer、出力内容の検証に分散していた。Phase 15ではawait結果をローカル変数へ受けてからmember accessする形へ置き換える
- `unicorn/no-useless-undefined` の既存違反は12件で、void相当のPromise callback、optionalなQuick Pick結果、Webview API fallback、編集providerの「編集なし」結果、環境変数由来のoptionalなURL、scannerの終了戻り値に分散していた。Phase 16では7件を引数省略または値を返さない戻り方へ置き換え、VS Code provider契約とconsistent-returnのため5件は理由付きの局所抑制を残す
- `unicorn/no-nested-ternary` の既存違反は8件で、入力URI候補の選択、拡張子の正規化、ラスター出力形式の検証、Webviewのdrag and drop、独自OxlintプラグインのAST property判定に分散していた。Phase 17ではproduction・Webviewの7件を明示的な分岐へ置き換え、独自プラグインは未型付けvisitor APIを理由に対象外とする
- `typescript/no-non-null-assertion` の既存違反は12件で、画像結合job・Quick Pick item・Raw sidecar制約・EPS BoundingBoxに分散していた。Phase 18では非null assertionをすべて削除し、配列境界・キー型・座標要素の保証をコード上へ移す
- `unicorn/no-negated-condition` の既存違反は5件で、optionalなcontent hash・PDF job outputPath・LaTeX page fallback・Webview build plugin・PDF preview rootに分散していた。Phase 19では否定比較を肯定条件へ置き換える
- `unicorn/no-object-as-default-parameter` の既存違反は3件で、MermaidのPuppeteer/CLIオプションとDraw.io backendの既定値に限定されていた。Phase 20では既定値を関数本体のローカル値へ移す
- `unicorn/no-array-for-each` の既存違反は3件で、LaTeX複数PDFのsnippet生成とNLS checkerのJSON走査に限定されていた。Phase 21ではインデックス付きの処理と再帰的なJSON走査を`for...of`へ置き換える
- `typescript/promise-function-async` の既存違反は82件で、productionコード、Webview本体、Node.js/GitHub Actionsスクリプトの35ファイルに分散していた。Phase 22ではPromiseを返す関数の宣言へ`async`を追加する。テストコードの107件は対象外とする
- `typescript/explicit-function-return-type` の既存違反は55件で、productionコード、Webview本体、Webview build config、Node.js/GitHub Actionsスクリプトの18ファイルに分散していた。Phase 23では関数・callbackの戻り値型を明示する。テストコードの35件は対象外とする
- `promise/prefer-await-to-then` の既存違反は12件で、PDF変換command、PDF preview、Webviewのエラー処理に分散していた。Phase 24ではPromise chainを`await`と`try/catch`へ置き換える
- `typescript/no-floating-promises` の既存違反は0件だった。Phase 25では未処理Promiseをerrorとして監視し、意図的に待たない処理は`void`で明示する
- `project/max-flat-type-members` は初回に10項目以上の平坦な型を15件検出した。共通語から候補グループを出せる一方、意味的な判断は自動化せず、Options型・props・プロトコルpayload・ラベル型・テスト環境型を責務単位へネストして解消した。Phase 26でerrorへ昇格する
- `suspicious`カテゴリの既存違反は38件で、postMessageのtarget origin、side-effect import、shadowing、error cause、テンプレート式などに分散していた
- `suspicious`カテゴリ全体をerrorにすると、型アサーション、配列sort、importなどの既存違反が多数あるため、Phase 1では有効化しない

## Completion criteria

- Phase 1からPhase 25までの制限をCIの通常lintで強制できる
- Phase 26の構造改善ルールを通常lintでerrorとして強制できる
- 既存の型チェック、format、テスト、buildを壊さない
- 次に強化する候補と既存違反をtaskへ記録する

## Follow-up

次のphaseでは、対象ディレクトリまたはルール単位で残る型安全ルールの既存違反を小さく解消し、段階的にerrorへ移す。違反が多いルールを一括有効化しない。
