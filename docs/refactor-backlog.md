# Refactor backlog

実装上のバグリスク、変更コスト、テスト困難性を具体的に減らす見込みがあり、今すぐ着手しない候補だけを記録する。命名の好みや軽微な重複は残さない。

## PDF/SVG staging batchの共通化

PDF/SVG operationにもstaging・concurrency・commit・cleanupの近い処理がある。形式固有のtool/encoder差分を保ったまま、同じ安全性変更を繰り返す必要が生じた場合に、共通helperの導入を再評価する。巨大なgeneric conversion engineにはしない。

## MuPDF処理のExtension Host外隔離

reorder、rotate、split、mergeの同期的なMuPDF処理は、大きな入力でExtension Hostの応答性とキャンセル反映を悪化させる可能性がある。再現性のある障害、またはキャンセル保証を強化する要件が出た場合に、worker/process lifecycle・staging・Undoを含めて検討する。現状の外部CLI経路と同じ実行モデルを前提にしない。
