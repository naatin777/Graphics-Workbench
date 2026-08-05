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

- **Crop**: Crops the margins of the selected PDF file. Auto crop and configurable crop are available.
- **Split**: Splits the selected PDF file into single-page PDFs. Split all pages or configure the split interactively.
- **Merge**: Merges multiple selected PDF files into one. Merge the selected files or configure the merge interactively.
- **Rotate**: Rotates the pages of a PDF by 90°, 180°, or 270°. Quick rotate and configurable rotate (select pages) are available.
- **Reorder**: Changes the page order of a PDF interactively.
- **Compress**: Recompresses a PDF to reduce its size.
- **Linearize**: Linearizes a PDF for fast web viewing.
- **Encrypt / Decrypt**: Protects a PDF with a password or removes its password.

### Conversion

- **Output-format based conversion**: In the Explorer context menu, choose output formats such as `Convert > PDF`, `Convert > PNG`, `Convert > JPEG`, `Convert > WebP`, `Convert > AVIF`, `Convert > GIF`, `Convert > TIFF`, `Convert > EPS`, or `Convert > SVG`.
- **PDF / image / SVG / Mermaid / editable Draw.io conversion**: Convert supported inputs to the selected output format.
- **Multiple images to a single PDF**: Combine multiple selected images into one PDF.
- **Animation preserve / frame split**: Preserve the animation or split frames when converting between animated GIF and WebP.
- **Create Draw.io files**: Convert a figure to a native `.drawio` file or to an editable `.drawio.png` / `.drawio.svg` image.
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

### Platform-specific packages

Graphics Workbench is published as a separate VSIX per OS and CPU architecture, each containing the matching native `sharp` binaries. Normal installs from Marketplace / Open VSX let VS Code automatically select the package for your environment.

| Environment         | Package        |
| ------------------- | -------------- |
| Windows Intel/AMD   | `win32-x64`    |
| Windows ARM         | `win32-arm64`  |
| Intel Mac           | `darwin-x64`   |
| Apple Silicon Mac   | `darwin-arm64` |
| Linux x64 (glibc)   | `linux-x64`    |
| Linux ARM64 (glibc) | `linux-arm64`  |

When manually picking a VSIX from GitHub Releases, choose the file matching your environment from the table above.

With Remote SSH / WSL / Dev Container, the extension runs in the remote Extension Host, so the package for the remote OS and CPU is installed. VS Code selects it automatically.

Unsupported environments (Alpine Linux / musl, ARM32, and other environments without a `sharp` binary) are not supported; no Universal fallback package is provided.

## Commands

