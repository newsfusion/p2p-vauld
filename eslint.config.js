import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import noUnsanitizedPlugin from 'eslint-plugin-no-unsanitized';
import globals from 'globals';

const restrictedCryptoImports = [
  {
    name: 'node:crypto',
    message: 'Chrome extension code must use the Web Crypto API.',
  },
  {
    name: 'crypto',
    message: 'Chrome extension code must use the Web Crypto API.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.agents/**',
      '.claude/**',
      '.codex/**',
      'test-results/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.d.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
        chrome: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: '19.2',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'no-unsanitized': noUnsanitizedPlugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/await-thenable': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/switch-exhaustiveness-check': 'warn',
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'no-restricted-imports': ['error', { paths: restrictedCryptoImports }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.type='Identifier'][object.object.name='chrome'][object.property.name='storage'][property.name='sync']",
          message:
            'chrome.storage.sync violates the local-only storage contract; use local or session storage.',
        },
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.type='Identifier'][object.object.name='chrome'][object.property.value='storage'][property.value='sync']",
          message:
            'chrome.storage.sync violates the local-only storage contract; use local or session storage.',
        },
        {
          selector:
            "VariableDeclarator[id.type='ObjectPattern'][init.type='MemberExpression'][init.object.type='Identifier'][init.object.name='chrome'][init.property.name='storage'] Property[key.name='sync']",
          message:
            'chrome.storage.sync violates the local-only storage contract; use local or session storage.',
        },
        {
          selector:
            "VariableDeclarator[id.type='ObjectPattern'][init.type='MemberExpression'][init.object.type='Identifier'][init.object.name='chrome'][init.property.value='storage'] Property[key.name='sync']",
          message:
            'chrome.storage.sync violates the local-only storage contract; use local or session storage.',
        },
        {
          selector:
            "VariableDeclarator[id.type='Identifier'][init.type='MemberExpression'][init.object.type='Identifier'][init.object.name='chrome']:matches([init.property.name='storage'], [init.property.value='storage'])",
          message:
            'Do not alias chrome.storage because aliases can bypass the local-only storage check.',
        },
        {
          selector:
            "VariableDeclarator[id.type='Identifier'][init.type='Identifier'][init.name='chrome']",
          message:
            'Do not alias chrome because aliases can bypass extension security checks.',
        },
        {
          selector:
            "VariableDeclarator[id.type='ObjectPattern'][init.type='Identifier'][init.name='chrome'] Property[key.name='storage']",
          message:
            'Do not alias chrome.storage because aliases can bypass the local-only storage check.',
        },
      ],
    },
  },
  reactHooksPlugin.configs.flat['recommended-latest'],
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['src/background/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'indexedDB',
          message:
            'The service worker must access IndexedDB through the offscreen DB proxy.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...restrictedCryptoImports,
            {
              name: 'dexie',
              message:
                'The service worker must access IndexedDB through the offscreen DB proxy.',
            },
          ],
          patterns: [
            {
              group: ['**/shared/db/index', '**/shared/db/index.js'],
              message:
                'The service worker must access IndexedDB through the offscreen DB proxy.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  }
);
