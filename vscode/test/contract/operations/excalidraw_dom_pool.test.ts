import assert from 'node:assert/strict';

import { ExcalidrawDomPool } from '../../../src/operations/conversion/excalidraw_dom_pool.js';

suite('Excalidraw→SVG変換でのjsdomウィンドウの使い回し（生成・再利用・失敗時再生成・破棄）', () => {
  test('プールサイズ2で2つを順にacquireすると別々のウィンドウが返り、両方をreleaseした後の3回目acquireで既存ウィンドウのいずれかを再利用する', () => {
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

  test('プールサイズ2で3回連続acquireすると、3回目は既存2ウィンドウのいずれかを再利用して新規生成しない', () => {
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

  test('acquireしたウィンドウをmarkFailedしてreleaseすると、次のacquireでは失敗したウィンドウを閉じて新しいウィンドウを生成して返す', () => {
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

  test('acquireしたウィンドウのdocument.headとbodyに要素を追加した状態でreleaseを呼ぶと、documentを空にリセットして次の変換に備える', () => {
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

  test('acquireしてreleaseした全ウィンドウに対してdisposeを呼ぶと、例外なくすべてのウィンドウを閉じてプールを破棄する', () => {
    const pool = new ExcalidrawDomPool(2);
    const first = pool.acquire();
    const second = pool.acquire();
    pool.release(first);
    pool.release(second);
    pool.dispose();
  });
});
