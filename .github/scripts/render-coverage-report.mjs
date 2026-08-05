import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** @typedef {Map<number, number>} LineCoverage */
/** @typedef {Map<string, LineCoverage>} CoverageMap */
/** @typedef {{ total: number; covered: number; uncovered: number; percent: number }} FileCoverage */
/** @typedef {{ files: Map<string, FileCoverage>; total: number; covered: number; percent: number; uncoveredFiles: number }} CoverageSummary */
/** @typedef {{ os: string; summary: CoverageSummary }} ExtensionReport */
/** @typedef {{ path: string; byOs: Map<string, FileCoverage | undefined>; maxUncovered: number }} PriorityFile */

const EXTENSION_REPORTS = [
  ['Linux', 'vscode-extension-host-coverage-Linux/lcov.info'],
  ['macOS', 'vscode-extension-host-coverage-macOS/lcov.info'],
  ['Windows', 'vscode-extension-host-coverage-Windows/lcov.info'],
];

const WEBVIEW_REPORTS = [
  ['crop_pdf', 'webview-vitest-coverage/crop_pdf/lcov.info'],
  ['merge_pdf', 'webview-vitest-coverage/merge_pdf/lcov.info'],
  ['split_pdf', 'webview-vitest-coverage/split_pdf/lcov.info'],
];

const PRIORITY_FILE_LIMIT = 15;

/**
 * @template T
 * @param {T[]} values
 * @param {(left: T, right: T) => number} compare
 * @returns {T[]}
 */
function sortCopy(values, compare) {
  return values.toSorted(compare);
}

/**
 * @param {Array<string | undefined>} argv
 * @returns {{ input: string; output: string }}
 */
function readArguments(argv) {
  /** @type {Map<string, string>} */
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || key === '' || !key.startsWith('--') || value === undefined) {
      throw new Error('Usage: render-coverage-report.mjs --input <directory> --output <file>');
    }
    values.set(key.slice(2), value);
  }

  const input = values.get('input');
  const output = values.get('output');
  if (input === undefined || input === '' || output === undefined || output === '') {
    throw new Error('Both --input and --output are required');
  }
  return { input, output };
}

/**
 * @param {string} source
 * @param {string | undefined} fallbackPrefix
 * @returns {string}
 */
function normalizeSourcePath(source, fallbackPrefix) {
  const normalized = source.replaceAll('\\', '/');

  const webviewIndex = normalized.lastIndexOf('/webview/');
  if (webviewIndex >= 0) {
    return normalized.slice(webviewIndex + 1);
  }
  if (normalized.startsWith('webview/')) {
    return normalized;
  }

  if (fallbackPrefix !== undefined && fallbackPrefix !== '') {
    const sharedIndex = normalized.lastIndexOf('/shared/');
    if (sharedIndex >= 0) {
      return `webview/${normalized.slice(sharedIndex + 1)}`;
    }
  }

  const srcIndex = normalized.lastIndexOf('/src/');
  if (srcIndex >= 0) {
    return normalized.slice(srcIndex + 1);
  }
  if (normalized.startsWith('src/')) {
    return fallbackPrefix !== undefined && fallbackPrefix !== '' ? `${fallbackPrefix}${normalized}` : normalized;
  }

  const relative = normalized.replace(/^(?:[A-Za-z]:)?\/+|^\.\//u, '');
  return fallbackPrefix !== undefined && fallbackPrefix !== '' ? `${fallbackPrefix}${relative}` : relative;
}

/**
 * @param {string} content
 * @param {string | undefined} fallbackPrefix
 * @returns {CoverageMap}
 */
function parseLcov(content, fallbackPrefix) {
  /** @type {CoverageMap} */
  const files = new Map();
  let currentPath;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) {
      currentPath = normalizeSourcePath(line.slice(3), fallbackPrefix);
      if (!files.has(currentPath)) {
        files.set(currentPath, new Map());
      }
      continue;
    }
    if (currentPath === undefined || currentPath === '' || !line.startsWith('DA:')) {
      continue;
    }

    const [lineNumberText, hitsText] = line.slice(3).split(',', 2);
    const lineNumber = Number(lineNumberText);
    const hits = Number(hitsText);
    if (!Number.isFinite(lineNumber)) {
      continue;
    }

    const lines = files.get(currentPath);
    if (!lines) {
      throw new Error(`Coverage file was not initialized: ${currentPath}`);
    }
    lines.set(lineNumber, (lines.get(lineNumber) ?? 0) + (Number.isFinite(hits) ? hits : 0));
  }

  return files;
}

