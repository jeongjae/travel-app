import babelParser from '@babel/eslint-parser';
import stylistic from '@stylistic/eslint-plugin';

// Syntax and readability only: TypeScript's own checker remains responsible for types.
// The TypeScript-ESLint parser does not yet support this project's TypeScript 7 compiler.
const typescriptParser = (isTSX) => ({
  parser: babelParser,
  parserOptions: {
    requireConfigFile: false,
    babelOptions: {
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', ...(isTSX ? ['jsx'] : [])] },
    },
  },
});

export default [
  {
    ignores: [
      '**/node_modules/**',
      '.cache/**',
      '.venv/**',
      'local-data/**',
      'backup/**',
      'dist/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: { '@stylistic': stylistic },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      curly: ['error', 'all'],
      '@stylistic/max-statements-per-line': ['error', { max: 1 }],
    },
  },
  { files: ['**/*.ts'], languageOptions: typescriptParser(false) },
  { files: ['**/*.tsx'], languageOptions: typescriptParser(true) },
];
