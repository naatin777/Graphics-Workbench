import '@vscode/codicons/dist/codicon.css';
import '@webview-shared/ui/ui.css';
import './styles.css';

import { mountWebview } from '@webview-shared/mount';

import { App } from './app';

mountWebview(App);
