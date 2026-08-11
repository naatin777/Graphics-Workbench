<div align="center">
  <h1>Graphics Workbench</h1>
  <img alt="GitHub License" src="https://img.shields.io/github/license/naatin777/Graphics-Workbench">
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/naatin777/Graphics-Workbench">
</div>

English | [日本語](README.ja.md)

Graphics Workbench lets you convert, crop, merge, reorder, preview, and insert the PDFs and images used in papers and technical documents without leaving VS Code. It supports LaTeX, Typst, Quarkdown, and general PDF/image processing workflows.

## Who it is for and what it solves

This extension is aimed at VS Code users who work with figures in papers, reports, and technical documents.

- Convert screenshots, plots, and figures to PDF
- Crop the margins of figure PDFs for use in a paper
- Combine several images into a single PDF
- Insert figures into LaTeX, Typst, or Quarkdown snippets

The value of Graphics Workbench is not any single conversion format but the whole flow: operate directly from the Explorer, edit a PDF while previewing it, resolve output conflicts safely, undo when needed, and finally place the figure into LaTeX, Typst, Quarkdown, or another technical document. There is no need to leave VS Code to run external tools by hand.

## Example workflows

### 1. Remove the margins of a PDF

1. Right-click the PDF in the Explorer
2. Choose **Crop PDF** → **Adjust Margins** (or **Auto crop** to do it automatically)
3. Review the margins in the preview
4. Remove the margins automatically or with explicit settings
5. Confirm the output path and overwrite policy, then save

### 2. Combine several images into one PDF

1. Select multiple images in the Explorer
2. Right-click → **Convert** → **Combine Images to PDF (Save As)** to choose the output location, or **Quick Combine Images to PDF** to combine immediately into `outputPath.combine.pdf`
3. Review the resulting PDF
4. Save the output

### 3. Insert a screenshot into LaTeX

1. Paste a clipboard image into your LaTeX document
2. Choose whether to save it as a PDF or as an image
3. Generate the output file and insert the LaTeX code
4. If needed, use **Undo Last Graphics Operation** to revert the previous step

## Safe Mode and Undo

Graphics Workbench is designed so existing files are never overwritten carelessly.

- **Safe Mode (enabled by default)**: before an existing output is overwritten, choose **Keep Both**, **Do Not Overwrite**, or **Overwrite**
- **Staging / backup**: outputs are written to a staging area first and committed on success. A pre-overwrite backup is kept while the Undo record needs it
- **Undo**: revert the latest completed conversion, merge, crop, split, reorder, rotate, or clipboard paste. Outputs changed since creation are not reverted
- **No incomplete outputs**: on failure or cancellation, no partial output is left at the destination

Convert confidently. Existing files are protected by default, and the latest graphics operation can be undone.

## Main capabilities

### PDF operations

- **Preview**: view a PDF in a read-only preview (`Reopen Editor With...` → Graphics Workbench PDF Preview)
- **Crop**: remove margins automatically or with explicit settings and a preview
- **Split**: split a PDF into single-page PDFs
- **Merge**: merge multiple PDFs into one (order can be reviewed)
- **Rotate**: rotate pages by 90°, 180°, or 270°
- **Reorder**: change the page order interactively
- **Compress / Encrypt / Decrypt**: reduce size, or protect with a password

### Preview

- **TIFF preview**: view single- and multi-page TIFF files in a read-only preview (`Reopen Editor With...` → Graphics Workbench TIFF Preview)

### Conversion

- Choose the output format (PDF / PNG / JPEG / WebP / AVIF / GIF / TIFF / SVG) from the Explorer context menu
- Convert between PDF, image, SVG, Mermaid, and Draw.io files
- Combine multiple images into one PDF
- Convert between animated GIF and WebP (preserve animation or split frames)
- Create editable `.drawio` / `.drawio.png` / `.drawio.svg` from a figure
- Convert native Draw.io files (`.drawio` / `.dio`) into one PDF per page or one PDF with all pages

### LaTeX code generation

