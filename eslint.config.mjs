// Lint rules, including the dependency direction between layers:
//   ui → services → state, claude, platform, infra → core
// Only ui/ and extension.ts may use the editor API; core/ is pure; the webview can't reach Node.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const restrict = (paths, patterns = []) => ({
  'no-restricted-imports': [
    'error',
    {
      paths: paths.map((name) => ({
        name,
        message: 'Not allowed in this layer (see docs/ARCHITECTURE.md).',
      })),
      patterns,
    },
  ],
});
const NODE = [
  'fs',
  'node:fs',
  'child_process',
  'node:child_process',
  'os',
  'node:os',
  'path',
  'node:path',
  'crypto',
  'node:crypto',
];
const layer = (...names) =>
  names.map((n) => ({
    group: [`**/${n}`, `**/${n}/**`],
    message: `Not allowed in this layer: ${n}/ (see docs/ARCHITECTURE.md).`,
  }));

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'coverage/**', '.vscode-test/**', 'node_modules/**', '**/*.vsix'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/only-throw-error': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: { ...globals.node } },
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: restrict(
      ['vscode', ...NODE],
      layer('infra', 'claude', 'platform', 'state', 'services', 'ui', 'webview'),
    ),
  },
  {
    files: ['src/infra/**/*.ts'],
    rules: restrict(['vscode'], layer('claude', 'platform', 'state', 'services', 'ui', 'webview')),
  },
  {
    files: ['src/claude/**/*.ts', 'src/platform/**/*.ts'],
    rules: restrict(['vscode'], layer('state', 'services', 'ui', 'webview')),
  },
  { files: ['src/state/**/*.ts'], rules: restrict(['vscode'], layer('services', 'ui', 'webview')) },
  { files: ['src/services/**/*.ts'], rules: restrict(['vscode'], layer('ui', 'webview')) },
  {
    files: ['src/shared/**/*.ts'],
    rules: restrict(
      ['vscode', ...NODE],
      layer('core', 'infra', 'claude', 'platform', 'state', 'services', 'ui', 'webview'),
    ),
  },
  {
    files: ['src/webview/**/*.ts'],
    rules: restrict(
      ['vscode', ...NODE],
      layer('core', 'infra', 'claude', 'platform', 'state', 'services', 'ui'),
    ),
  },
  {
    files: ['src/uninstall/**/*.ts'],
    rules: { ...restrict(['vscode'], layer('services', 'ui', 'webview')), 'no-console': 'off' },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
