# 0208: oxlintの制限を段階的に強化する

Status: In progress — Phase 43（0違反の型安全・正確性ルール群）Done

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

## Phase 27

関数の循環的複雑度を20以下に制限する`complexity`をerrorへ強化する。対象はproduction codeとWebview本体とし、テストコードはテストデータの検証関数を理由に対象外、未型付けのESTree visitor APIを扱う独自Oxlintプラグインも対象外とする。

既存のproduction違反10件は、入力形式の判定、PDFの結合・crop、EPS/Draw.io変換、Webview previewの処理などを小さな責務の関数へ分割して解消する。テストコードの`package.json`検証関数はテスト専用の構造検証として対象外にする。

## Phase 28

ブロックのネスト深度を4以下に制限する`max-depth`をerrorへ強化する。ESLintとOxlintのルール既定値に合わせ、production code、Webview本体、Node.js/GitHub Actionsスクリプトへ適用する。テストコードは対象外とする。

既存の違反1件は、NLS検証処理のuserMessage call判定を専用helperへ分割して解消する。

## Phase 29

関数の引数を5個以下に制限する`max-params`をerrorへ強化する。ESLintの既定値は3だが、現行コードには変換処理のruntime/tool依存を4〜5個の引数で受ける既存設計が多いため、まず6個以上の明らかに過剰な関数を対象にする。対象はproduction codeとWebview本体とし、テストコードと未型付けのESTree visitor APIを扱う独自Oxlintプラグインは対象外とする。

既存の違反8件は、PDF/SVG変換のtool群・実行コンテキスト・出力設定を引数オブジェクト内へまとめて解消する。

## Phase 30

複雑度・ネスト・引数数とは異なる方向から、次の制限をerrorへ強化する。

- `import/no-duplicates`で同じモジュールの重複importを禁止し、importの責務を1箇所にまとめる
- `eslint/no-implicit-coercion`で`!!value`のような暗黙の型変換を禁止し、`Boolean(value)`など意図が明確な表現を使う
- `eslint/max-classes-per-file`でproduction codeの1ファイル1クラスを強制し、例外クラスを別モジュールへ分離する。テストの複数クラスのdoubleは対象外とする
- `no-warning-comments`でTODO/FIXME/XXXをerrorとして検出し、未完了の実装が通常lintを通過し続けることを防ぐ
- `typescript/no-empty-object-type`で意味が曖昧な`{}`型を禁止し、空オブジェクトを表す場合は`object`などの意図が分かる型を使う

既存違反は重複import 4件、暗黙の型変換1件、productionの複数クラス1件だった。対象外のテストdoubleを除き、すべて修正してerror化する。

## Phase 31

さらに別の方向から、次の制限をerrorへ強化する。

- `eslint/no-unsafe-finally`で`finally`内の`return`・`throw`・loop controlによる例外や戻り値の上書きを禁止する
- `eslint/no-unreachable-loop`で静的に2回目へ到達できないloopを禁止する。テストのpolling helperは静的解析の誤検知を避けるため対象外とする
- `import/no-cycle`で依存関係の循環を禁止する
- `typescript/no-redundant-type-constituents`でunion/intersection内の無効な構成要素を禁止する
- `unicorn/no-array-reduce`で集計処理を`for...of`へ置き換え、途中の値と処理順序を明示する

既存のproduction違反はなく、NLS checkerとcoverage reportの集計処理に残っていた`reduce()`をloopへ置き換える。テストのpolling loopは対象外とする。

## Phase 32

Promise executorから値を返すことを禁止する`eslint/no-promise-executor-return`と、`Promise.reject()`を不要に包んだ戻り値を禁止する`unicorn/no-useless-promise-resolve-reject`をerrorへ強化する。前者はproduction code、Webview本体、Node.js/GitHub Actionsスクリプトへ適用し、テストコードではPromise executorを使ったタイマー・stubが既存の8件あるため対象外とする。後者は全対象で適用する。

既存のproduction違反は、WebviewのPDFページ描画で`async`関数から`Promise.reject()`を返していた1件だけだったため、直接throwへ置き換える。これにより非同期関数のrejection契約を保ったまま、例外の制御フローを明示する。

## Phase 33

既存コードに修正を要求せず、異なる方向から将来の混入を防ぐ次の制限をerrorへ強化する。

- `eslint/no-constant-condition`で到達不能な条件式を禁止する
- `eslint/no-duplicate-case`でswitch内の重複caseを禁止する
- `eslint/no-unsafe-optional-chaining`で`undefined`になり得るoptional chainingの後続利用を禁止する
- `typescript/no-duplicate-enum-values`でenum値の重複を禁止する
- `typescript/no-unsafe-function-type`で型安全性を失う汎用`Function`型を禁止する
- `promise/no-return-wrap`でPromise callbackの値を不要にresolve/rejectで包むことを禁止する