- **Insert from PDF**: drag a PDF into a LaTeX document to insert the matching LaTeX code automatically
- **Insert from clipboard image**: paste an image, choose whether to save it as a PDF or as an image, edit the output path, and insert the matching LaTeX code

## Installation

You can install this extension in one of the following ways:

> Supported editors: Visual Studio Code, Cursor, and Devin Desktop (VS Code 1.125 or later).
> Other VS Code-compatible editors may work, but are not part of our compatibility testing.

### Visual Studio Code Marketplace

Search for "Graphics Workbench" in the Extensions Marketplace within VS Code and install it.

[Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=naatin777.graphics-workbench)

### Open VSX Registry

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

## Setup and external tools

Some features need external tools in addition to the VS Code extension. Install what you need for the features you use. Executable paths can be set in VS Code settings (`graphics-workbench.execPath.*`).

Open **Graphics Workbench Controls** from the status bar to see per-feature availability. Select an external-tool row to open its related setting, or select **Check again** to refresh the results. A missing tool does not fail the whole check.

| Tool                     | Purpose                                            | Required by                                                             | Notes                                                                                            |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| rsvg-convert             | SVG to PDF conversion                              | When the `rsvg-convert` backend is selected                             | One of the SVG conversion backends                                                               |
| Google Chrome / Chromium | SVG / Mermaid conversion                           | SVG to PDF, Mermaid to PDF/PNG/JPEG/WebP/AVIF/SVG                       | Used by the Chrome headless CLI                                                                  |
| Draw.io Desktop          | Draw.io file and editable Draw.io image conversion | `.drawio`, `.dio`, `.drawio.png`, `.dio.png`, `.drawio.svg`, `.dio.svg` | Requires the Draw.io desktop application                                                         |
| Mermaid CLI (`mmdc`)     | Mermaid rendering                                  | Mermaid to PDF/PNG/JPEG/WebP/AVIF/SVG                                   | Install `@mermaid-js/mermaid-cli` via npm globally, or set `graphics-workbench.execPath.mermaid` |

### To use every feature

To use all conversion features, the following tools are required:

- Draw.io Desktop
- One of the SVG conversion backends
  - `rsvg-convert`
  - Google Chrome / Chromium
- Google Chrome / Chromium and Mermaid CLI (`mmdc`) if you use Mermaid conversion

### About SVG to PDF conversion

SVG to PDF conversion requires one of the following tools:

```text
rsvg-convert or Google Chrome / Chromium
```

Use whichever conversion backend is available in your environment.

### Installation examples

#### macOS

```sh
brew install librsvg
npm install -g @mermaid-js/mermaid-cli
```

Homebrew is one example for macOS. The extension itself does not call Homebrew; it resolves external tools from each OS's `PATH` or the `graphics-workbench.execPath.*` settings.

Install Draw.io Desktop from:

[Draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases)

#### Debian / Ubuntu

```sh
sudo apt install librsvg2-bin
npm install -g @mermaid-js/mermaid-cli
```

Install Draw.io Desktop from:

[Draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases)

#### Windows

Install the following tools and, if necessary, set the path to the executables in VS Code settings.

- Draw.io Desktop
- Google Chrome / Chromium
- Mermaid CLI (`mmdc`) — `npm install -g @mermaid-js/mermaid-cli`

On Windows, use the Windows distributions of each tool or your organization's package manager instead of Homebrew. Add `rsvg-convert.exe` to `PATH`, or specify the executable paths in VS Code settings.

## Commands

