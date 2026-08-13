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
  overrides: [
    {
      // The testing kit runs outside a single TS program (testkit types come
      // from dist), so type-aware rules cannot resolve every expression.
      files: ['testing/**/*.ts'],
      rules: {
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-return': 'off',
        'typescript/no-unnecessary-condition': 'off',
        'typescript/no-non-null-assertion': 'off',
        'typescript/no-confusing-void-expression': 'off',
        'typescript/strict-boolean-expressions': 'off',
        'typescript/strict-void-return': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/no-nested-ternary': 'off',
      },
    },
    {
      files: ['test/**/*.ts'],
      rules: {
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-return': 'off',
        'typescript/no-unnecessary-condition': 'off',
        'typescript/no-non-null-assertion': 'off',
        'typescript/no-confusing-void-expression': 'off',
        'typescript/strict-boolean-expressions': 'off',
        'typescript/strict-void-return': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/no-nested-ternary': 'off',
      },
    },
  ],
});
