# Naming Conventions

命名は見た目ではなく、初見の読者が責務、入力、結果、public/internal境界を予測できることを目的にする。

| Surface                      | 文法                                        | Case                                        | 良い例                                                                    | 悪い例                                             | 判断                                                                                   |
| ---------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| directory                    | domainまたはcapabilityの名詞                | 複数語は`snake_case`                        | `external_tools/`、`edit_provider/`                                       | `utils/`、`misc/`、`new_stuff/`                    | 既存の`application/`、`operations/`は依存境界が確定するまで移動しない                  |
| TypeScript file              | 主要exportまたは主要責務                    | 複数語は`snake_case`                        | `convert_to_pdf.ts`、`run_staged_conversion_batch.ts`                     | `convertPngToPdf.ts`、`helpers.ts`                 | file名は最も広い実責務を表す。legacy名を理由にcanonical fileを狭くしない               |
| exported function            | 動作を表す動詞 + 対象 + 結果                | `lowerCamelCase`                            | `convertToPdfFiles`、`combineImagesToPdf`                                 | `pdfHelper`、`processPdf`                          | export名だけで入力と結果が読めるようにする                                             |
| local function               | 動作を表す動詞から開始                      | `lowerCamelCase`                            | `resolveOutputPath`、`buildCommitOptions`                                 | `jobThing`、`doIt`                                 | 短いscopeで役割が明確ならrepository全体で一意化しない                                  |
| type / interface             | 責務、データ、結果を表す名詞                | `UpperCamelCase`                            | `PreparedConversionOutput`、`SplitPdfPageGroupsJob`                       | `Data`、`HelperOptions`                            | `manager`、`processor`など広い語を避ける                                               |
| module-level shared constant | 意味が固定された共有値                      | `CONSTANT_CASE`                             | `CONVERSION_CONCURRENCY`                                                  | `defaultPath`、`conversionConcurrency`             | local定数は通常の`lowerCamelCase`でよい                                                |
| command entrypoint           | public/internal commandの動作 + `Command`   | `lowerCamelCase`                            | `convertToPdfCommand`、`cropPdfAutoCommand`                               | `convertToPdf`、`cropPdfAuto`                      | command登録入口だけにsuffixを付ける。operationは`Command`にしない                      |
| command ID                   | extension namespace + capability + mode     | 既存形式の`lowerCamelCase`/dot              | `graphics-workbench.splitPdf.allPages`                                    | `graphics-workbench.convert`（粒度が広すぎる）     | public IDは現在の機能を一意に表し、manifest外のaliasをruntime登録しない                |
| config key                   | 設定domain + semantic setting               | `lowerCamelCase`/dot                        | `outputPath.single.pdf`、`outputPath.split.png`、`outputPath.combine.pdf` | 入力形式と結合したkey                              | command IDとoutput path keyは別の粒度で命名し、operationの出力モデルを正本にする       |
| output template              | 出力の対象と粒度を示す                      | output-model-based output path              | `outputPath.single.pdf`、`outputPath.split.png`、`outputPath.combine.pdf` | 入力形式を埋め込んだkey                            | `single`／`split`／`combine`をoperationの出力モデルに合わせて使う                      |
| NLS key                      | UIのdomain + message role                   | `lowerCamelCase`/dot                        | `message.progress.convertToPdf.title`                                     | `text1`、内部logger用key                           | NLS keyはuser-facing surface。legacy command IDと同じ名前でも用途を記録する            |
| test file                    | 被検証module/capability + optional contract | `snake_case.test.ts`                        | `convert_to_pdf_command.test.ts`、`split_pdf_page_groups.test.ts`         | `misc.test.ts`、`test_conversion.ts`               | filenameはtest対象を示し、suite名と同じ語彙を使う                                      |
| test suite                   | 対象domainまたはobservable contract         | ADR-0011に従い日本語                        | `PDF全ページ分割`、`外部tool実行ファイルの設定`                           | `Split PDF page groups`と日本語suiteの混在         | 既存suiteはbehavior固定のため無理に全履歴を改名しない                                  |
| docs file                    | document role + topic                       | 英語の`kebab-case`                          | `naming-conventions.md`、`output-format-conversion.md`                    | `notes.md`、日付だけの仕様file                     | `docs/specs/`、`docs/adr/`は既存の役割に従う                                           |
| legacy alias                 | 旧surfaceを意味する固定語 + 対象            | `legacy`または`compatibility`を説明文で使う | 削除条件を定めた一時aliasの文書                                           | 無期限の内部alias、新機能に`direct`/`normal`/`new` | 削除済みcommand IDをaliasとして復活させない。aliasは削除条件と期限を決めてから追加する |

## Directory layout

各workspaceの`src/`は責務境界の下に、複数の関連moduleを持つ領域だけを分割する。

```text
core/src/
  config/{external_tools,output}/
  operations/{conversion,external_tools,input,lifecycle}/
  security/
  shared/

vscode/src/
  commands/{conversion,lifecycle,pdf,preview,shared}/
  config/{external_tools,output,rendering}/
  edit_provider/
  generated/
  operations/{conversion,lifecycle,pdf,preview}/
  presentation/webview/
  shared/protocols/

core/test/{unit,contract,integration}/
vscode/test/{unit,contract,extension-host,e2e,support}/
test/{input,output}/
```

`core/src/security/`と`vscode/src/presentation/webview/`は現在1責務・1moduleのため、空の下位directoryを作らない。固定fixtureの`test/input/`・`test/output/`と、実行時資産の`vscode/test/support/`はsource責務から分離する。

## Naming and compatibility

1. public command ID、user setting key、output template semantics、NLS keyはpublic surfaceである。
2. public surfaceのcanonical名を変更する場合は、先に新旧対応表、alias/fallback、deprecated案内、双方のtest、削除条件を決める。
3. v1移行で削除すると正式決定した旧command IDは、内部aliasとしても残さない。canonical public command IDは互換性のため安易に変更しない。
4. 一時的なcommand alias、setting fallback、compatibility wrapperを追加する場合は、追加時点で以下を明記する。
   - canonicalな置き換え先
   - aliasが必要な具体的利用者
   - 公開surfaceかinternal surfaceか
   - 削除条件
   - 削除予定versionまたは再検討条件
   - aliasを直接利用しないcanonical経路のテスト
   - alias削除時に消すコード・NLS・テストの一覧

   「念のため」「移行中だから」「必要になるかもしれない」だけでは追加しない。無期限のaliasや「将来削除する予定」という理由だけのaliasを作らない。

5. internal symbolとfile名はbehaviorを変えずに先にcanonical語彙へ寄せる。ただし、compiled moduleを外部からimportする利用実態が判明した場合はaliasを残す。
6. staging directoryのoperation labelはcleanup、Undo、recoveryのpath契約に含まれるため、source fileの改名と同時に変更しない。
7. `convert`、`combine`、`merge`は、変換・結合・統合という操作目的が異なるため代用しない。
8. `vscode/package.json`由来のcommand ID、configuration schema、Extension identity、submenu metadataは、`vscode/src/generated/extension_manifest.ts`を正本とし、別箇所へ手書きしない。public commandの実装bindingは`vscode/src/commands/shared/command_bindings.ts`を正本とし、`vscode/src/extension.ts`へ個別登録を追加しない。
9. 一時的なinternal commandやcompatibility aliasを追加する場合は、用途、利用者、削除条件、owner testを明記する。generator内へlegacy command IDを直接記述しない。
