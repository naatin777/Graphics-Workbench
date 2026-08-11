# rsvg-convert/librsvgが半透明PNGの`<image>`描画を崩す調査
> 位置づけ: 現役（最新。テストoracle除外の根拠）

## 調査日

2026-08-08

## 対象

- rsvg-convert 2.62.3（librsvg）
- sharp（prebuilt libvips内のlibrsvg）
- SVG内に`<image>`として埋め込まれたPNG
- ExcalidrawのSVG export（`@excalidraw/excalidraw` 0.18.1の`exportToSvg`）

## 確認できた事実

### 最小再現の切り分け結果（同一寸法の領域でpixel比較）

| SVG構造                      | PNG                    | 描画結果（rsvg-convert 2.62.3） |
| ---------------------------- | ---------------------- | ------------------------------- |
| `<image>`直接配置            | 不透明PNG              | 差 0.0% → **正常**              |
| `<symbol>`+`<use>`+`<image>` | 不透明PNG              | 差 0.0% → **正常**              |
| `<image>`直接配置            | 半透明PNG（alpha=128） | 差 100% → **崩れる**            |
| `<symbol>`+`<use>`+`<image>` | 半透明PNG（alpha=128） | 差 100% → **崩れる**            |

- **崩れる条件は「PNGの半透明ピクセル」に限定される。SVG側の書き方（`<symbol>`+`<use>` か直接 `<image>` か）は無関係。**
- 崩れ方は色が白く飛ぶ（半透明画像の領域のRGB meanが、不透明描画の[71,139,208]に対し [163,197,231] と明るくなる）。画像が消えるわけではなく、色合成が壊れる。
- 不透明PNG（alpha=255）は、`<symbol>`+`<use>`で`preserveAspectRatio="none"`でも完全に正しく描画される。

### Excalidrawとの関係

- Excalidrawの`exportToSvg`は、シーン内のimage要素を`<symbol>`（内部は`<image href="data:..." preserveAspectRatio="none" width/height="100%">`）+`<g transform>`+`<use>`構造で出力する。
- `test/input/valid/excalidraw/embedded-image.excalidraw`の埋め込み画像（`3c8c02e388d6745a017a575fc065c8ca24b0ac56`、320x200）は**alpha mean≈190の半透明PNG**であり、このバグに該当する。
- 同じSVGをheadless Chromeで描画すると、埋め込み画像領域の差は6.7%（ほぼ正しい）で、**SVGの出力自体は正しい**。問題はlibrsvgのラスタライズに限定される。

## 影響

- **正常**: Excalidraw→PDFの既定経路（SVG→PDF engine=chrome）。Chromeは正しく描画する。
- **崩れる**: SVG→PDFの`rsvg-convert` engine、およびSVG→PNG（sharp=librsvg）で、半透明PNGを埋め込んだSVGのみ崩れる。
- 埋め込み画像が不透明PNGの場合は、どの経路でも崩れない。

## 判断への影響

- Excalidraw fixtureのpixel oracle（sharp/librsvgベース）は、**半透明画像を埋め込んだフィクスチャを対象にできない**。librsvgの崩れを「正解」として焼き込むことになるため。
- `embedded-image.excalidraw`はsharpベースのpixel oracleから除外する。背景色・空のフィクスチャ（半透明画像を含まない）はlibrsvgでも正しく検証できるため維持する。
- 半透明画像の描画をpixel検証したい場合はChrome経路（`graphics-workbench.convertToPdf.svg.engine`=chromeと同じ描画基盤）での比較が必要。

## 再確認条件

- rsvg-convert / sharp（libvips）を更新するとき
- SVG→PDFの`rsvg-convert` engineの既定化を検討するとき
- Excalidrawの`exportToSvg`が画像のSVG出力構造を変更したとき
- 半透明画像を含むExcalidraw fixtureのpixel検証方針を決めるとき

## 関連

- `test/operations/excalidraw_fixture_oracles.test.ts`（embedded-image除外の理由）
- `test/input/valid/excalidraw/embedded-image.excalidraw`
- `src/operations/conversion/excalidraw_adapter.ts`（SVG出力側、崩れの原因ではない）
