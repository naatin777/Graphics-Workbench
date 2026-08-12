import { defineConfig } from 'oxlint';

import baseConfig, {
  browserOnly,
  extensionOnly,
  restrictedImports,
  strictSourceRules,
  webviewPatterns,
} from '../oxlint.base.ts';

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
        ...restrictedImports(extensionOnly, webviewPatterns),
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
      files: ['webview/shared/**/*.ts', 'webview/apps/**/*.ts', 'webview/apps/**/*.tsx'],
      rules: strictSourceRules,
    },
    {
      files: ['webview/shared/pdf/install_map_get_or_insert_computed.ts'],
      rules: {
        'typescript/no-unsafe-type-assertion': 'off',
      },
    },
    {
      files: ['webview/apps/*/src/**/*.ts', 'webview/apps/*/src/**/*.tsx'],
      rules: {
        ...restrictedImports(browserOnly),
        'import/no-nodejs-modules': 'error',
      },
    },
    {
      files: ['webview/shared/**/*.ts'],
      rules: {
        ...restrictedImports(browserOnly),
        'import/no-nodejs-modules': 'error',
      },
    },
    {
      files: ['test/**/*.ts', 'webview/**/*.test.ts', 'webview/**/*.test.tsx'],
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
