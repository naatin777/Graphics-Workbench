import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { run as runMermaidCli } from '@mermaid-js/mermaid-cli';
import sharp, { type Sharp } from 'sharp';

const execFileAsync = promisify(execFile);
const repositoryDirectory = process.cwd();
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
  for (const format of ['avif', 'gif', 'jpeg', 'png', 'raw', 'tiff', 'webp']) {
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
      const preparedInput = inputPath.endsWith('.raw')
        ? sharp(await readFile(inputPath), { raw: rawOptions(await readFile(`${inputPath}.json`)) })
        : renderedInput;

      await preparedInput.png().toFile(path.join(outputDataDirectory, 'expected.png'));

      if (format === 'png') {
        const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        await writeFile(path.join(outputDataDirectory, 'expected.raw'), data);
        await writeFile(
          path.join(outputDataDirectory, 'expected.raw.json'),
          `${JSON.stringify(
            {
              version: 1,
              width: info.width,
              height: info.height,
              channels: info.channels,
              depth: 'uchar',
              colourspace: 'srgb',
              alpha: true,
              layout: 'interleaved',
            },
            null,
            2,
          )}\n`,
        );
      }
    }
  }
}

async function generatePdfOutputs(): Promise<void> {
  for (const inputPath of await listFiles(path.join(inputDirectory, 'pdf'))) {
    const outputDataDirectory = path.join(outputDirectory, 'pdf', sourceName(inputPath));
    await mkdir(outputDataDirectory, { recursive: true });
    const document = await import('pdf-lib').then(async ({ PDFDocument }) =>
      PDFDocument.load(await readFile(inputPath)),
    );

    for (let page = 1; page <= document.getPageCount(); page += 1) {
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
  for (const inputPath of await listFiles(path.join(inputDirectory, 'mermaid'))) {
    const outputDataDirectory = path.join(outputDirectory, 'mermaid', sourceName(inputPath));
    await mkdir(outputDataDirectory, { recursive: true });

    for (const outputFormat of ['png', 'svg', 'pdf'] as const) {
      await runMermaidCli(inputPath, path.join(outputDataDirectory, `expected.${outputFormat}`), {
        outputFormat,
        puppeteerConfig: { headless: true, channel: 'chrome' },
        quiet: true,
        parseMMDOptions: {
          backgroundColor: 'white',
          mermaidConfig: { theme: 'default' },
        },
      });
    }
  }
}

async function generateDrawioOutputs(drawioExecutablePath: string): Promise<void> {
  for (const inputPath of await listFiles(path.join(inputDirectory, 'drawio'))) {
    const outputDataDirectory = path.join(outputDirectory, 'drawio', drawioSourceName(inputPath));
    await mkdir(outputDataDirectory, { recursive: true });
    const expectedSvgPath = path.join(outputDataDirectory, 'expected.svg');
    const expectedPdfPath = path.join(outputDataDirectory, 'expected.pdf');
    const expectedPngPath = path.join(outputDataDirectory, 'expected.png');

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
      await runDrawio(drawioExecutablePath, inputPath, expectedPngPath, 'png');
    } else {
      await runDrawio(drawioExecutablePath, inputPath, expectedPdfPath, 'pdf');
      await renderPdfPage(expectedPdfPath, 1, expectedPngPath);
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
  if (inputPath.endsWith('.raw')) {
    return sharp(await readFile(inputPath), { raw: rawOptions(await readFile(`${inputPath}.json`)) });
  }
  return sharp(inputPath);
}

function rawOptions(serializedSidecar: Buffer): { width: number; height: number; channels: 1 | 2 | 3 | 4 } {
  const sidecar: unknown = JSON.parse(serializedSidecar.toString());
  if (!isRawSidecar(sidecar)) {
    throw new Error('Invalid Raw sidecar.');
  }
  return { width: sidecar.width, height: sidecar.height, channels: sidecar.channels };
}

function isRawSidecar(value: unknown): value is { width: number; height: number; channels: 1 | 2 | 3 | 4 } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('width' in value) ||
    !('height' in value) ||
    !('channels' in value)
  ) {
    return false;
  }
  return (
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    (value.channels === 1 || value.channels === 2 || value.channels === 3 || value.channels === 4)
  );
}

async function renderPdfPage(sourcePath: string, page: number, outputPath: string): Promise<void> {
  const outputPrefix = outputPath.slice(0, -path.extname(outputPath).length);
  await execFileAsync('pdftocairo', [
    '-png',
    '-singlefile',
    '-f',
    String(page),
    '-l',
    String(page),
    sourcePath,
    outputPrefix,
  ]);
}

async function listFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
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
