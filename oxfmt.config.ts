const config = {
  $schema: './node_modules/oxfmt/configuration_schema.json',
  singleQuote: true,
  jsxSingleQuote: true,
  printWidth: 120,
  singleAttributePerLine: true,
  proseWrap: 'preserve',
  ignorePatterns: [
    'out/**',
    'dist/**',
    'coverage/**',
    'media/webview/**',
    'node_modules/**',
    'test/input/invalid/**',
    '.vscode-test/**',
    '.playwright/**',
  ],
};

export default config;