既存違反はいずれも0件だったため、コードの挙動を変更せず、通常lintで将来の違反をerrorとして検出する。

## Phase 34

さらにAPI利用と構造の重複を別方向から制限する。

- `eslint/no-prototype-builtins`でprototype経由の予期しないproperty shadowingを避ける
- `typescript/no-empty-function`、`typescript/no-extraneous-class`、`typescript/no-useless-constructor`で意味のない空実装・utility class・constructorを禁止する
- `typescript/no-unnecessary-parameter-property-assignment`でparameter propertyの重複代入を禁止する
- `typescript/prefer-find`と`typescript/prefer-includes`で配列の検索意図をAPIへ合わせる
- `unicorn/no-useless-switch-case`で空のswitch caseを禁止する
- `unicorn/prefer-set-has`でSetに対する線形検索を禁止する
- `promise/no-new-statics`でPromise subclassの誤ったstatic利用を禁止する

`typescript/no-empty-function`は本番コードに2件、テストdoubleに9件あった。本番のbest-effort cleanup callbackには意図を示すコメントを追加し、テストdoubleは既存のテストoverrideで対象外とする。その他の9ルールは既存違反0件で、挙動変更なしで通常lintへ追加する。

## Phase 35

callbackの引数契約と不要な戻り値を明確にする。

- `eslint/no-useless-return`で意味のない`return;`を禁止する。WebviewのVS Code API fallbackは「状態なし」をコメント付きの空callbackで表現する
- `unicorn/no-array-callback-reference`で配列iteratorへ関数参照を直接渡すことを禁止し、callbackへ渡す引数を明示する。productionの`Number.isFinite`参照をarrow callbackへ置き換え、テストdoubleは対象外とする

既存違反はproductionの`no-useless-return`が3件、productionの`no-array-callback-reference`が3件、テストのcallback referenceが1件だった。productionの6件を修正し、テストの1件はoverrideで対象外とする。

## Phase 36

importと型宣言の重複・曖昧さを別方向から制限する。

- `eslint/no-duplicate-imports`で同じモジュールから分割されたimportを禁止する
- `eslint/prefer-const`で再代入されない変数のmutable宣言を禁止する
- `import/newline-after-import`でimport群と実装の境界を空行で明確にする
- `typescript/array-type`で配列型の表記を`T[]`へ統一する
- `typescript/unified-signatures`で統合できるoverloadの重複を禁止する

既存違反は重複import 5件、`prefer-const` 1件、import後の空行不足2件、配列型4件、統合可能なoverload 1件だった。型importを同一importへ統合し、配列型・変数宣言・空行を機械的に修正した。テストhelperのoverloadはunionを受ける1つのgeneric signatureへまとめ、戻り値型の指定を維持する。挙動変更はない。

## Phase 37

分岐のスコープとAPI選択を明示する方向へ制限を広げる。

- `unicorn/switch-case-braces`でswitchの各caseをブロック化し、case間の変数スコープ混在を防ぐ
- `unicorn/prefer-ternary`で単純な二択の非同期処理を1つの式へまとめる
- `unicorn/prefer-global-this`で環境依存のglobal aliasを`globalThis`へ統一する
- `unicorn/prefer-dom-node-text-content`でDOM本文取得に`textContent`を使い、レイアウト依存の`innerText`を避ける

既存違反はcaseのbrace不足43件、単純なif/else 3件、`window`参照3件、`innerText`参照2件だった。caseをブロック化し、非同期二択処理をternaryへ移し、Webviewテストのglobal参照を置き換えた。Electronの診断helperはレイアウト後の本文を記録する既存契約を保つため`prefer-dom-node-text-content`のtest overrideで対象外とする。production/Webview側の将来違反はerrorとして検出する。

## Phase 38（実験）

通常の`lint`を変更せず、`lint:strict-experimental`で次の大規模な制限を一時的に適用できるようにする。

- `-D all`でcorrectness、suspicious、perf、pedantic、style、restrictionの全カテゴリをerrorへ強化する
- `-D nursery`で開発中のnurseryカテゴリもerrorへ強化する
- `--type-aware`で型情報を必要とするルールを有効にする

mainの現行コード219ファイルに対する初回測定では、14,208件のerrorが検出された。違反数の多いルールは次のとおりだった。

