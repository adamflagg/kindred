import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // Base ESLint recommended rules
  eslint.configs.recommended,
  
  // TypeScript ESLint recommended rules
  ...tseslint.configs.recommended,
  // Add strict rules for TypeScript 5.8
  ...tseslint.configs.strict,
  
  // Ignore patterns
  {
    ignores: ['dist/**', 'node_modules/**', '*.cjs']
  },
  
  // Configuration for JS files
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: true,
        process: true,
        __dirname: true,
        __filename: true,
        Buffer: true,
        global: true,
      }
    },
  },
  
  // Main configuration for TypeScript
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: true,
        document: true,
        console: true,
        process: true,
        Buffer: true,
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React Hooks rules - core rules as errors, compiler rules as warnings
      // Phase 1.1-1.5 improved patterns in LoginPage, RightPanelContainer,
      // CamperDetailsPanel, ScenarioContext, AuthContext
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',  // Promoted from warn - all violations fixed
      // React Compiler rules - enabled as warnings for gradual adoption
      // Full adoption requires more extensive refactoring
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',

      // React Refresh rules
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true }
      ],
      
      // TypeScript rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' }
      ],
      
      // TypeScript 5.8 strict rules (no type checking required)
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', {
        prefer: 'type-imports',
        disallowTypeAnnotations: true
      }],
      '@typescript-eslint/consistent-type-definitions': ['warn', 'interface'],
      '@typescript-eslint/array-type': ['warn', { default: 'array-simple' }],
      // Rules that require type checking are commented out
      // '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      // '@typescript-eslint/prefer-optional-chain': 'warn',
      // '@typescript-eslint/strict-boolean-expressions': 'off',
      // '@typescript-eslint/no-unnecessary-condition': 'off',
    }
  }
);