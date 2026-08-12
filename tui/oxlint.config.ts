import { defineConfig } from 'oxlint';

import baseConfig from '../oxlint.base.ts';

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [
    {
      name: 'project',
      specifier: '../scripts/oxlint-project-plugin.mjs',
    },
  ],
});
