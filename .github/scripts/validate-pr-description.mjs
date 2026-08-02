import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** @typedef {{ valid: true } | { valid: false, reason: string }} ValidationResult */

/**
 * Ensures a pull request has an explicit, non-placeholder Verification section.
 * @param {string} body
 * @returns {ValidationResult}
 */
export function validatePrDescription(body) {
  const sectionMatch = body.match(/^##\s+Verification\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/imu);
  if (sectionMatch === null) {
    return { valid: false, reason: 'PR body must contain a ## Verification section.' };
  }

  const visibleContent = sectionMatch[1]
    .replaceAll(/<!--[\s\S]*?-->/gu, '')
    .replaceAll(/^\s*[-*]\s*$/gmu, '')
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
  const result = validatePrDescription(process.env.PR_BODY ?? '');
  if ('reason' in result) {
    process.stderr.write(`${result.reason}\n`);
    process.exitCode = 1;
  }
}
