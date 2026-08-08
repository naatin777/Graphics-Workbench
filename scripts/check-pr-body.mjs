import { readFileSync } from 'node:fs';

// Rejects pull requests whose body leaves the required template sections empty.
// The review template (` .github/PULL_REQUEST_TEMPLATE.md`) asks for a Summary
// and a Verification. GitHub cannot enforce that in branch protection, so this
// check fails the PR when either section is still a placeholder.

const requiredSections = ['Summary', 'Verification'];
const placeholderLines = new Set(['', '-']);

/**
 * Reads the PR body. In CI the body is written to a temp file by the workflow;
 * locally `--body <path>` is used so the check stays testable without GitHub.
 */
function readBody(args) {
  const bodyFlagIndex = args.indexOf('--body');
  if (bodyFlagIndex === -1) {
    process.stderr.write('Usage: node scripts/check-pr-body.mjs --body <pr-body.txt>\n');
    process.exit(2);
  }
  const bodyPath = args[bodyFlagIndex + 1];
  if (bodyPath === undefined) {
    process.stderr.write('Usage: node scripts/check-pr-body.mjs --body <pr-body.txt>\n');
    process.exit(2);
  }
  return readFileSync(bodyPath, 'utf8');
}

function sectionContent(body, title) {
  const header = new RegExp(`^## ${title}\\s*$`, 'mu');
  const headerMatch = body.match(header);
  if (!headerMatch) {
    return undefined;
  }
  const afterHeader = body.slice(headerMatch.index + headerMatch[0].length);
  const nextSection = afterHeader.match(/^## /mu);
  const sectionBody = nextSection ? afterHeader.slice(0, nextSection.index) : afterHeader;
  return sectionBody.trim();
}

function isEmptySection(content) {
  if (content === undefined) {
    return true;
  }
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('<!--'));
  return lines.every((line) => placeholderLines.has(line));
}

function main() {
  const body = readBody(process.argv.slice(2));
  const emptySections = requiredSections.filter((title) => isEmptySection(sectionContent(body, title)));
  if (emptySections.length === 0) {
    process.stdout.write('PR body has all required sections filled.\n');
    return;
  }
  process.stderr.write(
    `PR body is missing required content for: ${emptySections.join(', ')}.\n` +
      'Fill in the Summary and Verification sections of the PR template before merging.\n',
  );
  process.exit(1);
}

main();
