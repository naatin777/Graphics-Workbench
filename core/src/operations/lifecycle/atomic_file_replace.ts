import { rename, rm } from 'node:fs/promises';

import { asError } from '../../shared/error.js';

export interface AtomicFileReplaceOptions {
  renameImpl?: typeof rename;
  rmImpl?: typeof rm;
  /** Runs after a Windows rename conflict, before the existing target is removed (re-validation window). */
  beforeTargetRemoval?: (renameError: Error) => Promise<void>;
  /** Runs after the target removal, before the retry rename. */
  afterTargetRemoval?: () => Promise<void>;
}

/**
 * Replaces `targetPath` with the already fully-written sibling `temporaryPath`.
 *
 * On POSIX, `rename()` atomically replaces the target, so a crash or kill at
 * any point leaves either the old or the new file in place — never a partially
 * written target. On Windows, `rename()` cannot replace an existing file, so
 * the target is removed first and the rename retried; the removal-to-rename
 * window is inherent to Windows without the ReplaceFile API, and callers
 * re-validate before entering it via `afterTargetRemoval`.
 */
export async function replaceFileAtomically(
  temporaryPath: string,
  targetPath: string,
  options: AtomicFileReplaceOptions = {},
): Promise<void> {
  const renameImpl = options.renameImpl ?? rename;
  const rmImpl = options.rmImpl ?? rm;
  try {
    await renameImpl(temporaryPath, targetPath);
    return;
  } catch (error) {
    if (!isWindowsRenameConflict(error)) {
      throw asError(error);
    }
    await options.beforeTargetRemoval?.(asError(error));
  }

  await rmImpl(targetPath, { force: true });
  await options.afterTargetRemoval?.();
  await renameImpl(temporaryPath, targetPath);
}

// oxlint-disable-next-line typescript/no-restricted-types -- renameのcatchから渡される任意のthrow値の型ガード。
function isWindowsRenameConflict(error: unknown): boolean {
  return (
    process.platform === 'win32' &&
    error instanceof Error &&
    'code' in error &&
    (error.code === 'EEXIST' || error.code === 'EPERM')
  );
}
