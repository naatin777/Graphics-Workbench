import { defineConfig, type OxlintOverride } from 'oxlint';

const extensionOnly = [
  {
    name: 'solid-js',
    message: 'Solid is Webview frontend-only.',
  },
  {
    name: 'solid-js/web',
    message: 'Solid DOM rendering is Webview frontend-only.',
  },
  {
    name: 'pdfjs-dist',
    message: 'PDF.js belongs in Webview frontend.',
  },
  {
    name: 'vite',
    message: 'Vite belongs in Webview build config.',
  },
  {
    name: 'vite-plugin-solid',
    message: 'vite-plugin-solid belongs in Webview build config.',
  },
];

const browserOnly = [
  {
    name: 'vscode',
    message: 'Webview frontend must use the acquireVsCodeApi wrapper.',
  },
  {
    name: 'fs',
    message: 'Webview frontend must not import Node fs.',
  },
  {
    name: 'node:fs',
    message: 'Webview frontend must not import Node fs.',
  },
  {
    name: 'path',
    message: 'Webview frontend must not import Node path.',
  },
  {
    name: 'node:path',
    message: 'Webview frontend must not import Node path.',
  },
  {
    name: 'child_process',
    message: 'Webview frontend must not execute external processes.',
  },
  {
    name: 'node:child_process',
    message: 'Webview frontend must not execute external processes.',
  },
  {
    name: 'os',
    message: 'Webview frontend must not import Node os.',
  },
  {
    name: 'node:os',
    message: 'Webview frontend must not import Node os.',
  },
  {
    name: 'crypto',
    message: 'Use Web Crypto in Webview frontend.',
  },
  {
    name: 'node:crypto',
    message: 'Use Web Crypto in Webview frontend.',
  },
];

const corePaths = [
  {
    name: 'vscode',
    message: 'Core code must not import the VS Code API.',
  },
  ...extensionOnly,
];

const corePatterns = [
  {
    group: ['../commands/*', '../../commands/*'],
    message: 'Core code must not import command/UI code.',
  },
  {
    group: ['../presentation/*', '../../presentation/*'],
    message: 'Core code must not import Webview presentation code.',
  },
  {
    group: ['@webview-shared/*', '../../presentation/*', '../../../presentation/*'],
    message: 'Core code must not import Webview modules.',
  },
];

const frontendPatterns = [
  {
    group: ['../../src/*', '../../../src/*', '../../../../src/*'],
    message: 'Webview frontend must not import extension runtime modules.',
  },
];

const restrictedImports = (
  paths: { name: string; message: string }[],
  patterns: { group: string[]; message: string }[] = frontendPatterns,
): NonNullable<OxlintOverride['rules']> => ({
  'no-restricted-imports': [
    'error',
    {
      paths,
      patterns,
    },
  ],
});

const appOverrides: OxlintOverride[] = [
  {
    files: ['webview/apps/*/src/**/*.ts', 'webview/apps/*/src/**/*.tsx'],
    rules: restrictedImports(browserOnly, [
      ...frontendPatterns,
      {
        group: ['../*/src/*', '../../*/src/*'],
        message: 'Webview frontend must not import another app.',
      },
    ]),
  },
  {
    files: ['webview/shared/**/*.ts'],
    rules: restrictedImports(browserOnly, [
      {
        group: ['../apps/*', '../../apps/*'],
        message: 'webview/shared must not import app-specific modules.',
      },
      {
        group: ['../src/*', '../../src/*', '../../../src/*'],
        message: 'webview/shared must not import extension runtime.',
      },
    ]),
  },
];

