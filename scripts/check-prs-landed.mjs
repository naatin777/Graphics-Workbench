import { execFileSync } from 'node:child_process';

// Verifies that merged GitHub PRs actually landed on origin/main.
//
// This repository squash-merges PRs, so the original stack commit SHAs never
// become ancestors of main. Checking PR merge_commit_sha instead distinguishes:
//   - normal squash merge  -> the squash commit is an ancestor of main
//   - merged into a Graphite base only -> merge_commit_sha is absent from main
//
// Usage:
//   node scripts/check-prs-landed.mjs <pr-number>... [--ref <branch-or-tag>] [--no-fetch]
//
// The default ref is origin/main. A PR that is open, or whose merge commit is
// not an ancestor of the ref, makes the check exit non-zero.

const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const defaultRef = 'origin/main';

function parseArgs(args) {
  const prNumbers = [];
  let ref = defaultRef;
  let fetch = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--ref') {
      index += 1;
      ref = args[index];
      if (ref === undefined) {
        throw new Error('--ref requires a branch or tag name.');
      }
    } else if (arg === '--no-fetch') {
      fetch = false;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      prNumbers.push(arg);
    }
  }

  return { prNumbers, fetch, ref };
}

function isAncestor(commit, ref) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, ref], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function prState(prNumber) {
  const output = execFileSync(
    'gh',
    ['pr', 'view', prNumber, '--json', 'state,mergeCommit', '--jq', '.state + " " + (.mergeCommit.oid // "")'],
    { encoding: 'utf8' },
  ).trim();
  const [state, mergeCommitOid] = output.split(' ');
  return { mergeCommitOid, state };
}

function main() {
  const { prNumbers, fetch, ref } = parseArgs(process.argv.slice(2));

  if (prNumbers.length === 0) {
    process.stderr.write('Usage: node scripts/check-prs-landed.mjs <pr-number>... [--ref <branch-or-tag>] [--no-fetch]\n');
    process.exit(2);
  }

  if (fetch) {
    execFileSync('git', ['fetch', 'origin'], { cwd: repositoryRoot, stdio: 'inherit' });
  }

  let failed = false;
  for (const prNumber of prNumbers) {
    const { mergeCommitOid, state } = prState(prNumber);

    if (state !== 'MERGED') {
      failed = true;
      process.stdout.write(`NOT-MERGED PR #${prNumber} is ${state}\n`);
      continue;
    }

    if (mergeCommitOid === '') {
      failed = true;
      process.stdout.write(`MISSING PR #${prNumber} has no merge commit on ${ref}\n`);
      continue;
    }

    const landed = isAncestor(mergeCommitOid, ref);
    if (!landed) {
      failed = true;
    }
    process.stdout.write(
      `${landed ? 'landed' : 'MISSING'} PR #${prNumber} merge commit ${mergeCommitOid} is${landed ? ' ' : ' NOT '}an ancestor of ${ref}\n`,
    );
  }

  if (failed) {
    process.stderr.write(
      '\nOne or more PRs are not present on the trunk. A PR merged into a Graphite base branch\n' +
        '(e.g. graphite-base/*) or left in another state is not a landed completion. Merge the PR to\n' +
        'main (or use gt merge) and re-run this check.\n',
    );
    process.exit(1);
  }
}

main();
