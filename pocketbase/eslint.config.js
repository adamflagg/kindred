import eslint from '@eslint/js';

export default [
  eslint.configs.recommended,
  {
    files: ['pb_migrations/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // PocketBase migration globals (Goja VM)
        // See: https://pocketbase.io/docs/js-migrations/
        migrate: 'readonly',
        Collection: 'readonly',
        Record: 'readonly',
        unmarshal: 'readonly',
        console: 'readonly',
      }
    },
    rules: {
      // Allow unused vars with underscore prefix (common for app parameter in down migrations)
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      'no-undef': 'error',
      'no-console': 'off',
    }
  },
  {
    files: ['pb_hooks/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',  // CommonJS-style for hooks
      globals: {
        // PocketBase hooks globals (Goja VM)
        $app: 'readonly',
        $os: 'readonly',
        $http: 'readonly',
        $security: 'readonly',
        $filesystem: 'readonly',
        $tokens: 'readonly',
        $mails: 'readonly',
        module: 'readonly',
        require: 'readonly',
        console: 'readonly',
        __hooks: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      'no-undef': 'error',
      'no-console': 'off',
    }
  }
];
