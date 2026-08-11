# Change Log

## 1.0.0

- New Table Editor (`graphics-workbench.openTableEditor`): paste tables copied from Excel / Google Sheets or drop `.csv` / `.tsv` files, edit cells, and insert LaTeX / Typst / Quarkdown table code into the active document.
- BREAKING CHANGE: conversion commands are organized by output format; old pair-specific command IDs have no compatibility aliases.
- BREAKING CHANGE: native Draw.io commands are now `graphics-workbench.convertDrawioToPagePdfs` and `graphics-workbench.convertDrawioToSinglePdf`; image aggregation is `graphics-workbench.combineImagesToPdf`.
- BREAKING CHANGE: conversion output settings now use only `graphics-workbench.outputPath.convertXToY`; the `outputPaths` object and old public names are no longer read.
- Same-format conversion is rejected. Normal raster conversions use the first GIF/TIFF page or frame, while Convert to PDF preserves all GIF/TIFF pages in the output PDF, including TIFFs whose page dimensions differ.
- RAW output support was removed.
- Generated raster, SVG, Draw.io, and PDF outputs are validated before commit.

## 0.4.0

- Delete AI function

## 0.3.0

- Changed from Inkscape to Puppeteer

## 0.2.0

- Add command to split PDF files
- Add command to merge PDF files

## 0.1.0

- Initial release
