import type { Component } from 'solid-js';
import { render } from 'solid-js/web';

export function mountWebview(App: Component): void {
  const root = document.querySelector('#root');

  if (!root) {
    throw new Error('Root element not found.');
  }

  render(() => <App />, root);
}
