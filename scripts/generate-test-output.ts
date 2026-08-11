import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import sharp, { type Sharp } from 'sharp';

const execFileAsync = promisify(execFile);
const repositoryDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inputDirectory = path.join(repositoryDirectory, 'test', 'input', 'valid');
const outputDirectory = path.join(repositoryDirectory, 'test', 'output');

await generateRasterOutputs();
await generatePdfOutputs();
await generateSvgOutputs();
await generateEpsOutputs();
await generateMermaidOutputs();
const configuredDrawioPathArgument = readDrawioPathArgument();
if (configuredDrawioPathArgument !== undefined) {
  await generateDrawioOutputs(configuredDrawioPathArgument);
}

async function generateRasterOutputs(): Promise<void> {
  for (const format of ['avif', 'gif', 'jpeg', 'png', 'tiff', 'webp']) {
    for (const inputPath of await listFiles(path.join(inputDirectory, format))) {
      if (inputPath.endsWith('animated-swirl.avif')) {
        continue;
      }

      const outputDataDirectory = path.join(outputDirectory, format, sourceName(inputPath));
      await mkdir(outputDataDirectory, { recursive: true });
      const input = await createSharpInput(inputPath);
      const metadata = await input.metadata();
      const page = metadata.pages !== undefined && metadata.pages > 1 ? 2 : undefined;
      const renderedInput = page === undefined ? input : sharp(inputPath, { page: page - 1, pages: 1 });

      await renderedInput.png().toFile(path.join(outputDataDirectory, 'expected.png'));
    }
  }
}

async function generatePdfOutputs(): Promise<void> {
  for (const inputPath of await listFiles(path.join(inputDirectory, 'pdf'))) {
    const outputDataDirectory = path.join(outputDirectory, 'pdf', sourceName(inputPath));
    await mkdir(outputDataDirectory, { recursive: true });
    const { countPdfPages } = await import('@graphics-workbench/core/operations/pdf/mupdf.js');
    const pageCount = await countPdfPages(new Uint8Array(await readFile(inputPath)));

    for (let page = 1; page <= pageCount; page += 1) {
      const outputPath = path.join(outputDataDirectory, `page-${String(page).padStart(3, '0')}.png`);
      await renderPdfPage(inputPath, page, outputPath);
    }
  }
}

async function generateSvgOutputs(): Promise<void> {
  for (const inputPath of await listFiles(path.join(inputDirectory, 'svg'))) {
    const outputDataDirectory = path.join(outputDirectory, 'svg', sourceName(inputPath));
    await mkdir(outputDataDirectory, { recursive: true });
    const metadata = await sharp(inputPath).metadata();
    if (metadata.width === undefined || metadata.height === undefined) {
      throw new Error(`Could not determine SVG dimensions: ${inputPath}`);
    }
    await execFileAsync('rsvg-convert', [
      '-w',
      String(metadata.width),
      '-h',
      String(metadata.height),
      '-o',
      path.join(outputDataDirectory, 'expected.png'),
      inputPath,
    ]);
  }
}

async function generateEpsOutputs(): Promise<void> {
  for (const inputPath of await listFiles(path.join(inputDirectory, 'eps'))) {
    const outputDataDirectory = path.join(outputDirectory, 'eps', sourceName(inputPath));
    await mkdir(outputDataDirectory, { recursive: true });
    const expectedPdfPath = path.join(outputDataDirectory, 'expected.pdf');
    const expectedPngPath = path.join(outputDataDirectory, 'expected.png');

    await execFileAsync('gs', [
      '-dSAFER',
      '-dNOPAUSE',
      '-dBATCH',
      '-dEPSCrop',
      '-sDEVICE=pdfwrite',
      `-sOutputFile=${expectedPdfPath}`,
      inputPath,
    ]);
    await renderPdfPage(expectedPdfPath, 1, expectedPngPath);
  }
}

