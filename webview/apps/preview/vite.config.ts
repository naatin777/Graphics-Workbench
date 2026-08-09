import { defineWebviewConfig } from '../../vite.config';

export default defineWebviewConfig({
  appName: 'preview',
  copyPdfWorker: true,
});
