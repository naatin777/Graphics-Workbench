import { pathToFileURL } from 'node:url';

/**
 * Renders the Playwright screenshot PR comment body from screenshot file names.
 * File names are passed as CLI arguments; the markdown is written to stdout.
 */

/** @typedef {{
 *   kind: 'snapshot' | 'failure';
 *   spec: string;
 *   theme: string;
 *   platform?: string;
 *   kindName?: string;
 *   name: string;
 * }} Screenshot
 */

const PLATFORMS = new Set(['darwin', 'linux', 'win32']);
/** @type {Map<string, string>} */
const PLATFORM_LABELS = new Map([
  ['darwin', 'macOS'],
  ['linux', 'Linux'],
  ['win32', 'Windows'],
]);
const PLATFORM_ORDER = ['darwin', 'linux', 'win32'];
const SNAPSHOT_COLUMNS = ['Theme', ...PLATFORM_ORDER.map((platform) => PLATFORM_LABELS.get(platform) ?? platform)];
const FAILURE_COLUMNS = ['Theme', 'Actual', 'Diff'];
const THEME_ORDER = ['dark', 'light', 'default-high-contrast', 'default-high-contrast-light', 'red', 'abyss'];
const KINDS = new Set(['actual', 'diff']);
/** @type {Map<string, string>} */
const SPEC_LABELS = new Map([
  ['crop', 'Crop PDF configure'],
  ['merge', 'Merge PDF configure'],
  ['split', 'Split PDF configure'],
]);
const SPEC_ORDER = ['crop', 'merge', 'split'];
const COMMENT_MARKER = '<!-- playwright-screenshots -->';
const IMAGE_WIDTH = 230;

/**
 * @template T
 * @param {T[]} values
 * @param {(left: T, right: T) => number} compare
 * @returns {T[]}
 */
function sortCopy(values, compare) {
  // oxlint-disable-next-line typescript/no-unsafe-return -- preserve non-mutating sorting.
  return values.toSorted(compare);
}

/**
 * @param {string} name
 * @returns {Screenshot | undefined}
 */
