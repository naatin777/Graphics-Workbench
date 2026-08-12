import { defineConfig } from 'oxlint';

import baseConfig from './oxlint.base.ts';

export default defineConfig({
  extends: [baseConfig],
  options: {
    typeAware: true,
  },
  jsPlugins: [
    {
      name: 'project',
      specifier: './scripts/oxlint-project-plugin.mjs',
    },
  ],
});
