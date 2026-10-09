/**
 * Every /aid route in App.tsx carries its own guard (spec §3.1: "every /aid route carries
 * RequirePermission"). Source-level, like manageTabs.guard.test.ts: rendering App's provider
 * stack isn't practical. If a route is added without a guard, or without a line here, this fails.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')

type Guard = 'view' | 'open' | 'viewOrGrantors' | 'redirect'

// The route (relative to /aid) and the guard its surface demands (config/aidNav.ts).
const ROUTES: Record<string, Guard> = {
  index: 'open',
  requests: 'view',
  // Old /aid/grants/* links: a redirect with no guard of its own; the Money route it lands on guards.
  'grants/*': 'redirect',
  'money/:tab?': 'viewOrGrantors',
  'season/:tab?': 'view',
  'reports/:tab?': 'open',
  // Old Development addresses: AidReportsPage redirects them, under the same open guard.
  'reports/development/:view': 'open',
  'households/:householdCmId': 'view',
}

const GUARD_TEXT: Record<Guard, string> = {
  view: 'permission={Permission.FINANCIAL_AID_VIEW}',
  open: 'anyOf={[...CAMPERSHIPS_OPEN_PERMISSIONS]}',
  viewOrGrantors: 'anyOf={[...MONEY_OPEN_PERMISSIONS]}',
  redirect: '<AidGrantsRedirect />',
}

function aidBlock(): string {
  const start = appSource.indexOf('{/* Camperships routes')
  const end = appSource.indexOf('{/* Weekend Housing routes')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return appSource.slice(start, end)
}

function routeChunk(block: string, route: string): string {
  const at = route === 'index' ? block.search(/<Route\s+index/) : block.indexOf(`path="${route}"`)
  expect(at).toBeGreaterThan(-1)
  const next = block.indexOf('path="', at + 1)
  return block.slice(at, next === -1 ? undefined : next)
}

describe('Camperships routes in App.tsx', () => {
  const block = aidBlock()

  it('names every route the block declares, so none slips through unguarded', () => {
    const declared = [...block.matchAll(/path="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((p) => p !== '/aid')
    expect(declared.sort()).toEqual(
      Object.keys(ROUTES)
        .filter((r) => r !== 'index')
        .sort()
    )
  })

  it('redirects the old Grants URLs without a guard of their own, to a guarded Money route', () => {
    const chunk = routeChunk(block, 'grants/*')
    expect(chunk).toContain('<AidGrantsRedirect />')
    expect(chunk).not.toContain('RequirePermission')
  })

  it.each(Object.entries(ROUTES).filter(([, g]) => g !== 'redirect'))(
    'guards %s with %s, outermost',
    (route, guard) => {
      const chunk = routeChunk(block, route)
      // The guard is the route's element, then ErrorBoundary, then Suspense: never inside either.
      const nesting = /element=\{\s*<RequirePermission[^>]*>\s*<ErrorBoundary>\s*<Suspense/
      expect(chunk).toMatch(nesting)
      expect(chunk.match(/element=\{\s*<(\w+)/)?.[1]).toBe('RequirePermission')
      expect(chunk).toContain(GUARD_TEXT[guard])
    }
  )
})
