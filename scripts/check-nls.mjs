import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { LanguageVariant, SyntaxKind, createScanner } from 'typescript/unstable/ast';

/** @typedef {Record<string, string>} NlsMessages */
/** @typedef {{ argumentCount: number; key?: string }} CallArguments */

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function sortStrings(values) {
  // TypeScript's JavaScript checker currently reports toSorted as any for JavaScript arrays.
  // oxlint-disable-next-line typescript/no-unsafe-return -- preserve non-mutating string ordering
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
  const sortedValues = sortStrings(values);
  return sortedValues;
}

/**
 * @param {string} sourcePath
 * @param {string} source
 * @param {NlsMessages} english
 * @param {CallArguments | undefined} call
 * @param {number} callStart
 * @returns {string[]}
 */
function validateUserMessageCall(sourcePath, source, english, call, callStart) {
  if (call?.key === undefined) {
    return [];
  }

  const line = source.slice(0, callStart).split('\n').length;
  if (call.key in english) {
    let requiredArguments = 0;
    for (const index of placeholders(english[call.key])) {
      requiredArguments = Math.max(requiredArguments, Number(index) + 1);
    }
    if (call.argumentCount - 1 >= requiredArguments) {
      return [];
    }
    return [`userMessage call has too few arguments for ${call.key}: ${sourcePath}:${line}`];
  }

  return [`userMessage call references missing NLS key ${call.key}: ${sourcePath}:${line}`];
}

/**
 * @param {string} sourcePath
 * @param {string} source
 * @param {NlsMessages} english
 * @returns {string[]}
 */
export function validateUserMessageSource(sourcePath, source, english) {
  if (!source.includes('userMessage')) {
    return [];
  }
  /** @type {string[]} */
  const errors = [];
  const scanner = createScanner(true, LanguageVariant.Standard, source, 0, source.length);
  let token = scanner.scan();
  let tokenCount = 0;

  while (token !== SyntaxKind.EndOfFile) {
    tokenCount++;
    if (tokenCount > source.length * 2) {
      break;
    }
    if (token === SyntaxKind.Identifier && scanner.getTokenText() === 'userMessage') {
      const callStart = scanner.getTokenStart();
      if (scanner.scan() === SyntaxKind.OpenParenToken) {
        const call = scanCallArguments(scanner);
        errors.push(...validateUserMessageCall(sourcePath, source, english, call, callStart));
      }
    }
    token = scanner.scan();
  }

  return errors;
}

/**
 * @param {ReturnType<typeof createScanner>} scanner
 * @returns {CallArguments | undefined}
 */
function scanCallArguments(scanner) {
  let depth = 0;
  let argumentCount = 0;
  let hasToken = false;
  /** @type {string | undefined} */
  let key;

  for (;;) {
    const token = scanner.scan();
    if (token === SyntaxKind.EndOfFile) {
      // oxlint-disable-next-line unicorn/no-useless-undefined -- distinguish an incomplete call from a closed call.
      return undefined;
    }

    if (depth === 0 && token === SyntaxKind.CloseParenToken) {
      if (hasToken) {
        argumentCount += 1;
      }
      return { argumentCount, key };
    }

    if (depth === 0 && token === SyntaxKind.CommaToken) {
      if (hasToken) {
        argumentCount += 1;
      }
      hasToken = false;
      continue;
    }

    if (!hasToken && argumentCount === 0 && depth === 0 && token === SyntaxKind.StringLiteral) {
      key = scanner.getTokenValue();
    }
    hasToken = true;

    if (
      token === SyntaxKind.OpenParenToken ||
      token === SyntaxKind.OpenBracketToken ||
      token === SyntaxKind.OpenBraceToken
    ) {
      depth += 1;
    } else if (
      token === SyntaxKind.CloseBracketToken ||
      token === SyntaxKind.CloseBraceToken ||
      (token === SyntaxKind.CloseParenToken && depth > 0)
    ) {
      depth -= 1;
    }
  }
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(entryPath);
    }
    return entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

/**
 * @param {string} root
 * @returns {{ errors: string[]; keyCount: number }}
 */
export function checkNls(root) {
  const englishPath = path.join(root, 'package.nls.json');
  const japanesePath = path.join(root, 'package.nls.ja.json');
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
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

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

  for (const sourcePath of sourceFiles(path.join(root, 'src'))) {
    errors.push(...validateUserMessageSource(sourcePath, readFileSync(sourcePath, 'utf8'), english));
  }

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

const scriptPath = process.argv[1];
if (scriptPath && import.meta.url === pathToFileURL(path.resolve(scriptPath)).href) {
  run(process.cwd());
}