| Feature                     | Input                                                                                                        | Output                                  | Use case                                                   | Required external tools                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Crop PDF margins            | `.pdf`                                                                                                       | `.pdf`                                  | Remove margins from figure PDFs (auto or configured)       | None                                            |
| Split PDF                   | `.pdf`                                                                                                       | `.pdf`                                  | Split a PDF into single pages (all pages or configured)    | None                                            |
| Merge PDFs                  | `.pdf` (multiple)                                                                                            | `.pdf`                                  | Merge PDFs into one (selected or configured)               | None                                            |
| Rotate PDF                  | `.pdf`                                                                                                       | `.pdf`                                  | Rotate pages by 90° / 180° / 270° (quick or page-selected) | None                                            |
| Reorder PDF                 | `.pdf`                                                                                                       | `.pdf`                                  | Change the page order interactively                        | None                                            |
| Compress PDF                | `.pdf`                                                                                                       | `.pdf`                                  | Recompress a PDF to reduce size                            | None                                            |
| Encrypt PDF                 | `.pdf`                                                                                                       | `.pdf`                                  | Protect a PDF with a password                              | None                                            |
| Decrypt PDF                 | `.pdf`                                                                                                       | `.pdf`                                  | Remove the password from a PDF                             | None                                            |
| Convert to PDF              | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`                                           | `.pdf`                                  | Convert raster images to PDF                               | None                                            |
| Convert to PDF              | `.svg`, `.mmd`, `.mermaid`, editable Draw.io images                                                          | `.pdf`                                  | Convert figure files to PDF                                | Depends on input format                         |
| Combine images to PDF       | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`                                           | `.pdf`                                  | Combine multiple images into one PDF                       | None                                            |
| Draw.io to split PDFs       | `.drawio`, `.dio`, editable Draw.io images                                                                   | Page PDFs                               | Export each Draw.io page separately                        | Draw.io Desktop                                 |
| Draw.io to one PDF          | `.drawio`, `.dio`, editable Draw.io images                                                                   | One PDF                                 | Export all Draw.io pages together                          | Draw.io Desktop                                 |
| Convert to PNG              | `.pdf`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images | `.png`                                  | Convert figure files to PNG                                |                                                 |
| Convert to JPEG             | `.pdf`, `.png`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images          | `.jpeg`                                 | Convert figure files to JPEG                               |                                                 |
| Convert to WebP             | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images  | `.webp`                                 | Convert figure files to WebP                               |                                                 |
| Convert to WebP (animation) | `.gif`                                                                                                       | `.webp`                                 | Preserve animation or split frames                         | None                                            |
| Convert to AVIF             | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images  | `.avif`                                 | Convert figure files to AVIF                               |                                                 |
| Convert to GIF              | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.tif`, `.tiff`, `.svg`, Mermaid, editable Draw.io images | `.gif`                                  | Convert figure files to GIF                                |                                                 |
| Convert to GIF (animation)  | `.webp`                                                                                                      | `.gif`                                  | Preserve animation or split frames                         | None                                            |
| Convert to TIFF             | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.svg`, Mermaid, editable Draw.io images          | `.tiff`                                 | Convert figure files to TIFF                               |                                                 |
| Convert to SVG              | `.pdf`, `.mmd`, `.mermaid`, editable Draw.io images                                                          | `.svg`                                  | Convert figure files to SVG                                | Chrome for Mermaid, Draw.io for editable images |
| Create Draw.io file         | `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.tif`, `.tiff`, `.svg`, `.mmd`, `.mermaid`       | `.drawio`, `.drawio.png`, `.drawio.svg` | Create a Draw.io file from a figure                        | Draw.io Desktop                                 |
| Insert PDF into LaTeX       | `.pdf`                                                                                                       | LaTeX code                              | Generate `figure` / `includegraphics` code                 | None                                            |
| Insert clipboard image      | Clipboard image                                                                                              | Image file + LaTeX code                 | Paste screenshots into LaTeX                               | Depends on output format                        |

Normal raster conversions use the first GIF/TIFF page or frame. Convert to PDF preserves all GIF/TIFF pages, including multi-page TIFFs with different page sizes; the explicit animation preserve/split commands retain their own multi-frame behavior. Same-format conversion is rejected.

## Configuration

Main settings:

