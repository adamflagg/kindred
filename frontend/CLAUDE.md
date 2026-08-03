# frontend/

React + TypeScript + Vite. Dev server on `:3000` (HMR); prod served via Caddy at `:8080`. Tests: **Vitest, not Jest.**

## Layout

| Dir | Purpose |
|-----|---------|
| `src/components/` | Reusable React components |
| `src/components/graph/` | Social network graph modules (styles, interactions, layout, UI) |
| `src/pages/` | Route-level components |
| `src/hooks/` | Custom React hooks (data fetching, state) |
| `src/services/` | API clients, business logic |
| `src/types/` | TypeScript type definitions |
| `src/lib/` | Third-party integrations |
| `src/contexts/` | React context providers |
| `src/tours/definitions/` | Onboarding tour scripts |
| `src/utils/queryKeys.ts` | Centralized React Query keys — use these, don't inline strings |

## Component patterns

- **Modular extraction** — large components (e.g. `SocialNetworkGraph.tsx`) decompose into utility modules
- **Custom hooks** — data fetching extracted (`useSocialGraphData`, `useBunkNames`, `useSessionHierarchy`)
- **Barrel exports** — directories use `index.ts` for clean imports

## Error handling — non-negotiable

- **Page-level `<ErrorBoundary>`** — every lazy-loaded route in `App.tsx` is wrapped with `<ErrorBoundary>` around `<Suspense>`. Isolates crashes to the affected page. New routes MUST follow this pattern.
- **`<QueryGuard>`** (`components/QueryGuard.tsx`) — render-prop component for loading/error/empty/success states on React Query data. Use it in new data-fetching pages. Existing pages use inline patterns — don't refactor unless already touching them.
- **All 4 states must be handled** — loading, error, empty, success. Never render a data-dependent component without checking query state first.

## Auth — easy to get wrong

- **`useAuth().isLoading` first.** Always check `isLoading` before making authenticated API calls.
- **PB JWT lives in `localStorage`, not cookies.** Calling `fetch` with `credentials: 'include'` silently 401s on protected endpoints. Obtain `fetchWithAuth` from the `useApiWithAuth()` hook (`hooks/useApiWithAuth.ts`) and pass it into service functions — services take it as a parameter, they don't export it.
- **Bypass-auth mode** grants admin via `usePermissions().isAdmin`, NOT `useAuth().user.is_admin`.

## React Query keys

Use the centralized keys from `src/utils/queryKeys.ts`. Inlining string keys causes cache collisions and silent bugs when invalidation misses the right query.

## Caching — inherit the defaults

**Set no cache options unless you can say why.** `utils/queryClient.ts` holds the app defaults (30 min stale, 60 min gc, no refetch on focus) and the summer bunking board runs on them — `hooks/session/useSessionData.ts` overrides nothing. `syncDataOptions` / `userDataOptions` in `queryKeys.ts` are opt-ins, not a menu you must choose from.

Opting *down* to short caching to catch external edits is the trap: it re-pays the whole fetch on every window focus and evicts the cache minutes after you navigate away. Freshness after a write is bought with **explicit invalidation in the mutation**, not with a short `staleTime`. The weekend roster made this mistake and it is documented in `CLAUDE.md` §4 "Family Camp Models Summer".

## Derived values in page components

Anything that builds a model to read a number belongs in `useMemo`. `WeekendRosterPage` built the full board index *and* the full map model on every render — for two tab-badge counts, on every tab, whether or not the board or map was mounted. Memoize on the payload, and put `?? []` fallbacks **inside** the memo: a bare `?? []` mints a new array each render and defeats every dependency list below it.

## Tour maintenance

When modifying page layout, features, or `data-tour` attributes on a toured page, review the corresponding tour in `src/tours/definitions/`:

- [ ] `data-tour` attributes still reference correct elements
- [ ] `isReady()` still checks the right element
- [ ] Step/hint descriptions match current behavior
- [ ] Bump `version` if steps changed (triggers re-play for returning users)

## Build & test

```bash
cd frontend && npm run dev                            # dev server (HMR)
cd frontend && npm run build                          # production bundle
cd frontend && npm run lint
cd frontend && npm run type-check
cd frontend && npx vitest run                         # one-shot tests
cd frontend && npx vitest run src/path/file.test.ts   # single test
```

Pre-push runs `tsc --noEmit` for both `tsconfig.json` and `tsconfig.node.json`. Prettier runs at commit time; eslint and vitest run in CI only. Failing pre-push blocks push.

## Worktree-specific notes

In a fresh worktree, hit the **Vite dev port printed by `new.sh`** (the port offset is hashed from the feature name — `localhost:3010`, `3080`, etc. depending on the worktree), not the Caddy port. Caddy serves the stale built bundle from `pocketbase/pb_public/`.

## Private config

`frontend/vite.config.local.ts` is symlinked from `~/kindred-local/`. Don't commit it. The build falls back to defaults if missing.

## Tech versions

React 19, TypeScript 6.0+/ES2022, Vite, Tailwind CSS, @tanstack/react-query, @dnd-kit, Cytoscape.js. Node 22+.
