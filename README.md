<div align="center">
  <h1>Graphics Workbench</h1>
  <img alt="GitHub License" src="https://img.shields.io/github/license/naatin777/Graphics-Workbench">
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/naatin777/Graphics-Workbench">
</div>

English | [日本語](README.ja.md)

This extension is designed to make PDF and image files easier to handle in VS Code.
It provides PDF splitting and cropping, conversion between PDF, image, SVG, Mermaid, and Draw.io files, and LaTeX code generation.

## Features

### PDF Operations

- **Crop**: Crops the margins of the selected PDF file.
- **Split**: Splits the selected PDF file into single-page PDFs.
- **Merge**: Merges multiple selected PDF files into one.

### Conversion

- **Output-format based conversion**: In the Explorer context menu, choose output formats such as `Convert > PDF`, `Convert > PNG`, `Convert > JPEG`, `Convert > WebP`, `Convert > AVIF`, `Convert > GIF`, `Convert > TIFF`, `Convert > EPS`, or `Convert > SVG`.
- **PDF / image / SVG / Mermaid / editable Draw.io conversion**: Convert supported inputs to the selected output format.
- **Native Draw.io PDF conversion**: Convert `.drawio` and `.dio` files into one PDF per page or one PDF containing all pages.
- **Mixed selection**: Convert multiple supported input formats to the same output format in one operation.
- **Safety rules**: Same-format conversion is rejected. Normal GIF/TIFF conversion uses only the first page/frame; the explicit animation preserve/split commands retain multiple frames.

### LaTeX Code Generation

- **Insert from PDF**: Drag and drop a PDF file into a LaTeX document to automatically insert the corresponding LaTeX code.
- **Insert from Image**: Paste a clipboard image into a LaTeX document, choose whether to save it as PDF or as an image, edit the output path, and insert the corresponding LaTeX code.

## Installation

You can install this extension in one of the following ways:

- **Visual Studio Code Marketplace**:
  Search for "Graphics Workbench" in the Extensions Marketplace within VS Code and install it.
  [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=naatin777.graphics-workbench)

