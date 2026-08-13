import { open, stat } from 'node:fs/promises';

import { assertExistingPathInWorkspace, assertPathIsNotSymbolicLink } from '../../security/workspace_path.js';
import { asError, isFileNotFoundError } from '../../shared/error.js';
import { hashFile } from '../input/file_content_hash.js';

export interface FileIdentity {
  dev: number;
  ino: number;
}

export async function readFileIdentity(filePath: string): Promise<FileIdentity> {
  const fileStat = await stat(filePath);
  return { dev: fileStat.dev, ino: fileStat.ino };
}

export function sameFileIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

/**
 * Asserts that the file at `filePath` is still the same inode as `expected`,
 * inside the workspace, and not a symlink. Used immediately before mutating a
 * user-visible path whose identity was captured earlier.
 */
export async function assertFileIdentityAtPath(
  filePath: string,
  workspacePath: string,
  expected: FileIdentity,
): Promise<void> {
  await assertExistingPathInWorkspace(filePath, workspacePath);
  await assertPathIsNotSymbolicLink(filePath);
  if (!sameFileIdentity(await readFileIdentity(filePath), expected)) {
    throw new Error(`File was replaced before mutation: ${filePath}`);
  }
}

/**
 * Hashes a file while pinning its identity before and after the read, so a
 * concurrent replacement (TOCTOU) is detected instead of hashing a mixture of
 * two files. Returns the digest together with the identity of the hashed file.
 */
export async function readStableFileDigest(
  filePath: string,
  workspacePath: string,
): Promise<{ sha256: string; identity: FileIdentity }> {
  try {
    await assertExistingPathInWorkspace(filePath, workspacePath);
    await assertPathIsNotSymbolicLink(filePath);
    const before = await readFileIdentity(filePath);
    const sha256 = await hashFile(filePath);
    await assertExistingPathInWorkspace(filePath, workspacePath);
    await assertPathIsNotSymbolicLink(filePath);
    const identity = await readFileIdentity(filePath);
    if (!sameFileIdentity(before, identity)) {
      throw new Error(`File was replaced while its contents were being verified: ${filePath}`);
    }
    return { sha256, identity };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new Error(`File was replaced while its contents were being verified: ${filePath}`, { cause: error });
    }
    throw asError(error);
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw asError(error);
  }
}

export async function fsyncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
