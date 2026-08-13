import { defineConfig } from 'oxlint';

import baseConfig, { browserOnly, restrictedImports } from '../../oxlint.base.ts';

const untypedBoundaryRules = {
  'typescript/no-restricted-types': 'off',
  'typescript/no-unsafe-type-assertion': 'off',
};

const testRules = {
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
};

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
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      rules: {
        ...restrictedImports(browserOnly),
      },
    },
    {
      files: ['src/shared/vscode.ts', 'src/test_support/**/*.ts', 'src/dev/**/*.ts'],
      rules: {
        ...untypedBoundaryRules,
        'typescript/no-unnecessary-type-parameters': 'off',
        'typescript/no-unnecessary-type-assertion': 'off',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      rules: {
        ...testRules,
        ...untypedBoundaryRules,
      },
    },
    {
      files: ['src/shared/pdf/install_map_get_or_insert_computed.ts'],
      rules: {
        'import/unambiguous': 'off',
        'eslint/no-implicit-globals': 'off',
        'node/callback-return': 'off',
        'typescript/no-unsafe-type-assertion': 'off',
      },
    },
    {
      files: ['scripts/**/*.mjs', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.mjs', 'e2e/**/*.ts'],
      rules: {
        'no-console': 'off',
        'no-restricted-imports': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-return': 'off',
        'typescript/no-unnecessary-condition': 'off',
        'typescript/strict-boolean-expressions': 'off',
        'typescript/no-confusing-void-expression': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/no-nested-ternary': 'off',
      },
    },
  ],
});
