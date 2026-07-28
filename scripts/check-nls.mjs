import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { LanguageVariant, SyntaxKind, createScanner } from 'typescript/unstable/ast';

/** @typedef {Record<string, string>} NlsMessages */
/** @typedef {{ argumentCount: number; key?: string }} CallArguments */

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function placeholders(value) {
  return [...String(value).matchAll(/\{(\d+)\}/g)].map((match) => match[1]).toSorted();
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
        if (call?.key !== undefined && call.key in english) {
          const requiredArguments = placeholders(english[call.key]).reduce(
            (max, index) => Math.max(max, Number(index) + 1),
            0,
          );
          if (call.argumentCount - 1 < requiredArguments) {
            const line = source.slice(0, callStart).split('\n').length;
            errors.push(`userMessage call has too few arguments for ${call.key}: ${sourcePath}:${line}`);
          }
        } else if (call?.key !== undefined) {
          const line = source.slice(0, callStart).split('\n').length;
          errors.push(`userMessage call references missing NLS key ${call.key}: ${sourcePath}:${line}`);
        }
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

  while (true) {
    const token = scanner.scan();
    if (token === SyntaxKind.EndOfFile) {
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
  /** @type {NlsMessages} */
  const english = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
  /** @type {NlsMessages} */
  const japanese = JSON.parse(readFileSync(path.join(root, 'package.nls.ja.json'), 'utf8'));
  /** @type {string[]} */
  const errors = [];

  const englishKeys = Object.keys(english).toSorted();
  const japaneseKeys = Object.keys(japanese).toSorted();
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
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
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
