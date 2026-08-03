import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** @typedef {{ valid: true } | { valid: false, reason: string }} ValidationResult */

const DEPENDABOT_LOGIN = 'dependabot[bot]';

/**
 * Ensures a pull request has an explicit, non-placeholder Verification section.
 * @param {string} body
 * @param {{ authorLogin?: string }} [options]
 * @returns {ValidationResult}
 */
export function validatePrDescription(body, options = {}) {
  if (options.authorLogin === DEPENDABOT_LOGIN) {
    return { valid: true };
  }

  const sectionMatch = body.match(/^##\s+Verification\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/imu);
  if (sectionMatch === null) {
    return { valid: false, reason: 'PR body must contain a ## Verification section.' };
  }

  let inComment = false;
  const visibleContent = sectionMatch[1]
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trim();
      if (inComment) {
        if (trimmed.endsWith('-->')) {
          inComment = false;
        }
        return false;
      }
      if (trimmed.startsWith('<!')) {
        inComment = !trimmed.endsWith('-->');
        return false;
      }
      return !/^\s*[-*]\s*$/u.test(line);
    })
    .join('\n')
    .trim();
  if (visibleContent === '') {
    return {
      valid: false,
      reason: '## Verification must contain commands and results, or an explicit reason it was not run.',
    };
  }

  return { valid: true };
}

const isDirectExecution = process.argv.length > 1 && fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');

if (isDirectExecution) {
  const result = validatePrDescription(process.env.PR_BODY ?? '', {
    authorLogin: process.env.PR_AUTHOR ?? '',
  });
  if ('reason' in result) {
    process.stderr.write(`${result.reason}\n`);
    process.exitCode = 1;
  }
}