- `eslint/no-magic-numbers`: 1,285件
- `typescript/prefer-readonly-parameter-types`: 1,172件
- `eslint/sort-keys`: 1,094件
- `eslint/no-use-before-define`: 1,062件
- `oxc/no-async-await`: 1,009件
- `eslint/no-undef`: 749件
- `eslint/func-style`: 745件
- `eslint/sort-imports`: 629件
- `oxc/no-optional-chaining`: 596件
- `typescript/no-unsafe-call`: 568件

既存の通常lintとCIのmerge gateは変更しない。今回の実験は、現行設計を大きく変えるルールと、段階的にerror化できる候補を分離するための基準値として扱う。

`lint:strict-experimental -- --fix`も試行した。14,208件から13,000件へ1,208件を自動で減らせたが、168ファイル・2,371行の差分が生成された。`sort-keys`による実行時objectの並べ替えや、type importの分離による通常lintの重複importなど、単純な整形に限定できない変更が混在したため、差分は採用しない。strict実験では、ルール群を分割して自動修正の安全性を確認してから取り込む。

## Phase 39 — Done

`-D all -D nursery --type-aware`の現行測定から、違反が3件以下で通常lintへerror昇格できるルール群をまとめて有効化した。Phase 38の実験結果から「違反が多いルールを一括有効化しない」方針は維持し、既存違反を解消してからerror化した。

対象ルールと既存違反の所在:

- production: `consistent-indexed-object-style`(locale_map.ts)、`consistent-type-assertions`(locale_map.ts)、`custom-error-definition`(operation_cancelled_error.ts)、`prefer-number-coercion`(convert_to_drawio.ts)、`parameter-properties`(safe_mode.ts)、`prefer-code-point`(resolve_output_path.ts・convert_drawio_to_pdf.ts)、`return-await`(combine_images_to_pdf.ts・merge_pdf.ts)
- webview: `no-deprecated`(vite.config.ts)、`prefer-query-selector`(3つのmain.tsx)
- scripts/config: `named`(.vscode-test.mjs)、`no-anonymous-default-export`(oxfmt.config.ts)。`no-process-exit`は後に廃止したスクリーンショットrendererへ適用していた
- test: `dot-notation`(package_manifest.test.ts)、`no-dynamic-delete`(workspace_settings.ts)、`no-regex-spaces`(convert_to_pdf_drawio_path.test.ts)、`func-names`(drawio_fixture_oracles.test.ts)、`callback-return`(safe_mode_status_bar.test.ts・workspace_settings.ts)
- 生成ファイル: `default-case`・`explicit-module-boundary-types`(generated-extension-meta.ts)はgenerator修正で対応
- PDF.js polyfill: `unambiguous`・`no-implicit-globals`・`callback-return`(install_map_get_or_insert_computed.ts)は対象限定のoverride

既存違反を修正または理由付きoverrideした上で、通常lintでerrorとして監視する。

## Phase 40 — Project contracts

汎用的なstyle ruleでは表現できない、Graphics Workbench固有の境界を独自pluginでerrorとして監視する。

- `project/no-webview-api-bypass`: Webview appはraw `acquireVsCodeApi()`や`postMessage()`を直接使わず、app-localの`vscode.sendMessage` wrapperを経由する。API wrapper自身だけを例外にする
- `project/require-webview-listener-cleanup`: Webview appの`window` message listenerは、同じhandlerで`removeEventListener`されることを要求する
- `project/require-process-envelope`: process protocolのrequest/start/success/failure型は`type`・`protocolVersion`・`requestId`を持つ
- `project/no-pdf-bytes-in-process-ipc`: PDF process protocolへ`pdfBytes`・`bytes`・`buffer`・`content`・`data`を追加せず、pathとmetadataだけを渡す
- `project/no-secret-output-log`: secret-like identifierやjob JSON pathを`OutputChannel.appendLine`へ補間しない
- `project/no-direct-child-process`: `child_process`への直接アクセスをexternal-tool adapterとprocess runnerへ限定する。test・script・Webviewの実行補助コードは既存用途として許可する

これらは実行時のrollbackやprocess-tree cleanupの正しさを静的解析で代替するものではない。path境界、staging、cancellation、cleanupの実装契約は既存helperと外部挙動テストで検証し、lintは新しい違反の混入を早期に止める境界チェックとして使う。

## Phase 41 — Readability

人間が読んだときの意図を明確にする方向で、現行違反がほぼ0のルールをerrorへ強化した。

対象ルール:

