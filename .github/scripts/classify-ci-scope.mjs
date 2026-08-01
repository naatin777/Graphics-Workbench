#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/**
 * Classifies a set of changed files into a CI scope.
 *
 * Returns:
 * - scope: 'docs' when only documentation/non-code files changed, otherwise 'code'.
 * - runPlaywright: true when the packaged Electron Playwright suite could be affected.
 *
 * Conservative by design: any unknown state falls back to full scope.
 *
 * @param {readonly string[]} files changed file paths relative to the repository root
 * @returns {{ scope: 'docs' | 'code'; runPlaywright: boolean }}
 */
export function classifyCiScope(files) {
  const docsOnlyPattern =
    /^(?:docs\/|\.opencode\/|\.vscode\/|\.github\/(?:ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)\/|[^/]+\.md$|\.gitignore$|\.editorconfig$|LICENSE$)/u;
  const playwrightPattern =
    /^(?:src\/|webview\/|test\/playwright\/|package\.json$|package\.nls.*\.json$|playwright\.config\.mjs$|\.vscode-test\.mjs$|scripts\/package-vsix\.mjs$|\.github\/workflows\/|\.github\/scripts\/(?:install-image-tools|install-test-tools|verify-image-tools))/u;
  const nonPlaywrightPattern =
    /^(?:test\/(?!playwright\/)|scripts\/(?:generate-|check-)|\.github\/scripts\/(?:render-|classify-)|docs\/)/u;

  if (files.every((file) => docsOnlyPattern.test(file))) {
    return { scope: 'docs', runPlaywright: false };
  }

  return {
    scope: 'code',
    runPlaywright: files.some((file) => playwrightPattern.test(file) || !nonPlaywrightPattern.test(file)),
  };
}

function changedFiles() {
  const eventName = process.env.CI_EVENT_NAME ?? '';
  const baseRef = process.env.CI_BASE_REF ?? '';
  const beforeSha = process.env.CI_BEFORE_SHA ?? '';

  let base;
  if (eventName === 'pull_request' && baseRef !== '') {
    base = `origin/${baseRef}`;
  } else if (eventName === 'push' && /^[0-9a-f]{40}$/u.test(beforeSha)) {
    base = beforeSha;
  } else {
    return null;
  }

  try {
    const diff = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return diff
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    return null;
  }
}

function writeOutputs(scope, runPlaywright) {
  const lines = [`scope=${scope}`, `run_playwright=${runPlaywright}`];
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput !== undefined && githubOutput !== '') {
    appendFileSync(githubOutput, `${lines.join('\n')}\n`);
  } else {
    process.stdout.write(`${lines.join('\n')}\n`);
  }
}

const files = changedFiles();
if (files === null) {
  writeOutputs('code', 'yes');
} else {
  const { scope, runPlaywright } = classifyCiScope(files);
  writeOutputs(scope, runPlaywright ? 'yes' : 'no');
}
