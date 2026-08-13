// NLS consistency between the English and Japanese message catalogs and the
// package.json `%...%` references. The `userMessage(...)` call-site analysis
// lives in the Oxlint project plugin (scripts/oxlint-project-plugin.mjs),
// which sees the AST and reports file/line locations directly.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @typedef {Record<string, string>} NlsMessages */

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function sortStrings(values) {
  return values.toSorted();
}

/**
 * @param {unknown} value
 * @returns {value is NlsMessages}
 */
function isNlsMessages(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}

/**
 * @param {string} content
 * @param {string} filePath
 * @returns {NlsMessages}
 */
function parseNlsMessages(content, filePath) {
  /** @type {unknown} */
  const value = JSON.parse(content);
  if (!isNlsMessages(value)) {
    throw new Error(`Invalid NLS messages file: ${filePath}`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function placeholders(value) {
  const values = [...String(value).matchAll(/\{(\d+)\}/g)].map((match) => match[1]);
  return sortStrings(values);
}

/**
 * @param {string} root
 * @returns {{ errors: string[]; keyCount: number }}
 */
export function checkNls(root) {
  const extensionRoot = path.join(root, 'vscode', 'extension');
  const englishPath = path.join(extensionRoot, 'package.nls.json');
  const japanesePath = path.join(extensionRoot, 'package.nls.ja.json');
  const english = parseNlsMessages(readFileSync(englishPath, 'utf8'), englishPath);
  const japanese = parseNlsMessages(readFileSync(japanesePath, 'utf8'), japanesePath);
  /** @type {string[]} */
  const errors = [];

  const englishKeys = sortStrings(Object.keys(english));
  const japaneseKeys = sortStrings(Object.keys(japanese));
  if (JSON.stringify(englishKeys) !== JSON.stringify(japaneseKeys)) {
    errors.push(`NLS key sets differ: en=${englishKeys.length}, ja=${japaneseKeys.length}`);
  }

  for (const key of englishKeys) {
    if (JSON.stringify(placeholders(english[key])) !== JSON.stringify(placeholders(japanese[key]))) {
      errors.push(`NLS placeholders differ for ${key}`);
    }
  }

  /** @type {unknown} */
  const packageJson = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));

  /**
   * @param {unknown} value
   */
  function walk(value) {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/%([^%]+)%/g)) {
        if (!(match[1] in english)) {
          errors.push(`package.json references missing NLS key: ${match[1]}`);
        }
      }
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry);
      }
    } else if (value !== null && typeof value === 'object') {
      for (const entry of Object.values(value)) {
        walk(entry);
      }
    }
  }
  walk(packageJson);

  return { errors, keyCount: englishKeys.length };
}

/**
 * @param {string} root
 */
function run(root) {
  const { errors, keyCount } = checkNls(root);
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
  } else {
    console.log(`NLS consistency OK (${keyCount} keys)`);
  }
}

const [, scriptPath] = process.argv;
if (scriptPath && import.meta.url === pathToFileURL(path.resolve(scriptPath)).href) {
  run(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
}