function classify(name) {
  const base = name.endsWith('.png') ? name.slice(0, -4) : name;
  const parts = base.split('-');
  const spec = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  if (PLATFORMS.has(last)) {
    const themeParts = parts.slice(3, parts.indexOf('vscode'));
    return { kind: 'snapshot', spec, theme: themeParts.join('-'), platform: last, name };
  }
  if (KINDS.has(last)) {
    const platform = parts[parts.length - 2] ?? '';
    return {
      kind: 'failure',
      spec,
      theme: parts.slice(3, parts.indexOf('vscode')).join('-'),
      platform,
      kindName: last,
      name,
    };
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- preserve the optional result contract.
  return undefined;
}

/**
 * @param {string} value
 * @returns {string}
 */
function titleCase(value) {
  return value
    .split('-')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

/**
 * @param {string} theme
 * @returns {string}
 */
function themeSortKey(theme) {
  const index = THEME_ORDER.indexOf(theme);
  return index >= 0 ? `${String(index).padStart(2, '0')}-${theme}` : `99-${theme}`;
}

/**
 * @param {string} fileName
 * @param {string} label
 * @param {string} repository
 * @returns {string}
 */
function imageCell(fileName, label, repository) {
  const url = `https://github.com/${repository}/raw/ci-screenshots/.ci-screenshots/${fileName}`;
  return `<a href="${url}"><img src="${url}" width="${IMAGE_WIDTH}" alt="${label}"></a>`;
}

function renderTableRow(cells) {
  return `| ${cells.join(' | ')} |`;
}

/**
 * @param {number} columnCount
 * @returns {string}
 */
function renderTableDelimiter(columnCount) {
  return `|${Array.from({ length: columnCount }, () => '---').join('|')}|`;
}

/**
 * @param {Screenshot[]} files
 * @param {string} repository
 * @returns {string[]}
 */
function renderSnapshotSection(files, repository) {
  /** @type {Map<string, Map<string, Screenshot>>} */
  const byTheme = new Map();
  for (const file of files) {
    const platforms = byTheme.get(file.theme) ?? /** @type {Map<string, Screenshot>} */ (new Map());
    if (file.platform !== undefined) {
      platforms.set(file.platform, file);
    }
    byTheme.set(file.theme, platforms);
  }

  const output = [renderTableRow(SNAPSHOT_COLUMNS), renderTableDelimiter(SNAPSHOT_COLUMNS.length)];
  const themes = sortCopy([...byTheme.keys()], (left, right) => themeSortKey(left).localeCompare(themeSortKey(right)));
  for (const theme of themes) {
    const platforms = byTheme.get(theme);
    const cells = PLATFORM_ORDER.map((platform) => {
      const file = platforms?.get(platform);
      return file
        ? imageCell(file.name, `${titleCase(theme)} (${PLATFORM_LABELS.get(platform) ?? platform})`, repository)
        : '-';
    });
    output.push(renderTableRow([titleCase(theme), ...cells]));
  }
  return output;
}

/**
 * @param {Screenshot[]} files
 * @param {string} repository
 * @returns {string[]}
 */
function renderFailureSection(files, repository) {
  /** @type {Map<string, Map<string, Screenshot>>} */
  const byTheme = new Map();
  for (const file of files) {
    const key = `${file.theme}|${file.platform ?? ''}`;
    const kinds = byTheme.get(key) ?? /** @type {Map<string, Screenshot>} */ (new Map());
    if (file.kindName !== undefined) {
      kinds.set(file.kindName, file);
    }
    byTheme.set(key, kinds);
  }

  const output = [renderTableRow(FAILURE_COLUMNS), renderTableDelimiter(FAILURE_COLUMNS.length)];
  const themes = sortCopy([...byTheme.keys()], (left, right) =>
    themeSortKey(left.split('|')[0] ?? '').localeCompare(themeSortKey(right.split('|')[0] ?? '')),
  );
  for (const key of themes) {
    const kinds = byTheme.get(key);
    const actual = kinds?.get('actual');
    const diff = kinds?.get('diff');
    const [theme, platform] = key.split('|');
    const label = platform ? `${titleCase(theme)} (${PLATFORM_LABELS.get(platform) ?? platform})` : titleCase(theme);
    output.push(
      renderTableRow([
        label,
        actual ? imageCell(actual.name, `${label} actual`, repository) : '-',
        diff ? imageCell(diff.name, `${label} diff`, repository) : '-',
      ]),
    );
  }
  return output;
}

/**
 * @param {Screenshot[]} files
 * @returns {Map<string, Screenshot[]>}
 */
function groupBySpec(files) {
  /** @type {Map<string, Screenshot[]>} */
  const groups = new Map();
  for (const file of files) {
    const group = groups.get(file.spec) ?? [];
    group.push(file);
    groups.set(file.spec, group);
  }
  return groups;
}

/**
 * @param {Screenshot[]} files
 * @param {string} repository
 * @param {string} runId
 * @returns {string}
 */
function renderMarkdown(files, repository, runId) {
  const output = [COMMENT_MARKER, '', `## Playwright screenshots (run ${runId})`, ''];
  const snapshotGroups = groupBySpec(files.filter((file) => file.kind === 'snapshot'));
  const failureGroups = groupBySpec(files.filter((file) => file.kind === 'failure'));
  const extraSpecs = sortCopy(
    [...new Set([...snapshotGroups.keys(), ...failureGroups.keys()])].filter((spec) => !SPEC_ORDER.includes(spec)),
    (left, right) => left.localeCompare(right),
  );
  const specs = [...SPEC_ORDER.filter((spec) => snapshotGroups.has(spec) || failureGroups.has(spec)), ...extraSpecs];

  for (const spec of specs) {
    const snapshots = snapshotGroups.get(spec);
    if (snapshots && snapshots.length > 0) {
      output.push('<details>', `<summary><strong>${SPEC_LABELS.get(spec) ?? spec}</strong></summary>`, '');
      output.push(...renderSnapshotSection(snapshots, repository));
      output.push('', '</details>', '');
    }
    const failures = failureGroups.get(spec);
    if (failures && failures.length > 0) {
      output.push('<details>', `<summary><strong>${SPEC_LABELS.get(spec) ?? spec} — mismatches</strong></summary>`, '');
      output.push(...renderFailureSection(failures, repository));
      output.push('', '</details>', '');
    }
  }
  return `${output.join('\n')}\n`;
}

const mainScriptUrl = new URL(import.meta.url).href;
const entryScriptUrl = pathToFileURL(process.argv[1]).href;
if (mainScriptUrl === entryScriptUrl) {
  const files = process.argv
    .slice(2)
    .map((argument) => classify(argument.split('/').pop() ?? argument))
    .filter((file) => file !== undefined);
  if (files.length === 0) {
    process.stdout.write('no screenshot files found\n');
    process.exit(0);
  }

  const repository = process.env.GITHUB_REPOSITORY;
  if (repository === undefined || repository === '') {
    throw new Error('GITHUB_REPOSITORY environment variable is required.');
  }

  process.stdout.write(renderMarkdown(files, repository, process.env.GITHUB_RUN_ID ?? ''));
}

export { classify, renderFailureSection, renderMarkdown, renderSnapshotSection };