async function generateMermaidOutputs(): Promise<void> {
  const configDirectory = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-fixtures-'));
  const mermaidConfigPath = path.join(configDirectory, 'mermaid-config.json');
  const chromeConfigPath = path.join(configDirectory, 'chrome-config.json');

  try {
    await writeFile(mermaidConfigPath, JSON.stringify({ theme: 'default' }), 'utf8');
    await writeFile(chromeConfigPath, JSON.stringify({ headless: true, channel: 'chrome' }), 'utf8');

    for (const inputPath of await listFiles(path.join(inputDirectory, 'mermaid'))) {
      const outputDataDirectory = path.join(outputDirectory, 'mermaid', sourceName(inputPath));
      await mkdir(outputDataDirectory, { recursive: true });

      for (const outputFormat of ['png', 'svg', 'pdf'] as const) {
        await execFileAsync(process.execPath, [
          path.join(repositoryDirectory, 'node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js'),
          '--input',
          inputPath,
          '--output',
          path.join(outputDataDirectory, `expected.${outputFormat}`),
          '--outputFormat',
          outputFormat,
          '--backgroundColor',
          'white',
          '--configFile',
          mermaidConfigPath,
          '--puppeteerConfigFile',
          chromeConfigPath,
          '--quiet',
        ]);
      }
    }
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
}

async function generateDrawioOutputs(drawioExecutablePath: string): Promise<void> {
  for (const inputPath of await listFiles(path.join(inputDirectory, 'drawio'))) {
    const outputDataDirectory = path.join(outputDirectory, 'drawio', drawioSourceName(inputPath));
    await mkdir(outputDataDirectory, { recursive: true });
    const expectedSvgPath = path.join(outputDataDirectory, 'expected.svg');
    const expectedPdfPath = path.join(outputDataDirectory, 'expected.pdf');
    const expectedPngPath = path.join(outputDataDirectory, 'expected.png');
    const pngSourcePdfPath = path.join(outputDataDirectory, 'render.pdf');

    await runDrawio(drawioExecutablePath, inputPath, expectedSvgPath, 'svg');
    if (inputPath.endsWith('.drawio') || inputPath.endsWith('.dio')) {
      await execFileAsync(drawioExecutablePath, [
        inputPath,
        '-o',
        expectedPdfPath,
        '-x',
        '-f',
        'pdf',
        '-t',
        '-a',
        '--crop',
      ]);
    } else {
      await runDrawio(drawioExecutablePath, inputPath, expectedPdfPath, 'pdf');
    }
    // The raster path renders Draw.io through a PDF export and crops white
    // margins (pdfcrop), so the oracle PNG must be produced the same way.
    // Pick the first page that actually contains content.
    await runDrawio(drawioExecutablePath, inputPath, pngSourcePdfPath, 'pdf');
    try {
      const { countPdfPages, hasPdfPageContent } = await import('@graphics-workbench/core/operations/pdf/mupdf.js');
      const pngSourceBytes = new Uint8Array(await readFile(pngSourcePdfPath));
      const pngSourcePageCount = await countPdfPages(pngSourceBytes);
      let pngSourcePage = 1;
      for (let candidate = 1; candidate <= pngSourcePageCount; candidate += 1) {
        if (await hasPdfPageContent(pngSourceBytes, candidate)) {
          pngSourcePage = candidate;
          break;
        }
      }
      await renderPdfPage(pngSourcePdfPath, pngSourcePage, expectedPngPath, true);
    } finally {
      await rm(pngSourcePdfPath, { force: true });
    }
  }
}

async function runDrawio(
  drawioExecutablePath: string,
  inputPath: string,
  outputPath: string,
  outputFormat: 'png' | 'svg' | 'pdf',
): Promise<void> {
  await execFileAsync(drawioExecutablePath, ['-x', '-f', outputFormat, '-o', outputPath, inputPath], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

function readDrawioPathArgument(): string | undefined {
  const argument = process.argv.find((value) => value.startsWith('--drawio-path='));
  const configuredPath = argument?.slice('--drawio-path='.length).trim();
  return configuredPath === undefined || configuredPath === '' ? undefined : configuredPath;
}

async function createSharpInput(inputPath: string): Promise<Sharp> {
  return sharp(inputPath);
}

async function renderPdfPage(sourcePath: string, page: number, outputPath: string, cropContent = false): Promise<void> {
  const { renderPdfPageToPng } = await import('@graphics-workbench/core/operations/pdf/mupdf.js');
  const png = await renderPdfPageToPng(new Uint8Array(await readFile(sourcePath)), page, {
    cropContent: cropContent || undefined,
  });
  await writeFile(outputPath, png);
}

async function listFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  // oxlint-disable-next-line typescript/no-unsafe-call -- strip-types script types are not resolved by type-aware lint
  return paths
    .flat()
    .filter((entryPath) => !entryPath.endsWith('.json'))
    .toSorted();
}

function sourceName(inputPath: string): string {
  return path.basename(inputPath, path.extname(inputPath));
}

function drawioSourceName(inputPath: string): string {
  return path.basename(inputPath).replace(/\.(?:drawio|dio)(?:\.(?:png|svg))?$/iu, '');
}
