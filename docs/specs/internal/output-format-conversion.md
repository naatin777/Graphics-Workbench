# 出力形式基準の変換の内部契約

出力形式基準commandの利用者向け挙動は、[product specification](../product/output-format-conversion.md)を正本とする。この文書は、commandとformat-specific processing、batch transaction、依存関係の境界だけを記録する。

## Command and processing boundary

command層は選択された入力をbatchとして受け取り、入力ごとのformat-specific processingへ渡す。入力判定、outputPathの解決、Safe Mode、Undo、progress、cancellationは、それぞれの共通boundaryへ接続し、format-specific coreへVS Code APIを渡さない。

## Output path and template source

command IDは`convertToPdf`などの出力形式基準とする。出力path templateは入力形式と出力形式のpairを基準にする。

- 単一出力と`${page}`を含む複数出力のどちらも`outputPath.convertXToY`から読む。
- `outputPaths` objectや別名の設定は読まない。

現在の正本はpackage manifestとproduct specificationであり、ADR-0021は過去の設計背景として参照する。

templateの`${file}`、`${fileBasename}`、`${fileBasenameNoExtension}`などのsource系変数は、変換対象として扱う論理入力pathを基準にする。editable Draw.io画像（`.drawio.png`、`.dio.png`、`.drawio.svg`、`.dio.svg`）ではwrapper suffixを除いたpathを使用する。通常の入力では元の入力pathをそのまま使用し、元ファイルpath専用の追加template変数は提供しない。

## Batch transaction

1回のcommand実行に対応するoperation rootを作り、入力ごとの中間artifactと完成artifactをfinal pathから分離して保持する。

- format-specific processingはstaging内で完了させる。
- commit coordinatorはbatchの全processing結果を受け取ってからfinal pathを扱う。
- 競合解決とUndo recordはbatch単位のtransactionへ接続する。
- cancelまたはprocessing/commit failure時は、operation ownerがstagingとrollbackを処理する。

stagingの寿命とactivation時のcleanupは、[Safe Mode internal contract](safe-mode.md)と[file operation security contract](file-operation-security.md)を正本とする。

## Format dependency boundary

- 形式ごとの変換処理はformat-specific moduleに閉じ込める。
- Draw.ioから画像への変換は、数式を保持するためPDF中間artifactを経由する既存経路を使用する。
- Mermaid入力の変換は外部の`mmdc` entrypointを外部processとして実行し、`execPath.mermaid`またはPATHから解決する。SVG・PNG・PDFの直接出力と、既存画像変換経路へ渡す処理を分ける。
- Mermaid CLIとSVG→PDFのChrome backendは`execPath.chrome`を共有し、Chrome実行は共通external tool runnerを通す。Mermaid CLIは拡張機能へ同梱せず、利用者が別途installする。

## Shared operation contracts

progressとcancellationは[conversion progress and cancellation internal contract](conversion-progress-and-cancellation.md)、出力反映とbackupは[Safe Mode internal contract](safe-mode.md)、取消記録は[Undo internal contract](undo-last-conversion.md)へ委譲する。
