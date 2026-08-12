import '@vscode/codicons/dist/codicon.css';
import '@webview-shared/ui/ui.css';
import './theme.css';
import './pages/crop-pdf/styles.css';
import './pages/merge-pdf/styles.css';
import './pages/preview/styles.css';
import './pages/reorder-pdf/styles.css';
import './pages/rotate-pdf/styles.css';
import './pages/split-pdf/styles.css';
import './pages/table-editor/styles.css';

import { render } from 'solid-js/web';

import { WebviewApp, pageIdFromLocation } from './app';
import { createScenarioHost } from './dev/scenarios';
import { createVsCodeHost, setActiveWebviewHost } from './shared/vscode';

const pageId = pageIdFromLocation();
const scenario = new URLSearchParams(globalThis.location.search).get('scenario') ?? 'normal';
const theme = new URLSearchParams(globalThis.location.search).get('theme');
document.body.classList.add(
  theme === 'dark' ? 'vscode-dark' : theme === 'high-contrast' ? 'vscode-high-contrast' : 'vscode-light',
);
const host = import.meta.env.DEV ? createScenarioHost(pageId, scenario) : createVsCodeHost();
setActiveWebviewHost(host);

const root = document.querySelector('#root');
if (root === null) {
  throw new Error('Webview root element was not found.');
}

render(() => <WebviewApp />, root);
