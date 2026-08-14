import { defineConfig } from 'oxlint';

import rootConfig, { projectRules } from '../oxlint.config.ts';

export default defineConfig({
  extends: [rootConfig],
  jsPlugins: [
    {
      name: 'project',
      specifier: '../scripts/oxlint-project-plugin.mjs',
    },
  ],
  rules: {
    ...projectRules,
  },
});