- `eslint/no-else-return` — `return`後の不要な`else`を禁止
- `eslint/no-lonely-if` — `else { if }`を`else if`へ統一
- `eslint/no-useless-catch` — throw以外の処理がないcatchを禁止
- `eslint/object-shorthand` — `{ x: x }`を`{ x }`へ統一
- `typescript/no-this-alias` — `const self = this`を禁止しarrow functionへ寄せる
- `typescript/default-param-last` — default parameterを末尾へ強制。既存1件（`copy_file_with_abort.ts`）をパラメータ順を変えず本体の`flags ?? 0`へ変更
- `typescript/prefer-readonly` — 再代入されないpropertyを`readonly`へ
- `unicorn/prefer-optional-catch-binding` — 未使用のcatch bindingを`catch {}`へ
- `unicorn/consistent-function-scoping` — 親スコープを参照しない関数の巻き上げ。既存1件（`scripts/oxlint-project-plugin.mjs`の`isChildProcessSource`）をmodule scopeへ移動

oxlintが未サポートのため採用しない候補: `eslint/consistent-return`、`eslint/no-mixed-operators`、`unicorn/no-useless-else`（config解析でrejectされた）。

`eslint/prefer-destructuring`は違反が40件以上と多いためPhase 39の方針どおり一括有効化せず、別phaseで小さく解消してからerror化する。

## Phase 42 — prefer-destructuring

`eslint/prefer-destructuring`をerrorへ強化した。Phase 41で「違反40件以上を別phaseで小さく解消してからerror化」と先送りしていた候補。

- 現行違反は77件（src 27 / test 27 / webview 12 / scripts 11）。
- `const x = obj.prop`を`const { x } = obj`へ、`const x = arr[i]`を配列destructuringへ置き換えた。主に以下の形。
  - 配列先頭: `const [sourceUri] = sourceUris`（`[0]`＋undefined判定の組）
  - 配列指定index: `const [, , outputPath, inputPath] = args`（テストのCLI引数位置）、regex matchは`const [, sourceName, targetName] = match`
  - rest: `const [firstEntry, ...restEntries] = entries`
  - splice/pop相当: `const [movedSource] = next.splice(fromIndex, 1)`、`const [lastEntry] = entries.slice(-1)`
  - assignment destructuring: `({ width, height } = metadata)`、`({ scratch } = preparedInput)`
- auto-fix（`lint:fix`）で40件を機械変換し、型キャストを落とす箇所は`in`型ガードが既に型を狭めていたため意味を保てた。残り32件は`[0]`＋undefined判定・指定index・assignment形式でfixerが安全に変換できないため手動対応。
- 意味的に等価であることをtypecheck（src/test/webview×2）、lint、check:all、webview vitest、Extension Host test（514 passing）で確認した。

## Phase 43 — 0違反の型安全・正確性ルール群

既存違反が0件のルール群を、挙動変更なしでerrorへ強化した（Phase 33/34と同じ方針）。

- `typescript/prefer-optional-chain` — `a && a.b`をoptional chainingへ
- `eslint/no-useless-escape` — 不要なエスケープを禁止
- `eslint/no-redeclare` — 同一スコープの再宣言を禁止
- `eslint/no-sequences` — comma operatorによる副作用式の並置を禁止
- `eslint/no-control-regex` — control characterの正規表現を禁止
- `promise/no-nesting` — Promise内の入れ子Promiseを禁止
- `promise/param-names` — Promise executorの引数名を`resolve`/`reject`へ強制
- `unicorn/no-thenable` — thenableオブジェクトの作成を禁止