| Setting                                        | Default                                                 | Description                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `graphics-workbench.outputPath.clipboardImage` | `${fileDirname}/${dateNow}`                             | Default output path shown when pasting a clipboard image. It can be edited during paste, and the extension is added automatically |
| `graphics-workbench.insertLatex.pdfTemplate`   | `\begin{figure}[H]...`                                  | LaTeX template for PDF drop. Supports `${path}`, `${name}`, `${ext}`, `${dir}`. Set an array for snippet choices                  |
| `graphics-workbench.insertLatex.imageTemplate` | `\begin{figure}[H]...`                                  | LaTeX template for image paste. Supports `${path}`, `${name}`, `${ext}`, `${dir}`. Set an array for snippet choices               |
| `graphics-workbench.execPath.drawio`           | `drawio`                                                | Command or path for Draw.io Desktop                                                                                               |
| `graphics-workbench.execPath.rsvgConvert`      | `rsvg-convert`                                          | Path to the `rsvg-convert` executable                                                                                             |
| `graphics-workbench.execPath.chrome`           | empty string                                            | Chrome executable for mmdc and Chrome SVG-to-PDF; uses the standard OS command/location when empty                                |
| `graphics-workbench.execPath.mermaid`          | `mmdc`                                                  | Path to the `mmdc` executable from `@mermaid-js/mermaid-cli`                                                                      |
| `graphics-workbench.convertToPdf.svg.engine`   | `chrome`                                                | SVG to PDF backend. Choose `chrome` or `rsvg-convert`                                                                             |
| `graphics-workbench.outputPath.single.pdf`     | `${fileDirname}/${fileBasenameNoExtension}.pdf`         | Output path template for a single-file conversion to PDF                                                                          |
| `graphics-workbench.outputPath.split.pdf`      | `${fileDirname}/${fileBasenameNoExtension}/${page}.pdf` | Output path template for multiple PDF outputs from one input (Split PDF, Draw.io page PDFs). Include `${page}`                    |
| `graphics-workbench.convertToWebp.effort`      | `4`                                                     | Encoding effort for WebP output                                                                                                   |
| `graphics-workbench.convertToAvif.effort`      | `4`                                                     | Encoding effort for AVIF output                                                                                                   |

Output paths and LaTeX snippet candidates can also be changed from VS Code settings.

Conversion output paths are chosen by the number of outputs, not the input format. A `single` conversion produces one file from one input and uses `outputPath.single.<format>`; a `split` conversion produces multiple files (PDF pages, animation frames, Draw.io pages) from one input and uses `outputPath.split.<format>` with `${page}`. Combine Images to PDF always asks for the output location.

## Output Panel

Open **View → Output → Graphics Workbench** to see relevant command inputs, external tool failures, conflict decisions, committed outputs, and cleanup failures. Progress is shown in the VS Code notification.

## Input size and processing time

Graphics Workbench does not impose a fixed limit on input file size or PDF page count.

The range of inputs that can be processed, the processing time, and the required resources depend on the input contents, the operation, the external tools used, and your computer's performance. Very large inputs can take a long time or fail with memory, disk, or external-tool errors.

You can cancel a running operation where possible. External processes (Draw.io, Mermaid CLI, etc.) are terminated, but depending on the processing method it may take some time for the cancellation to take effect.

## Troubleshooting

### A command fails

Check that the external tools are installed.

```sh
rsvg-convert --version
```

On Windows, the command may not be found depending on the executable name or `PATH` configuration. In that case, specify the executable path for each tool in VS Code settings.

### SVG to PDF conversion fails

Depending on the configured backend, check that `rsvg-convert` or Google Chrome / Chromium is available.

### Mermaid conversion fails

Check that Google Chrome / Chromium and the Mermaid CLI (`mmdc`) are available. Install `@mermaid-js/mermaid-cli` via npm globally, or set `graphics-workbench.execPath.mermaid` in VS Code settings. If necessary, set `graphics-workbench.execPath.chrome` for the browser path.

### Editable Draw.io image conversion fails

Check that Draw.io Desktop is installed. If necessary, set the executable path in `graphics-workbench.execPath.drawio`.

## License

GNU AGPL v3 or later (AGPL-3.0-or-later)
