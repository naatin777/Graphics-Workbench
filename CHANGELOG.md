# Change Log

## 1.0.0

- BREAKING CHANGE: conversion commands are organized by output format; old pair-specific command IDs have no compatibility aliases.
- BREAKING CHANGE: native Draw.io PDF page conversion keeps `latex-graphics-helper.convertDrawioToPdf`; editable Draw.io images use output-format conversion commands.
- Same-format conversion is rejected, and normal GIF/TIFF input uses only the first page/frame. Explicit animation preserve/split commands retain their multi-frame behavior.
- RAW output commits `.raw` and `.raw.json` as one pair and keeps them together when using Keep Both.
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
