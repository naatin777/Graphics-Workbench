import assert from 'node:assert/strict';
import { mkdir, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { filesHaveEqualContents, hashFile } from '@graphics-workbench/core/runtime';

describe('大きなファイルの内容ハッシュ比較', () => {
  it('同一内容の2ファイルはhashFileが一致してfilesHaveEqualContentsがtrueになり、末尾が異なるファイルに対してはfalseを返し、元ファイルは変更しない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-hash-test-'));
    const workspacePath = workspacePathDisposable.path;
    const firstPath = path.join(workspacePath, 'first.bin');
    const secondPath = path.join(workspacePath, 'second.bin');
    const differentPath = path.join(workspacePath, 'different.bin');
    const contents = Buffer.alloc(1024 * 1024, 0x61);

    await mkdir(workspacePath, { recursive: true });
    await writeFile(firstPath, contents);
    await writeFile(secondPath, contents);
    await writeFile(differentPath, Buffer.concat([contents, Buffer.from([0x62])]));

    assert.strictEqual(await hashFile(firstPath), await hashFile(secondPath));
    assert.strictEqual(await filesHaveEqualContents(firstPath, secondPath), true);
    assert.strictEqual(await filesHaveEqualContents(firstPath, differentPath), false);
    assert.strictEqual((await readFile(firstPath)).length, contents.length);
  });
});