- **Open VSX Registry**:
  It can also be installed from Open VSX, an alternative marketplace for VS Code.
  [Open VSX](https://open-vsx.org/extension/naatin777/graphics-workbench)

## Commands

| Feature                | Input                                                                                                        | Output                  | Use case                                   | Required external tools                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| Crop PDF margins       | `.pdf`                                                                                                       | `.pdf`                  | Remove margins from figure PDFs            | Ghostscript                                                      |
| Split PDF              | `.pdf`                                                                                                       | `.pdf`                  | Split a PDF into single pages              | None                                                             |
| Convert to PDF         | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`                                           | `.pdf`                  | Convert raster images to PDF               | None                                                             |
| Convert to PDF         | `.svg`, `.mmd`, `.mermaid`, editable Draw.io images                                                          | `.pdf`                  | Convert figure files to PDF                | Depends on input format                                          |
| Draw.io to split PDFs  | `.drawio`, `.dio`, editable Draw.io images                                                                   | Page PDFs               | Export each Draw.io page separately        | Draw.io Desktop                                                  |
| Draw.io to one PDF     | `.drawio`, `.dio`, editable Draw.io images                                                                   | One PDF                 | Export all Draw.io pages together          | Draw.io Desktop                                                  |
| Convert to PNG         | `.pdf`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images | `.png`                  | Convert figure files to PNG                | Poppler for PDF input                                            |
| Convert to JPEG        | `.pdf`, `.png`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images          | `.jpeg`                 | Convert figure files to JPEG               | Poppler for PDF input                                            |
| Convert to WebP        | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images  | `.webp`                 | Convert figure files to WebP               | Poppler for PDF input                                            |
| Convert to AVIF        | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images  | `.avif`                 | Convert figure files to AVIF               | Poppler for PDF input                                            |
| Convert to GIF         | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images | `.gif`                  | Convert figure files to GIF                | Poppler for PDF input                                            |
| Convert to TIFF        | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.svg`, Mermaid, editable Draw.io images          | `.tiff`                 | Convert figure files to TIFF               | Poppler for PDF input                                            |
| Convert to EPS         | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid                  | `.eps`                  | Convert figure files to EPS                | Poppler for PDF input, Ghostscript for non-PDF                   |
| Convert to SVG         | `.pdf`, `.eps`, `.mmd`, `.mermaid`, editable Draw.io images                                                  | `.svg`                  | Convert figure files to SVG                | Poppler for PDF, Chrome for Mermaid, Draw.io for editable images |
| Insert PDF into LaTeX  | `.pdf`                                                                                                       | LaTeX code              | Generate `figure` / `includegraphics` code | None                                                             |
| Insert clipboard image | Clipboard image                                                                                              | Image file + LaTeX code | Paste screenshots into LaTeX               | Depends on output format                                         |

GIF/TIFF input uses only the first page/frame. Use the explicit animation preserve/split commands for multi-frame output. EPS output is supported by this release. Same-format conversion is rejected.

## Required Tools

- **Draw.io**: The Draw.io desktop application is required to convert native Draw.io files (`.drawio`, `.dio`) and editable Draw.io images (`.drawio.png`, `.dio.png`, `.drawio.svg`, `.dio.svg`). Download it from [Draw.io](https://github.com/jgraph/drawio-desktop/releases).
- **Ghostscript**: Required for PDF margin detection during PDF cropping.
- **Poppler / `pdftocairo`**: Required for rendering PDF pages to PNG, JPEG, WebP, AVIF, or SVG. On macOS: `brew install poppler`. On Debian/Ubuntu: `apt install poppler-utils`.
- **rsvg-convert**: Required only when `graphics-workbench.convertToPdf.svg.engine` is set to `rsvg-convert`. It is provided by [librsvg](https://wiki.gnome.org/Projects/LibRsvg). On macOS: `brew install librsvg`. On Debian/Ubuntu: `apt install librsvg2-bin`.
- **Google Chrome / Chromium**: Required for Mermaid conversion and optional for SVG conversion when the Puppeteer browser is set to `chrome`.
- **Firefox**: Can be selected for SVG conversion with `graphics-workbench.puppeteer.browser` set to `firefox`.

## Configuration

Main settings:

| Setting                                                    | Default                                         | Description                                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `graphics-workbench.outputPath.clipboardImage`             | `${fileDirname}/${dateNow}`                     | Default output path shown when pasting a clipboard image. It can be edited during paste, and the extension is added automatically |
| `graphics-workbench.insertLatex.pdfTemplate`               | `\begin{figure}[H]...`                          | LaTeX template for PDF drop. Supports `${path}`, `${name}`, `${ext}`, `${dir}`. Set an array for snippet choices                  |
| `graphics-workbench.insertLatex.imageTemplate`             | `\begin{figure}[H]...`                          | LaTeX template for image paste. Supports `${path}`, `${name}`, `${ext}`, `${dir}`. Set an array for snippet choices               |
| `graphics-workbench.execPath.drawio`                       | empty string                                    | Path to Draw.io Desktop. If empty, the OS default command is used                                                                 |
| `graphics-workbench.execPath.ghostscript`                  | empty string                                    | Path to Ghostscript. If empty, the OS default command is used                                                                     |
| `graphics-workbench.execPath.pdftocairo`                   | `pdftocairo`                                    | Path to the `pdftocairo` executable                                                                                               |
| `graphics-workbench.execPath.rsvgConvert`                  | `rsvg-convert`                                  | Path to the `rsvg-convert` executable                                                                                             |
| `graphics-workbench.convertToPdf.svg.engine`               | `puppeteer`                                     | SVG to PDF backend. Choose `puppeteer` or `rsvg-convert`                                                                          |
| `graphics-workbench.puppeteer.browser`                     | `chrome`                                        | Browser used by Puppeteer for SVG conversion. Choose `chrome` or `firefox`                                                        |
| `graphics-workbench.puppeteer.executablePath`              | empty string                                    | Browser executable shared by SVG and Mermaid conversions; takes precedence over the channel                                       |
| `graphics-workbench.outputPath.convertDrawioToPdfDirectly` | `${fileDirname}/${fileBasenameNoExtension}.pdf` | Output path for the one-PDF Draw.io command                                                                                       |
| `graphics-workbench.convertToWebp.effort`                  | `4`                                             | Encoding effort for WebP output                                                                                                   |
| `graphics-workbench.convertToAvif.effort`                  | `4`                                             | Encoding effort for AVIF output                                                                                                   |

Output paths and LaTeX snippet candidates can also be changed from VS Code settings.

Command IDs use output-format names such as `convertToPdf`, but output paths use input/output pair names. Use `outputPath.convertPngToPdf` for a single output and an `outputPaths` entry such as `convertPdfToPng` when the template includes `${page}`. Format-based `outputPath.convertToPdf` settings and command-based `outputPaths.convertToPdf` entries are not used.

## Output Panel

Open **View → Output → Graphics Workbench** to see relevant command inputs, external tool failures, conflict decisions, committed outputs, and cleanup failures. Progress is shown in the VS Code notification.

## Safe Mode and Undo

Safe Mode is enabled by default and asks before an existing output is overwritten. Choose **Keep Both**, **Do Not Overwrite**, or **Overwrite**. Undo is available for the latest completed conversion, merge, crop, split, or clipboard paste and only reverts outputs that have not changed since they were created. Undo is kept in memory and is not available after the extension restarts.

Normal staging files are removed after a conversion, cancellation, failure, or successful Undo. An overwrite backup is kept only while it is needed by the current Undo record. The extension does not delete the whole runtime root at startup, so crash leftovers may remain; this protects another VS Code window's active staging, Undo backups, unknown directories, and diagnostic scratch. Diagnostic ASCII scratch files are managed separately and may be retained after an external-tool failure.
