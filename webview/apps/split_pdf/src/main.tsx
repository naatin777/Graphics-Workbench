import './styles.css';

import { render } from 'solid-js/web';

import { App } from './app';

const root = document.querySelector('#root');

if (!root) {
  throw new Error('Root element not found.');
}

render(() => <App />, root);
