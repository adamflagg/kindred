/**
 * Proves the guard relocation from §2 of the nav-consolidation plan is
 * total: every tab in MANAGE_TABS has a corresponding route in App.tsx
 * wrapped in the guard component its `access` demands (RequirePermission
 * for a permission tab, AdminRoute for an admin tab). ManageLayout carries
 * no blanket check anymore — this is the one place that proves nothing
 * slipped through ungated.
 *
 * Source-level assertion rather than a render test, since parsing the real
 * JSX tree isn't practical here — see reference_frontend_source_grep_tests;
 * SocialNetworkGraph.test.ts and RequestReviewPanel.test.tsx already anchor
 * on literal strings this way.
 *
 * If a tab is ever added without a guard, this fails.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { MANAGE_TABS } from './manageTabs'

const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')

// App.tsx's route `path` (relative to /manage) for each tab. Lodging and
// Config each have a bare index path too (`lodging`, `config`), but that's
// just a <Navigate> to the parameterized sub-route below — the sub-route is
// what actually renders content, so it's the one that must carry the guard.
const ROUTE_PATH: Record<string, string> = {
  geo: 'geo/*',
  registration: 'registration',
  sheets: 'sheets',
  lodging: 'lodging/:section',
  sync: 'sync',
  config: 'config/:category',
}

function manageBlock(): string {
  const start = appSource.indexOf('{/* Manage routes')
  const end = appSource.indexOf('{/* Summer Camp routes')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return appSource.slice(start, end)
}

// Slices out one <Route path="..."> entry, bounded by the next sibling
// route's `path=` attribute — not by the next `/>`, since a self-closing
// element nested inside this route's own element (e.g. <PageSkeleton />)
// would otherwise end the chunk early.
function routeChunk(block: string, routePath: string): string {
  const anchor = `path="${routePath}"`
  const anchorIndex = block.indexOf(anchor)
  expect(anchorIndex).toBeGreaterThan(-1)

  const nextPathIndex = block.indexOf('path="', anchorIndex + anchor.length)
  return block.slice(anchorIndex, nextPathIndex === -1 ? undefined : nextPathIndex)
}

describe('MANAGE_TABS guard coverage in App.tsx', () => {
  const block = manageBlock()

  it('covers every MANAGE_TABS id — fails loudly if a tab is added without updating ROUTE_PATH', () => {
    expect(Object.keys(ROUTE_PATH).sort()).toEqual(MANAGE_TABS.map((t) => t.id).sort())
  })

  MANAGE_TABS.forEach((tab) => {
    const routePath = ROUTE_PATH[tab.id]

    it(`guards "${tab.id}" (path="${routePath}") with the component its access demands`, () => {
      expect(routePath).toBeDefined()
      const chunk = routeChunk(block, routePath as string)
      const guard = tab.access.kind === 'admin' ? 'AdminRoute' : 'RequirePermission'
      const wrongGuard = tab.access.kind === 'admin' ? 'RequirePermission' : 'AdminRoute'
      expect(chunk).toContain(`<${guard}`)
      expect(chunk).not.toContain(`<${wrongGuard}`)
    })
  })
})
