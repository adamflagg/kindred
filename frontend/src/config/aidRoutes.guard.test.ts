/**
 * Every /aid route in App.tsx carries its own guard (spec §3.1: "every /aid route carries
 * RequirePermission"). Source-level, like manageTabs.guard.test.ts: rendering App's provider
 * stack isn't practical. If a route is added without a guard, or without a line here, this fails.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')

type Guard = 'view' | 'open' | 'admin'

// The route (relative to /aid) and the guard its surface demands (config/aidNav.ts).
const ROUTES: Record<string, Guard> = {
  index: 'open',
  requests: 'view',
  'grants/:tab?': 'view',
  'money/:tab?': 'view',
  'season/:tab?': 'view',
  'reports/:tab?': 'open',
  'households/:householdCmId': 'view',
}

const GUARD_TEXT: Record<Guard, string> = {
  view: 'permission={Permission.FINANCIAL_AID_VIEW}',
  open: 'anyOf={[...CAMPERSHIPS_OPEN_PERMISSIONS]}',
  admin: '<AdminRoute',
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

  it.each(Object.entries(ROUTES))('guards %s with %s', (route, guard) => {
    const chunk = routeChunk(block, route)
    expect(chunk).toContain(GUARD_TEXT[guard])
    expect(chunk).toContain('<ErrorBoundary>')
  })
})
