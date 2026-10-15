import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Layering: only repositories (and db/scripts) may touch Mongoose models.
    files: ['src/**/*.js'],
    ignores: ['src/**/repository.js', 'src/models/**', 'src/db.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/models/*', '**/models'], message: 'Query through the module repository instead of importing models directly.' }] }],
    },
  },
];
