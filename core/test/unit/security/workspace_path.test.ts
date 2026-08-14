// Test target:
// - workspace内外を論理パスと実体パスの両方で判定すること
// - 未作成の書き込み先では最も近い既存親を検証すること
//
// Mocked:
// - なし。実際の一時ディレクトリとsymlinkを使用する。
//
// Not tested:
// - OS自体のアクセス制御
// - 検証後に別プロセスがsymlinkを差し替える競合の完全防止
// - execPathの実行可否

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '@graphics-workbench/core/security';

describe('workspaceパスの安全性', () => {
  it('workspace配下の既存ファイルは論理パス判定と実体パス(realpath)判定の両方を通過して許可する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-'));
    const sourcePath = path.join(workspacePath, 'figures', 'sample.pdf');
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, 'pdf');

    await assert.doesNotReject(assertExistingPathInWorkspace(sourcePath, workspacePath));
  });

  it('未作成の書き込み先はworkspace内の最も近い既存親ディレクトリの実体パスを検証して通過し、未作成の新規ファイル自体も許可する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-'));
    const outputPath = path.join(workspacePath, 'generated', 'nested', 'sample.pdf');

    await assert.doesNotReject(assertWritablePathInWorkspace(outputPath, workspacePath));
  });

  it('workspace外の既存ファイルは相対パスが../で始まり論理判定で外側とみなされ、outside the workspaceエラーで拒否する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-'));
    const outsidePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'gw-outside-')), 'sample.pdf');
    await writeFile(outsidePath, 'pdf');

    await assert.rejects(assertExistingPathInWorkspace(outsidePath, workspacePath), /outside the workspace/);
  });

  it('未作成の書き込み先の親がworkspace外にある場合は最も近い既存親の実体パスが外側と判定され、outside the workspaceエラーで拒否する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-'));
    const outsidePath = path.join(await mkdtemp(path.join(os.tmpdir(), 'gw-outside-')), 'new', 'sample.pdf');

    await assert.rejects(assertWritablePathInWorkspace(outsidePath, workspacePath), /outside the workspace/);
  });

  it('workspaceと同名prefixを共有する兄弟ディレクトリ（project vs project-backup）は相対パスが../project-backupで始まり論理判定で外側とみなされ拒否する', async () => {
    const parentPath = await mkdtemp(path.join(os.tmpdir(), 'gw-prefix-'));
    const workspacePath = path.join(parentPath, 'project');
    const siblingPath = path.join(parentPath, 'project-backup', 'sample.pdf');
    await mkdir(workspacePath);
    await mkdir(path.dirname(siblingPath));
    await writeFile(siblingPath, 'pdf');

    await assert.rejects(assertExistingPathInWorkspace(siblingPath, workspacePath), /outside the workspace/);
  });

  it('workspace内のディレクトリsymlinkがworkspace外の実体を指す場合、論理パスは内側でもrealpath後の実体パスが外側となり読み込みを拒否する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-'));
    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), 'gw-outside-'));
    const outsideFile = path.join(outsideDirectory, 'sample.pdf');
    const linkedDirectory = path.join(workspacePath, 'linked');
    await writeFile(outsideFile, 'pdf');
    await createDirectorySymlink(outsideDirectory, linkedDirectory);

    await assert.rejects(
      assertExistingPathInWorkspace(path.join(linkedDirectory, 'sample.pdf'), workspacePath),
      /outside the workspace/,
    );
  });

  it('未作成の書き込み先の親がworkspace外へのsymlinkである場合、最も近い既存親の実体パスが外側となり書き込みを拒否する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-'));
    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), 'gw-outside-'));
    const linkedDirectory = path.join(workspacePath, 'linked');
    await createDirectorySymlink(outsideDirectory, linkedDirectory);

    await assert.rejects(
      assertWritablePathInWorkspace(path.join(linkedDirectory, 'new', 'sample.pdf'), workspacePath),
      /outside the workspace/,
    );
  });

  it('workspace自体がsymlinkで実体が別ディレクトリでも、workspaceの実体と対象の実体が同じworkspace内なら許可する', async () => {
    const actualWorkspace = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-'));
    const symlinkParent = await mkdtemp(path.join(os.tmpdir(), 'gw-workspace-link-'));
    const workspacePath = path.join(symlinkParent, 'project');
    const sourcePath = path.join(actualWorkspace, 'sample.pdf');
    await writeFile(sourcePath, 'pdf');
    await createDirectorySymlink(actualWorkspace, workspacePath);

    await assert.doesNotReject(assertExistingPathInWorkspace(path.join(workspacePath, 'sample.pdf'), workspacePath));
  });
});

async function createDirectorySymlink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}
