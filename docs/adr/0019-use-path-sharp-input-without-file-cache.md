# ADR-0019: Sharpのpath入力ではfilesystem cacheを無効にする

## ステータス

採用

## 日付

2026-07-23

## 決定

Raster入力はSharpへfilesystem pathを渡し、Sharpのfilesystem cacheは`sharp.cache({ files: 0 })`で無効にする。画像全体をBufferへ読み込んで渡す経路へ戻さない。

## 理由

path入力は大きな画像をExtension Hostへ先に展開せずに済む。一方Sharp/libvipsが入力fileをcacheして保持すると、Windowsでpreflight後のrename・cleanupと競合し、後続変換が`EBUSY`になる。cacheを無効にすることで、入力fileの所有権を変換境界とcleanupへ戻す。

## 見直す条件

Sharp/libvipsのcache仕様、Windowsのfile handle挙動、またはRaster pipelineの入力方式を変更する場合に、3 OSのcleanup・rename・大容量入力テストを再確認する。

## 関連

- [`docs/architecture.md`](../architecture.md)
- [`docs/safety.md`](../safety.md)