/**
 * @param {CoverageMap[]} maps
 * @returns {CoverageMap}
 */
function mergeCoverageMaps(maps) {
  /** @type {CoverageMap} */
  const merged = new Map();
  for (const files of maps) {
    for (const [filePath, lines] of files) {
      if (!merged.has(filePath)) {
        merged.set(filePath, new Map());
      }
      const target = merged.get(filePath);
      if (!target) {
        throw new Error(`Coverage file was not initialized: ${filePath}`);
      }
      for (const [lineNumber, hits] of lines) {
        target.set(lineNumber, (target.get(lineNumber) ?? 0) + hits);
      }
    }
  }
  return merged;
}

/**
 * @param {CoverageMap} lineCoverage
 * @param {(filePath: string) => boolean} includeFile
 * @returns {CoverageSummary}
 */
function summarize(lineCoverage, includeFile) {
  /** @type {Map<string, FileCoverage>} */
  const files = new Map(
    [...lineCoverage.entries()]
      .filter(([filePath]) => includeFile(filePath))
      .map(([filePath, lines]) => {
        const total = lines.size;
        const covered = [...lines.values()].filter((hits) => hits > 0).length;
        return [
          filePath,
          {
            total,
            covered,
            uncovered: total - covered,
            percent: total === 0 ? 0 : (covered / total) * 100,
          },
        ];
      }),
  );

  const values = [...files.values()];
  let total = 0;
  let covered = 0;
  for (const file of values) {
    total += file.total;
    covered += file.covered;
  }
  return {
    files,
    total,
    covered,
    percent: total === 0 ? 0 : (covered / total) * 100,
    uncoveredFiles: values.filter((file) => file.total > 0 && file.covered === 0).length,
  };
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function sourceLink(filePath) {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const coverageSha = process.env.COVERAGE_SOURCE_SHA;
  const sha = coverageSha === undefined || coverageSha === '' ? process.env.GITHUB_SHA : coverageSha;
  if (
    server === undefined ||
    server === '' ||
    repository === undefined ||
    repository === '' ||
    sha === undefined ||
    sha === ''
  ) {
    return `\`${filePath}\``;
  }
  return `[\`${filePath}\`](${server}/${repository}/blob/${sha}/${filePath})`;
}

/**
 * @param {FileCoverage | undefined} file
 * @returns {string}
 */
function coverageCell(file) {
  return file ? `${file.percent.toFixed(1)}% · ${file.uncovered} lines` : '—';
}

/**
 * @param {ExtensionReport[]} reports
 * @returns {PriorityFile[]}
 */
function collectCrossPlatformPriorityFiles(reports) {
  const paths = new Set(reports.flatMap((report) => [...report.summary.files.keys()]));
  /** @type {PriorityFile[]} */
  const files = [...paths].map((filePath) => {
    /** @type {Map<string, FileCoverage | undefined>} */
    const byOs = new Map(reports.map((report) => [report.os, report.summary.files.get(filePath)]));
    const maxUncovered = Math.max(...[...byOs.values()].map((file) => file?.uncovered ?? 0));
    return { path: filePath, byOs, maxUncovered };
  });
  /** @type {PriorityFile[]} */
  const sortedFiles = sortCopy(
    files.filter((file) => file.maxUncovered > 0),
    (left, right) => right.maxUncovered - left.maxUncovered || left.path.localeCompare(right.path),
  ).slice(0, PRIORITY_FILE_LIMIT);
  return sortedFiles;
}

/**
 * @param {ExtensionReport[]} reports
 * @returns {Array<{ path: string; byOs: Map<string, FileCoverage | undefined> }>}
 */
function collectCrossPlatformUncoveredFiles(reports) {
  const paths = new Set(reports.flatMap((report) => [...report.summary.files.keys()]));
  /** @type {Array<{ path: string; byOs: Map<string, FileCoverage | undefined> }>} */
  const files = [...paths].map((filePath) => ({
    path: filePath,
    byOs: new Map(reports.map((report) => [report.os, report.summary.files.get(filePath)])),
  }));
  /** @type {Array<{ path: string; byOs: Map<string, FileCoverage | undefined> }>} */
  const sortedFiles = sortCopy(
    files.filter((file) =>
      [...file.byOs.values()].some((entry) => entry !== undefined && entry.total > 0 && entry.covered === 0),
    ),
    (left, right) => left.path.localeCompare(right.path),
  );
  return sortedFiles;
}

/**
 * @param {CoverageSummary} summary
 * @returns {Array<[string, FileCoverage]>}
 */
function collectPriorityFiles(summary) {
  /** @type {Array<[string, FileCoverage]>} */
  const files = [...summary.files.entries()].filter(([, file]) => file.uncovered > 0);
  /** @type {Array<[string, FileCoverage]>} */
  const sortedFiles = sortCopy(
    files,
    (left, right) => right[1].uncovered - left[1].uncovered || left[0].localeCompare(right[0]),
  ).slice(0, PRIORITY_FILE_LIMIT);
  return sortedFiles;
}

/**
 * @param {CoverageSummary} summary
 * @returns {Array<[string, FileCoverage]>}
 */
function collectUncoveredFiles(summary) {
  /** @type {Array<[string, FileCoverage]>} */
  const files = [...summary.files.entries()].filter(([, file]) => file.total > 0 && file.covered === 0);
  /** @type {Array<[string, FileCoverage]>} */
  const sortedFiles = sortCopy(files, (left, right) => left[0].localeCompare(right[0]));
  return sortedFiles;
}

function actionsRunUrl() {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (
    server === undefined ||
    server === '' ||
    repository === undefined ||
    repository === '' ||
    runId === undefined ||
    runId === ''
  ) {
    return undefined;
  }
  return `${server}/${repository}/actions/runs/${runId}`;
}

/**
 * @param {string[]} output
 * @param {ExtensionReport[]} reports
 */
function renderExtensionCoverage(output, reports) {
  output.push(
    '### Extension Host',
    '',
    '| OS | Line coverage | covered / total | Source files | 0% files |',
    '|---|---:|---:|---:|---:|',
  );

  for (const report of reports) {
    output.push(
      `| ${report.os} | ${report.summary.percent.toFixed(1)}% | ${report.summary.covered}/${report.summary.total} | ${report.summary.files.size} | ${report.summary.uncoveredFiles} |`,
    );
  }

  output.push(
    '',
    '<details>',
    '<summary><strong>High-priority Extension Host files</strong></summary>',
    '',
    'Sorted by the highest number of uncovered lines. Each cell shows `coverage % · uncovered lines`.',
    '',
    '| File | Linux | macOS | Windows |',
    '|---|---:|---:|---:|',
  );

  for (const file of collectCrossPlatformPriorityFiles(reports)) {
    output.push(
      `| ${sourceLink(file.path)} | ${coverageCell(file.byOs.get('Linux'))} | ${coverageCell(file.byOs.get('macOS'))} | ${coverageCell(file.byOs.get('Windows'))} |`,
    );
  }

  output.push('', '</details>');

  const uncoveredFiles = collectCrossPlatformUncoveredFiles(reports);
  output.push(
    '',
    '<details>',
    `<summary><strong>Fully uncovered Extension Host files (${uncoveredFiles.length})</strong></summary>`,
    '',
  );

  if (uncoveredFiles.length === 0) {
    output.push('There are no fully uncovered files.');
  } else {
    output.push('| File | Linux | macOS | Windows |', '|---|---:|---:|---:|');
    for (const file of uncoveredFiles) {
      output.push(
        `| ${sourceLink(file.path)} | ${coverageCell(file.byOs.get('Linux'))} | ${coverageCell(file.byOs.get('macOS'))} | ${coverageCell(file.byOs.get('Windows'))} |`,
      );
    }
  }

  output.push(
    '',
    '</details>',
    '',
    '> Windows currently has `includeAll` disabled, so files that are not loaded are excluded from the population and shown as `—`.',
  );
}

/**
 * @param {string[]} output
 * @param {CoverageSummary} summary
 */
function renderWebviewCoverage(output, summary) {
  output.push(
    '',
    '### Webview (Vitest / Linux)',
    '',
    '<details>',
    '<summary><strong>Webview summary</strong></summary>',
    '',
    'Line-level Vitest coverage for Crop PDF, Merge PDF, and Split PDF is merged with shared code deduplicated.',
    '',
    '| Line coverage | covered / total | Source files | 0% files |',
    '|---:|---:|---:|---:|',
    `| ${summary.percent.toFixed(1)}% | ${summary.covered}/${summary.total} | ${summary.files.size} | ${summary.uncoveredFiles} |`,
    '',
    '</details>',
    '',
    '<details>',
    '<summary><strong>High-priority Webview files</strong></summary>',
    '',
    '| File | Coverage | Uncovered lines |',
    '|---|---:|---:|',
  );

  for (const [filePath, file] of collectPriorityFiles(summary)) {
    output.push(`| ${sourceLink(filePath)} | ${file.percent.toFixed(1)}% | ${file.uncovered} |`);
  }

  output.push('', '</details>');

  const uncoveredFiles = collectUncoveredFiles(summary);
  output.push(
    '',
    '<details>',
    `<summary><strong>Fully uncovered Webview files (${uncoveredFiles.length})</strong></summary>`,
    '',
  );

  if (uncoveredFiles.length === 0) {
    output.push('There are no fully uncovered files.');
  } else {
    output.push('| File | Lines |', '|---|---:|');
    for (const [filePath, file] of uncoveredFiles) {
      output.push(`| ${sourceLink(filePath)} | ${file.total} |`);
    }
  }

  output.push('', '</details>');
}

/**
 * @param {ExtensionReport[]} extensionReports
 * @param {CoverageSummary} webviewSummary
 * @returns {string}
 */
function renderReport(extensionReports, webviewSummary) {
  const output = ['## Automated Test Coverage', ''];
  renderExtensionCoverage(output, extensionReports);
  renderWebviewCoverage(output, webviewSummary);

  output.push(
    '',
    '> Playwright Electron runs as E2E tests on Linux, macOS, and Windows but is not included in coverage aggregation.',
  );

  const runUrl = actionsRunUrl();
  output.push(
    '',
    runUrl !== undefined && runUrl !== ''
      ? `[Line-level HTML reports are available from the Actions artifacts.](${runUrl})`
      : 'Line-level HTML reports are available from the Actions artifacts.',
    '',
    '<!-- graphics-workbench-coverage-report -->',
  );
  return `${output.join('\n')}\n`;
}

const { input, output } = readArguments(process.argv.slice(2));

/** @type {ExtensionReport[]} */
const extensionReports = [];
for (const [os, relativePath] of EXTENSION_REPORTS) {
  const content = await readFile(path.join(input, relativePath), 'utf8');
  const summary = summarize(parseLcov(content), (filePath) => filePath.startsWith('src/'));
  if (summary.files.size === 0) {
    throw new Error(`${os} Extension Host coverage is empty`);
  }
  extensionReports.push({ os, summary });
}

/** @type {CoverageMap[]} */
const webviewCoverageMaps = [];
for (const [appName, relativePath] of WEBVIEW_REPORTS) {
  const content = await readFile(path.join(input, relativePath), 'utf8');
  webviewCoverageMaps.push(parseLcov(content, `webview/apps/${appName}/`));
}
const webviewSummary = summarize(mergeCoverageMaps(webviewCoverageMaps), (filePath) => filePath.startsWith('webview/'));
if (webviewSummary.files.size === 0) {
  throw new Error('Webview coverage is empty');
}

await writeFile(output, renderReport(extensionReports, webviewSummary), 'utf8');
