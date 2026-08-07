import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript ESLint recommended rules
  ...tseslint.configs.recommended,
  // Add strict rules for TypeScript 5.8
  ...tseslint.configs.strict,

  // React Refresh Vite preset
  reactRefresh.configs.vite({ allowConstantExport: true }),

  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '*.cjs',
      'src/types/pocketbase-types.ts',
      'src/types/api-generated/**',
      'vite.config.local.ts',
    ],
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
      },
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
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      // ── jsx-a11y (kindred#2063, kindred#2068) ────────────────────────
      // The recommended set, split by what this codebase already satisfies.
      //
      // 27 of the 34 recommended rules pass on the tree TODAY, so they are
      // errors: they cost nothing now and they cannot regress. The remaining
      // 7 have pre-existing violations (133 at the time of writing) and are
      // warnings, so the gate lands without turning CI red on code nobody is
      // touching. Promote each to 'error' as its count reaches zero — that
      // ratchet is the point; a permanent warning is a backlog, not a gate.
      //
      // What this plugin does NOT do: judge whether an aria-label is
      // meaningful, or whether focus order makes sense. It catches structural
      // mistakes only. The ~290 hand-written aria-* attributes here remain
      // hand-maintained. The self-interested case is the test suite — it calls
      // getByRole over 1,200 times, so a broken role breaks the query layer.
      ...jsxA11y.flatConfigs.recommended.rules,

      // Violated today — warn, then promote. Counts as of 2026-08-07:
      'jsx-a11y/click-events-have-key-events': 'warn', //           44
      'jsx-a11y/no-static-element-interactions': 'warn', //         42
      'jsx-a11y/label-has-associated-control': 'warn', //           27
      'jsx-a11y/no-autofocus': 'warn', //                            9
      'jsx-a11y/no-redundant-roles': 'warn', //                      7
      'jsx-a11y/no-noninteractive-element-interactions': 'warn', //  2
      'jsx-a11y/no-interactive-element-to-noninteractive-role': 'warn', // 2

      // React Hooks rules - core rules as errors, compiler rules as warnings
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // React Compiler rules - enabled as warnings for gradual adoption
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',

      // TypeScript rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      // TypeScript strict rules (no type checking required)
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      '@typescript-eslint/consistent-type-definitions': ['warn', 'interface'],
      '@typescript-eslint/array-type': ['warn', { default: 'array-simple' }],

      // Type-checked correctness rules (require parserOptions.projectService)
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      // Type-checked quality rules
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/consistent-type-exports': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',

      // Type-checked style rules
      '@typescript-eslint/prefer-string-starts-ends-with': 'warn',
      '@typescript-eslint/prefer-includes': 'warn',
      '@typescript-eslint/prefer-reduce-type-parameter': 'warn',
    },
  },

  // Test file overrides - non-null assertions are idiomatic in tests
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Prettier config - MUST be last to override conflicting rules
  eslintConfigPrettier
)
