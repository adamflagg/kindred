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
- **Custom hooks** — extract data fetching once a query has **2+ consumers** (`useSocialGraphData`, `useBunkNames`, `useSessionHierarchy`, `useLodgingAreas`, `useLodgingUnits`). A query with a single consumer is fine inline — don't extract pre-emptively.
- **Barrel exports** — directories use `index.ts` for clean imports

## Accessibility — deliberately minimal

**Read this before adding any ARIA attribute, `sr-only` text, or keyboard handler. This project has opted out of accessibility work, on purpose.**

The user base is **three people**, on laptops and desktop monitors, with a mouse and keyboard. There are no assistive-technology users and none planned. Mobile is rare and read-only — pulling up a camper detail or roster page. There is no legal requirement here. A default WCAG posture costs real work and buys this codebase nothing, which is how five days once went to an a11y sweep nobody asked for.

**DO add `aria-label` / `role` when it is the only handle a test can query a control by.** This is a *test-infrastructure* decision, not an accessibility one, and it is why the four `jsx-a11y` rules in `eslint.config.js` are still on: the suite addresses the UI through the accessibility tree (~1,721 `*ByRole` and ~309 `*ByLabelText` calls across ~141 test files), so a malformed role breaks the query layer far from the edit. An icon-only button needs a name — give it one.

**DO NOT add:**

- `sr-only` text — no one here reads it
- `aria-live` regions or `role="status"` announcements
- `aria-hidden` on lucide icons — lucide already emits it when you pass no a11y prop
- `role=` that merely restates the tag (`role="list"` on a `<ul>`, `role="img"` on an `<svg>`)
- keyboard handlers on non-controls, or roving-tabindex / arrow-key navigation

**DO prefer** converting `<div role="button" tabIndex={0} onKeyDown={…}>` into a plain `<button>`. That deletes three things and is the shape we want. Never go the other way.

### Traps, so a future sweep doesn't re-derive them

- **`sr-only` on an `<input>` or `<legend>` is a visually-hidden native control, not AT scaffolding.** The friend-group colour swatches are real radios hidden behind styled spans — delete the class and a raw grey radio button appears next to every swatch. Exclude these by hand; a classname sweep will eat them.
- **`aria-hidden` and `sr-only` both feed testing-library's accessible-name computation.** Removing either can change what `getByRole(…, { name })` matches in a file you did not touch. Change in batches, run the suite between them.
- **`components/ui/modalStack.ts` is overlay-ordering correctness, not accessibility**, despite the neighbourhood. `isTopOverlay()` is what stops one Escape closing two stacked overlays; `acquireBackgroundInert()` sets `inert`, which blocks **mouse clicks** through an open dialog. Escape-to-close and focus *restore* serve everyone. Do not remove any of it.
- **`ui/SortableColumnHeader.tsx`'s `aria-hidden` on the sort arrow is load-bearing.** Remove it and ↑/↓ folds into the accessible name of every sortable column across six tables.
- **`components/weekend/AccessibilityFlagList.tsx` has nothing to do with screen readers.** It renders families' *housing* needs — wheelchair access, CPAP power, bathroom proximity — on the weekend board. It matches every grep for "accessib".

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

## Caching — the tiers are opt-ins, and the default is a real choice

`utils/queryClient.ts` holds the app defaults (30 min stale, 60 min gc, no refetch on focus). `syncDataOptions` and `userDataOptions` in `queryKeys.ts` are the two named tiers; **inheriting the defaults is a third, legitimate option and is what the bunking board's primary read path does** (`hooks/session/useSessionData.ts` overrides nothing). Roughly 20 call sites use `userDataOptions` and are not thereby wrong — pick deliberately rather than reaching for a tier because one exists.

Two rules that are not negotiable:

- **Opting *down* to a short `staleTime` to catch external edits is the trap.** It re-pays the whole fetch on every window focus and evicts the cache minutes after you navigate away. Freshness after a write is bought with **explicit invalidation in the mutation**.
- **If you lengthen a `staleTime`, find every writer first.** The weekend roster's move to the app defaults left the lodging admin panels invalidating only their own registry keys, so a cabin confirmation stayed invisible on the roster for 30 minutes. `invalidateLodgingRegistryQueries` (`utils/queryKeys.ts`) is the fix and the pattern: one shared helper, invalidating by **prefix** where the writer cannot know the full key.

Background: `CLAUDE.md` §4 "Family Camp Models Summer".

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
