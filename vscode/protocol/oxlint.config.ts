import { defineConfig } from 'oxlint';

import baseConfig, { extensionOnly, restrictedImports } from '../../oxlint.base.ts';

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [
    {
      name: 'project',
      specifier: '../../scripts/oxlint-project-plugin.mjs',
    },
  ],
  overrides: [
    {
      files: ['src/**/*.ts'],
      rules: {
        ...restrictedImports(extensionOnly, []),
        'import/no-nodejs-modules': 'error',
      },
    },
  ],
});