export default defineConfig({
  plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import', 'node', 'promise'],

  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'warn',
  },

  options: {
    reportUnusedDisableDirectives: 'error',
    typeAware: true,
  },

  ignorePatterns: [
    'out/**',
    'dist/**',
    'coverage/**',
    'media/webview/**',
    'node_modules/**',
    '.vscode-test/**',
    '.playwright/**',
  ],

  jsPlugins: [
    {
      name: 'project',
      specifier: './scripts/oxlint-project-plugin.mjs',
    },
  ],

  rules: {
    /*
     * Basic safety and readability
     */
    curly: ['error', 'all'],
    eqeqeq: 'error',
    'no-console': 'error',
    'no-await-in-loop': 'off',
    'eslint/no-constant-condition': 'error',
    'eslint/no-duplicate-case': 'error',
    'eslint/prefer-const': 'error',
    'eslint/no-prototype-builtins': 'error',
    'eslint/no-unsafe-optional-chaining': 'error',
    complexity: ['error', { max: 20 }],
    'max-depth': ['error', { max: 4 }],
    'max-params': ['error', { max: 5 }],
    'eslint/max-classes-per-file': ['error', 1],
    'eslint/no-implicit-coercion': 'error',
    'eslint/no-unsafe-finally': 'error',
    'eslint/no-unreachable-loop': 'error',
    'eslint/no-duplicate-imports': 'error',
    'import/no-cycle': 'error',
    'import/no-duplicates': 'error',
    'import/newline-after-import': 'error',
    'no-warning-comments': 'error',
    'unicorn/no-negated-condition': 'error',
    'unicorn/prefer-ternary': 'error',
    'unicorn/switch-case-braces': 'error',
    'eslint/no-else-return': 'error',
    'eslint/no-lonely-if': 'error',
    'eslint/no-useless-catch': 'error',
    'eslint/object-shorthand': 'error',
    'typescript/no-this-alias': 'error',
    'typescript/default-param-last': 'error',
    'typescript/prefer-readonly': 'error',
    'unicorn/prefer-optional-catch-binding': 'error',
    'unicorn/consistent-function-scoping': 'error',

    /*
     * TypeScript
     */
    'no-unused-vars': 'off',
    'typescript/no-unused-vars': 'error',
    'typescript/consistent-type-imports': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-empty-object-type': 'error',
    'typescript/array-type': 'error',
    'typescript/no-redundant-type-constituents': 'error',
    'typescript/no-duplicate-enum-values': 'error',
    'typescript/no-empty-function': 'error',
    'typescript/no-extraneous-class': 'error',
    'typescript/no-unnecessary-parameter-property-assignment': 'error',
    'typescript/no-unsafe-function-type': 'error',
    'typescript/no-useless-constructor': 'error',
    'typescript/no-require-imports': 'error',
    'typescript/explicit-function-return-type': 'error',
    'typescript/no-unnecessary-type-assertion': 'error',
    'typescript/unified-signatures': 'error',
    'typescript/prefer-nullish-coalescing': 'error',
    'eslint/no-underscore-dangle': ['error', { allow: ['_electron'] }],
    'import/no-unassigned-import': [
      'error',
      {
        allow: ['**/*.css', '**/install_map_get_or_insert_computed', 'pdfjs-dist/build/pdf.worker.mjs'],
      },
    ],
    'unicorn/prefer-string-replace-all': 'error',
    'unicorn/no-array-sort': 'error',
    'unicorn/no-object-as-default-parameter': 'error',
    'unicorn/no-array-for-each': 'error',
    'unicorn/no-array-callback-reference': 'error',
    'unicorn/no-array-reduce': 'error',
    'unicorn/no-useless-switch-case': 'error',
    'unicorn/prefer-set-has': 'error',
    'typescript/prefer-find': 'error',
    'typescript/prefer-includes': 'error',
    'unicorn/prefer-dom-node-text-content': 'error',
    'unicorn/prefer-global-this': 'error',

    /*
     * Error handling
     *
     * no-throw-literal is deprecated in favor of the type-aware rule.
     */
    'no-throw-literal': 'off',
    'typescript/only-throw-error': [
      'error',
      {
        allowRethrowing: false,
        allowThrowingAny: false,
        allowThrowingUnknown: false,
      },
    ],
    'typescript/prefer-promise-reject-errors': [
      'error',
      {
        allowEmptyReject: false,
        allowThrowingAny: false,
        allowThrowingUnknown: false,
      },
    ],

    /*
     * Promise correctness
     */
    'eslint/no-promise-executor-return': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-misused-promises': 'error',
    'unicorn/no-useless-promise-resolve-reject': 'error',

    /*
     * Exhaustiveness
     */
    'typescript/switch-exhaustiveness-check': [
      'error',
      {
        allowDefaultCaseForExhaustiveSwitch: true,
        considerDefaultExhaustiveForUnions: false,
        requireDefaultForNonUnion: false,
      },
    ],
    'typescript/no-unsafe-argument': 'error',
    'typescript/no-unsafe-assignment': 'off',
    'typescript/no-unsafe-call': 'off',
    'typescript/no-unsafe-member-access': 'off',
    'typescript/no-unsafe-return': 'off',
    'typescript/no-unsafe-type-assertion': 'error',
    'typescript/no-unnecessary-condition': 'off',

    /*
     * Imports and runtime conventions
     */
    'unicorn/prefer-node-protocol': 'error',
    'import/no-nodejs-modules': 'off',
    'node/no-process-env': 'off',

    /*
     * Promise plugin rules superseded or intentionally disabled
     */
    'promise/always-return': 'off',
    'promise/catch-or-return': 'off',
    'promise/no-new-statics': 'error',
    'promise/no-return-wrap': 'error',
    'promise/prefer-await-to-then': 'error',

    /*
     * Project-specific rules
     */
    'project/max-conditional-spreads-per-object': 'error',
    'project/max-flat-type-members': 'error',
    'project/forbid-raster-input-limit-bypass': 'error',
    'project/no-fixed-e2e-wait': 'error',
    'project/no-webview-api-bypass': 'error',
    'project/require-webview-listener-cleanup': 'error',
    'project/require-process-envelope': 'error',
    'project/no-pdf-bytes-in-process-ipc': 'error',
    'project/no-secret-output-log': 'error',
    'project/no-direct-child-process': 'error',
  },

  overrides: [
    {
      files: ['.vscode-test.mjs'],
      rules: {
        // @vscode/test-cli re-exports defineConfig through a .cjs→.mjs chain; oxlint's import resolution reports a false positive.
        'import/named': 'off',
      },
    },
    {
      files: ['webview/shared/pdf/install_map_get_or_insert_computed.ts'],
      rules: {
        // PDF.js Map polyfill installs onto the global Map prototype as a script module.
        'import/unambiguous': 'off',
        'eslint/no-implicit-globals': 'off',
        'node/callback-return': 'off',
      },
    },
    {
      files: [
        'src/**/*.ts',
        'webview/apps/**/*.ts',
        'webview/apps/**/*.tsx',
        'webview/shared/**/*.ts',
        'scripts/**/*.mjs',
        '.github/scripts/**/*.mjs',
      ],
      rules: {
        'typescript/no-unsafe-assignment': 'error',
        'typescript/no-unnecessary-condition': 'error',
        'typescript/no-unsafe-return': 'error',
        'typescript/promise-function-async': 'error',
        'typescript/no-confusing-void-expression': 'error',
        'typescript/strict-boolean-expressions': 'error',
        'typescript/strict-void-return': 'error',
        'typescript/no-non-null-assertion': 'error',
        'unicorn/no-await-expression-member': 'error',
        'unicorn/no-useless-undefined': 'error',
        'unicorn/no-nested-ternary': 'error',
      },
    },
    {
      files: ['scripts/generate-extension-meta.ts'],
      rules: {
        // This strip-types build script's local type declarations are not resolved by single-file type-aware lint.
        'typescript/no-unsafe-argument': 'off',
      },
    },
    {
      files: ['scripts/oxlint-project-plugin.mjs'],
      rules: {
        // The custom plugin consumes Oxlint's untyped ESTree visitor API.
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-return': 'off',
        complexity: 'off',
        'max-params': 'off',
        'eslint/max-classes-per-file': 'off',
        'eslint/no-unreachable-loop': 'off',
        'typescript/strict-boolean-expressions': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/no-nested-ternary': 'off',
        'unicorn/prefer-string-replace-all': 'off',
      },
    },
    {
      files: ['scripts/oxlint-project-plugin.test.mjs'],
      rules: {
        // The test exercises the untyped AST helper exported by the custom plugin.
        'typescript/no-unsafe-assignment': 'off',
        complexity: 'off',
        'max-params': 'off',
        'eslint/max-classes-per-file': 'off',
        'eslint/no-unreachable-loop': 'off',
      },
    },
    {
      files: ['src/application/**/*.ts', 'src/operations/**/*.ts', 'src/config/**/*.ts'],
      rules: restrictedImports(corePaths, corePatterns),
    },
    {
      files: ['src/config/extension_configuration.ts'],
      rules: restrictedImports(extensionOnly, corePatterns),
    },
    {
      files: ['src/commands/**/*.ts', 'src/presentation/**/*.ts', 'src/extension.ts'],
      rules: restrictedImports(extensionOnly, [
        {
          group: ['../../webview/apps/*', '../../../webview/apps/*', '@webview-shared/*'],
          message: 'Extension runtime must not import Webview frontend.',
        },
      ]),
    },

    ...appOverrides,

    {
      files: [
        'webview/vite.config.ts',
        'webview/vitest.config.ts',
        'webview/apps/*/vite.config.ts',
        'webview/apps/*/vitest.config.ts',
        'scripts/**/*.mjs',
      ],
      rules: {
        'no-console': 'off',
        'no-restricted-imports': 'off',
      },
    },
    {
      files: ['test/**/*.ts', 'src/**/*.test.ts', 'webview/**/*.test.ts', 'webview/**/*.test.tsx'],
      rules: {
        'no-console': 'off',
        complexity: 'off',
        'max-params': 'off',
        'eslint/max-classes-per-file': 'off',
        'eslint/no-promise-executor-return': 'off',
        'eslint/no-unreachable-loop': 'off',
        'typescript/no-explicit-any': 'off',
        'typescript/no-empty-function': 'off',
        'typescript/explicit-function-return-type': 'off',
        'typescript/no-floating-promises': 'off',
        'promise/prefer-await-to-then': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unnecessary-condition': 'off',

        /*
         * Phase 39: rule batch with resolved violations
         */
        'typescript/consistent-indexed-object-style': 'error',
        'typescript/consistent-type-assertions': 'error',
        'unicorn/custom-error-definition': 'error',
        'unicorn/prefer-number-coercion': 'error',
        'typescript/parameter-properties': 'error',
        'unicorn/prefer-code-point': 'error',
        'typescript/return-await': 'error',
        'typescript/no-deprecated': 'error',
        'unicorn/prefer-query-selector': 'error',
        'import/named': 'error',
        'import/no-anonymous-default-export': 'error',
        'unicorn/no-process-exit': 'error',
        'typescript/dot-notation': 'error',
        'typescript/no-dynamic-delete': 'error',
        'eslint/no-regex-spaces': 'error',
        'eslint/func-names': 'error',
        'node/callback-return': 'error',
        'eslint/default-case': 'error',
        'typescript/explicit-module-boundary-types': 'error',
        'import/unambiguous': 'error',
        'eslint/no-implicit-globals': 'error',
        'typescript/no-unsafe-return': 'off',
        'typescript/promise-function-async': 'off',
        'typescript/no-non-null-assertion': 'off',
        'typescript/no-confusing-void-expression': 'off',
        'typescript/strict-boolean-expressions': 'off',
        'typescript/strict-void-return': 'off',
        'unicorn/no-await-expression-member': 'off',
        'unicorn/no-array-callback-reference': 'off',
        'unicorn/no-useless-undefined': 'off',
        'unicorn/no-nested-ternary': 'off',
        'unicorn/no-negated-condition': 'off',
        'unicorn/no-object-as-default-parameter': 'off',
        'unicorn/no-array-for-each': 'off',
        'unicorn/prefer-dom-node-text-content': 'off',
        'unicorn/consistent-function-scoping': 'off',
      },
    },
  ],
});