`typescript/no-unsafe-member-access`は現行違反が多数あるため、Phase 42で保留したまま`off`を維持する。Phase 42でerror化した`prefer-destructuring`の違反5件がlintスコープ外の`scripts/check-nls.mjs`・`scripts/oxlint-project-plugin.mjs`に残る点は、lintスコープの拡張時に解消する。

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
- `complexity` は既定上限20で12件を検出した。production codeとWebview本体の10件は責務別のhelperへ分割して解消し、テスト専用のpackage.json検証関数と未型付けESTree visitor APIを扱う独自プラグインはoverrideで対象外にする
- `max-depth` は既定上限4でproduction codeとスクリプトに1件を検出した。NLS検証処理のuserMessage call判定をhelperへ分割して解消する
- `max-params` は既定上限3ではproduction codeとWebview本体に76件、上限5では6個以上の関数を8件検出した。Phase 29では上限5をerror化し、PDF/SVG変換の8件を引数オブジェクトへまとめて解消する。テストコードと独自Oxlintプラグインは対象外にする
- `import/no-duplicates` は4件、`eslint/no-implicit-coercion` は1件、`eslint/max-classes-per-file` はproduction codeに1件、テストdoubleに3件を検出した。Phase 30ではproduction codeのクラスを分離し、重複importと暗黙変換を修正する。テストdoubleは対象外とする
- `no-warning-comments` と `typescript/no-empty-object-type` は既存違反0件だったため、将来の未完了コメントと曖昧な空オブジェクト型の混入をerrorとして監視する
- `eslint/no-unsafe-finally`、`import/no-cycle`、`typescript/no-redundant-type-constituents` は既存違反0件だったため、危険な制御フロー・循環依存・冗長な型の混入をerrorとして監視する。`eslint/no-unreachable-loop` はテストのpolling helperに1件、`unicorn/no-array-reduce` はNLS checkerに1件を検出した。Phase 31ではテストのloopを対象外にし、集計処理を`for...of`へ置き換える
- `eslint/no-promise-executor-return` はproduction code、Webview本体、Node.js/GitHub Actionsスクリプトに既存違反がなく、テストコードに8件あった。Phase 32ではproduction系をerrorにし、テスト用Promise executorはoverrideで対象外とする。`unicorn/no-useless-promise-resolve-reject` はWebviewのPDFページ描画に1件あり、直接throwへ置き換えてerror化する
- `eslint/no-constant-condition`、`eslint/no-duplicate-case`、`eslint/no-unsafe-optional-chaining`、`typescript/no-duplicate-enum-values`、`typescript/no-unsafe-function-type`、`promise/no-return-wrap` は既存違反0件だったため、Phase 33で将来の危険な式・重複構成・汎用型・不要なPromise wrapperをerrorとして監視する
- `eslint/no-prototype-builtins`、`typescript/no-extraneous-class`、`typescript/no-unnecessary-parameter-property-assignment`、`typescript/no-useless-constructor`、`typescript/prefer-find`、`typescript/prefer-includes`、`unicorn/no-useless-switch-case`、`unicorn/prefer-set-has`、`promise/no-new-statics` は既存違反0件だった。`typescript/no-empty-function`は本番2件とテスト9件を検出し、本番は意図コメント、テストはoverrideで解消した。Phase 34でAPI利用・構造・collection検索・Promise契約の違反をerrorとして監視する
- `eslint/no-useless-return`はWebview fallbackに3件、`unicorn/no-array-callback-reference`はproductionに3件とテストに1件あった。Phase 35でproductionの6件を修正し、テストのcallback referenceはoverrideで対象外にしてerror化する。`eslint/no-use-before-define`はproduction・testに多数あるため、関数配置の設計判断を含む別phaseへ保留する
- `suspicious`カテゴリの既存違反は38件で、postMessageのtarget origin、side-effect import、shadowing、error cause、テンプレート式などに分散していた
- `suspicious`カテゴリ全体をerrorにすると、型アサーション、配列sort、importなどの既存違反が多数あるため、Phase 1では有効化しない

## Completion criteria

- Phase 1からPhase 25までの制限をCIの通常lintで強制できる
- Phase 26の構造改善ルールを通常lintでerrorとして強制できる
- Phase 27の複雑度ルールを通常lintでerrorとして強制できる
- Phase 28のネスト深度ルールを通常lintでerrorとして強制できる
- Phase 29の引数数ルールを通常lintでerrorとして強制できる
- Phase 30のimport、型変換、クラス構成、未完了コメント、空オブジェクト型の制限を通常lintでerrorとして強制できる
- Phase 31の制御フロー、依存関係、型構成、集計処理の制限を通常lintでerrorとして強制できる
- Phase 32のPromise executorと不要なPromise rejection wrapperの制限を通常lintでerrorとして強制できる
- Phase 33の危険な式、重複構成、汎用Function型、不要なPromise wrapperの制限を通常lintでerrorとして強制できる
- Phase 34のAPI利用、構造の重複、collection検索、Promise/Node callback契約の制限を通常lintでerrorとして強制できる
- Phase 35の不要な戻り値とiterator callback参照の制限を通常lintでerrorとして強制できる
- Phase 36のimportと型宣言の重複・表記の制限を通常lintでerrorとして強制できる
- Phase 37のswitchスコープ、二択制御、global/DOM API選択の制限を通常lintでerrorとして強制できる
- Phase 40のWebview API、listener cleanup、process protocol、IPC payload、ログ、child_process境界を通常lintでerrorとして強制できる
- 既存の型チェック、format、テスト、buildを壊さない
- 次に強化する候補と既存違反をtaskへ記録する

## Follow-up

次のphaseでは、対象ディレクトリまたはルール単位で残る型安全ルールの既存違反を小さく解消し、段階的にerrorへ移す。違反が多いルールを一括有効化しない。
