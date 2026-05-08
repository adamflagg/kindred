# Frontend Verification Checklist

All commands run from the `frontend/` directory.

## 1. Format

```bash
cd frontend && npx prettier --write "src/**/*.{ts,tsx,js,jsx,json,css}"
```

Auto-fixes formatting. Run before linting.

To check without writing (dry run):
```bash
cd frontend && npx prettier --check "src/**/*.{ts,tsx,js,jsx,json,css}"
```

## 2. Lint

```bash
cd frontend && npm run lint
```

This runs `eslint . --ext ts,tsx --report-unused-disable-directives`. Uses the flat config in `eslint.config.js`.

Do NOT run `npx eslint` directly with different flags -- the `npm run lint` script has the correct configuration.

Common lint issues:
- **react-hooks/exhaustive-deps**: Missing dependencies in useEffect/useMemo/useCallback. Add them or justify with a comment.
- **react-refresh/only-export-components**: Only export components from files that use HMR. Move non-component exports to separate files.
- **@typescript-eslint/no-unused-vars**: Remove unused variables or prefix with underscore.

## 3. Type Check

```bash
cd frontend && npm run type-check
```

This runs TWO commands: `tsc --noEmit && tsc --noEmit -p tsconfig.node.json`. Both must pass.

- `tsconfig.json`: Covers `src/` (application code)
- `tsconfig.node.json`: Covers Vite config, test config, and other Node-side files

Common type failures:
- **`noUncheckedIndexedAccess`**: Array/object index access returns `T | undefined`. Add a null check before using the value.
- **`exactOptionalPropertyTypes`**: Cannot assign `undefined` to an optional property explicitly. Use `delete obj.prop` or omit the property entirely.
- **`noPropertyAccessFromIndexSignature`**: Use bracket notation (`obj["key"]`) for index signature access, not dot notation.
- **`verbatimModuleSyntax`**: Use `import type { X }` for type-only imports, not `import { X }`.

## 4. Tests

```bash
cd frontend && npx vitest run
```

Runs all tests once (no watch mode). Uses `vitest` (not Jest).

To run a specific test:
```bash
cd frontend && npx vitest run src/path/file.test.ts
```

## Common Gotchas

- **Vitest, not Jest**: This project uses Vitest. Do not use Jest APIs (`jest.fn()`) -- use Vitest equivalents (`vi.fn()`).
- **React 19**: The project uses React 19. Be aware of changes to `forwardRef` (no longer needed), `use()` hook, and other React 19 features.
- **Tailwind CSS v4**: Uses `@tailwindcss/vite` plugin. Class names follow v4 conventions.
- **Path aliases**: `@/*` maps to `src/*` (configured in `tsconfig.json`). Use `@/components/...` not relative paths from deep nesting.
- **Query keys**: Use centralized keys from `src/utils/queryKeys.ts`. Do not hardcode query key strings.
- **ErrorBoundary + Suspense**: Every lazy-loaded route must be wrapped in `<ErrorBoundary>` around `<Suspense>`. Check `App.tsx` when adding new routes.
- **`npm run type-check` checks two configs**: If you only run `tsc --noEmit`, you miss errors in `tsconfig.node.json` files (Vite config, vitest config, etc.).
