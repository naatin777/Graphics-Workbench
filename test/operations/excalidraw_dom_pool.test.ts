import assert from 'node:assert/strict';

import { ExcalidrawDomPool } from '../../src/operations/conversion/excalidraw_dom_pool.js';

suite('Excalidraw DOM pool', () => {
  test('プールサイズ内でウィンドウを使い回す', () => {
    const pool = new ExcalidrawDomPool(2);
    try {
      const first = pool.acquire();
      const second = pool.acquire();
      assert.notStrictEqual(first, second);
      pool.release(first);
      pool.release(second);
      const third = pool.acquire();
      assert.ok([first, second].includes(third), 'acquire after filling the pool must reuse a window');
      pool.release(third);
    } finally {
      pool.dispose();
    }
  });

  test('プールサイズ以上は生成しない', () => {
    const pool = new ExcalidrawDomPool(2);
    try {
      const first = pool.acquire();
      const second = pool.acquire();
      const third = pool.acquire();
      assert.notStrictEqual(first, second);
      assert.ok([first, second].includes(third), 'third acquire must reuse an existing window');
      pool.release(first);
      pool.release(second);
      pool.release(third);
    } finally {
      pool.dispose();
    }
  });

  test('失敗したウィンドウは次回取得時に再生成される', () => {
    const pool = new ExcalidrawDomPool(3);
    try {
      const first = pool.acquire();
      pool.markFailed(first);
      pool.release(first);
      const second = pool.acquire();
      assert.notStrictEqual(second, first, 'a failed window must be rebuilt');
      pool.release(second);
    } finally {
      pool.dispose();
    }
  });

  test('releaseはdocumentをリセットする', () => {
    const pool = new ExcalidrawDomPool(1);
    try {
      const instance = pool.acquire();
      instance.dom.window.document.head.replaceChildren();
      instance.dom.window.document.body.replaceChildren();
      pool.release(instance);
    } finally {
      pool.dispose();
    }
  });

  test('disposeは全てのウィンドウを閉じる', () => {
    const pool = new ExcalidrawDomPool(2);
    const first = pool.acquire();
    const second = pool.acquire();
    pool.release(first);
    pool.release(second);
    pool.dispose();
  });
});
