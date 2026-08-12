const config = {
  $schema: './node_modules/oxfmt/configuration_schema.json',
  singleQuote: true,
  jsxSingleQuote: true,
  printWidth: 120,
  singleAttributePerLine: true,
  proseWrap: 'preserve',
  ignorePatterns: [
    'core/dist/**',
    'vscode/extension/out/**',
    'coverage/**',
    'vscode/extension/media/webview/**',
    'node_modules/**',
    'test/input/invalid/**',
    '.vscode-test/**',
    '.playwright/**',
  ],
};

export default config;
