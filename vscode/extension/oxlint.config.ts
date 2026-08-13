import { defineConfig } from 'oxlint';

import baseConfig, { extensionOnly, restrictedImports, strictSourceRules } from '../../oxlint.base.ts';

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
      files: ['scripts/**/*.mjs'],
      rules: {
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-return': 'off',
        'typescript/no-unnecessary-condition': 'off',
        'typescript/no-confusing-void-expression': 'off',
        'typescript/strict-boolean-expressions': 'off',
        'typescript/strict-void-return': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/no-nested-ternary': 'off',
      },
    },
    {
      files: ['src/**/*.ts'],
      rules: {
        ...strictSourceRules,
        ...restrictedImports(extensionOnly),
      },
    },
    {
      files: ['src/generated/**/*.ts'],
      rules: {
        'no-restricted-imports': 'off',
        'no-console': 'off',
        'typescript/no-restricted-types': 'off',
        'typescript/no-unsafe-type-assertion': 'off',
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
    {
      files: ['src/adapters/crop/run_crop_worker.ts'],
      rules: {
        'project/no-direct-child-process': 'off',
      },
    },
  ],
});