| Feature                     | Input                                                                                                                | Output                                  | Use case                                                   | Required external tools                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Crop PDF margins            | `.pdf`                                                                                                               | `.pdf`                                  | Remove margins from figure PDFs (auto or configured)       | Ghostscript                                                      |
| Split PDF                   | `.pdf`                                                                                                               | `.pdf`                                  | Split a PDF into single pages (all pages or configured)    | None                                                             |
| Merge PDFs                  | `.pdf` (multiple)                                                                                                    | `.pdf`                                  | Merge PDFs into one (selected or configured)               | None                                                             |
| Rotate PDF                  | `.pdf`                                                                                                               | `.pdf`                                  | Rotate pages by 90° / 180° / 270° (quick or page-selected) | None                                                             |
| Reorder PDF                 | `.pdf`                                                                                                               | `.pdf`                                  | Change the page order interactively                        | None                                                             |
| Compress PDF                | `.pdf`                                                                                                               | `.pdf`                                  | Recompress a PDF to reduce size                            | None                                                             |
| Linearize PDF               | `.pdf`                                                                                                               | `.pdf`                                  | Linearize a PDF for fast web viewing                       | qpdf                                                             |
| Encrypt PDF                 | `.pdf`                                                                                                               | `.pdf`                                  | Protect a PDF with a password                              | qpdf                                                             |
| Decrypt PDF                 | `.pdf`                                                                                                               | `.pdf`                                  | Remove the password from a PDF                             | qpdf                                                             |
| Convert to PDF              | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`                                                   | `.pdf`                                  | Convert raster images to PDF                               | None                                                             |
| Convert to PDF              | `.svg`, `.mmd`, `.mermaid`, editable Draw.io images                                                                  | `.pdf`                                  | Convert figure files to PDF                                | Depends on input format                                          |
| Combine images to PDF       | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`                                                   | `.pdf`                                  | Combine multiple images into one PDF                       | None                                                             |
| Draw.io to split PDFs       | `.drawio`, `.dio`, editable Draw.io images                                                                           | Page PDFs                               | Export each Draw.io page separately                        | Draw.io Desktop                                                  |
| Draw.io to one PDF          | `.drawio`, `.dio`, editable Draw.io images                                                                           | One PDF                                 | Export all Draw.io pages together                          | Draw.io Desktop                                                  |
| Convert to PNG              | `.pdf`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images         | `.png`                                  | Convert figure files to PNG                                | Poppler for PDF input                                            |
| Convert to JPEG             | `.pdf`, `.png`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images                  | `.jpeg`                                 | Convert figure files to JPEG                               | Poppler for PDF input                                            |
| Convert to WebP             | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images          | `.webp`                                 | Convert figure files to WebP                               | Poppler for PDF input                                            |
| Convert to WebP (animation) | `.gif`                                                                                                               | `.webp`                                 | Preserve animation or split frames                         | None                                                             |
| Convert to AVIF             | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images          | `.avif`                                 | Convert figure files to AVIF                               | Poppler for PDF input                                            |
| Convert to GIF              | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images         | `.gif`                                  | Convert figure files to GIF                                | Poppler for PDF input                                            |
| Convert to GIF (animation)  | `.webp`                                                                                                              | `.gif`                                  | Preserve animation or split frames                         | None                                                             |
| Convert to TIFF             | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.svg`, Mermaid, editable Draw.io images                  | `.tiff`                                 | Convert figure files to TIFF                               | Poppler for PDF input                                            |
| Convert to EPS              | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images | `.eps`                                  | Convert figure files to EPS                                | Poppler for PDF input, Ghostscript for non-PDF                   |
| Convert to SVG              | `.pdf`, `.eps`, `.mmd`, `.mermaid`, editable Draw.io images                                                          | `.svg`                                  | Convert figure files to SVG                                | Poppler for PDF, Chrome for Mermaid, Draw.io for editable images |
| Create Draw.io file         | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.eps`, `.svg`, `.mmd`, `.mermaid`       | `.drawio`, `.drawio.png`, `.drawio.svg` | Create a Draw.io file from a figure                        | Draw.io Desktop                                                  |
| Insert PDF into LaTeX       | `.pdf`                                                                                                               | LaTeX code                              | Generate `figure` / `includegraphics` code                 | None                                                             |
| Insert clipboard image      | Clipboard image                                                                                                      | Image file + LaTeX code                 | Paste screenshots into LaTeX                               | Depends on output format                                         |

GIF/TIFF input uses only the first page/frame. Use the explicit animation preserve/split commands for multi-frame output. Same-format conversion is rejected. EPS output is supported by this release; native `.drawio` / `.dio` files are not EPS inputs.

## Required Tools

- **Draw.io**: The Draw.io desktop application is required to convert native Draw.io files (`.drawio`, `.dio`) and editable Draw.io images (`.drawio.png`, `.dio.png`, `.drawio.svg`, `.dio.svg`). Download it from [Draw.io](https://github.com/jgraph/drawio-desktop/releases).
- **Ghostscript**: Required for PDF margin detection during PDF cropping. If `graphics-workbench.execPath.ghostscript` is empty, the extension uses `gs` on macOS/Linux and `gswin64c` on Windows, resolved from `PATH`.
- **Poppler / `pdftocairo`**: Required for rendering PDF pages to PNG, JPEG, WebP, AVIF, or SVG. Install it using the package manager or installer for your OS, then make `pdftocairo` available on `PATH` or set `graphics-workbench.execPath.pdftocairo`.
- **rsvg-convert**: Required only when `graphics-workbench.convertToPdf.svg.engine` is set to `rsvg-convert`. It is provided by [librsvg](https://wiki.gnome.org/Projects/LibRsvg). Install it using the package manager or installer for your OS, then make `rsvg-convert` available on `PATH` or set `graphics-workbench.execPath.rsvgConvert`.
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

Normal staging files are removed after a conversion, cancellation, failure, or successful Undo. An overwrite backup is kept only while it is needed by the current Undo record. Password-protected PDF encryption/decryption uses a per-user OS temporary directory, passes qpdf secrets through a private job-json file instead of process arguments, and never copies the source PDF into the workspace staging directory. The extension records the temporary root's PID and start time and removes abandoned PDF roots on the next activation; an active root is preserved for Undo until its normal retention policy expires. Diagnostic ASCII scratch files are managed separately and may be retained after an external-tool failure.

## Input size and processing time

Graphics Workbench does not impose a fixed limit on input file size or PDF page count.

The range of inputs that can be processed, the processing time, and the required resources depend on the input contents, the operation, the external tools used, and your computer's performance. Very large inputs can take a long time or fail with memory, disk, or external-tool errors.

You can cancel a running operation where possible. External processes (Ghostscript, qpdf, Poppler, etc.) are terminated, but depending on the processing method it may take some time for the cancellation to take effect.
