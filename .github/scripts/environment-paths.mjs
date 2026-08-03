const PATH_RULES = [
  {
    label: 'POSIX user-home path',
    pattern: /(?:^|[\s"'`(=,:])\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/|$)/u,
  },
  {
    label: 'macOS temporary path',
    pattern: /(?:^|[\s"'`(=,:])\/(?:private\/)?var\/folders\//u,
  },
  {
    label: 'Windows user-home path',
    pattern: /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`),;]+/iu,
  },
];

/**
 * Finds paths that identify a local user's machine or temporary directory.
 * The returned findings intentionally omit the matched text.
 * @param {string} text
 * @returns {Array<{line: number, label: string}>}
 */
export function findEnvironmentSpecificPaths(text) {
  return text
    .split(/\r?\n/u)
    .flatMap((line, index) =>
      PATH_RULES.flatMap((rule) => (rule.pattern.test(line) ? [{ line: index + 1, label: rule.label }] : [])),
    );
}
