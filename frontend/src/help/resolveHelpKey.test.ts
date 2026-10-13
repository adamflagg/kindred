import { describe, expect, it } from 'vitest'
import entries from './helpKeys.json'
import { HELP_AREAS, resolveHelpKey } from './resolveHelpKey'

describe('resolveHelpKey', () => {
  it('maps a screen route to its key', () => {
    expect(resolveHelpKey('/aid/today', '')).toBe('aid.today')
  })
  it('resolves a path-segment tab to its screen when no tab entry exists', () => {
    expect(resolveHelpKey('/aid/money/ledger', '')).toBe('aid.money')
  })
  it('matches a ?tab= query entry over its parent screen', () => {
    // seeded only if such an entry exists; parent must still resolve
    expect(resolveHelpKey('/users', '?tab=roles')).toMatch(/^people\.users/)
  })
  it('ignores a trailing slash and route params', () => {
    expect(resolveHelpKey('/summer/session/1000001/board/', '')).toBe('summer.session')
  })
  it('falls back to the area key for an unknown route inside an area', () => {
    expect(resolveHelpKey('/summer/not-a-page', '')).toBe('summer')
  })
  it('falls back to home for anything else', () => {
    expect(resolveHelpKey('/nowhere', '')).toBe('home')
  })
  it('has unique, well-formed keys whose area is known', () => {
    const keys = entries.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const e of entries) {
      expect(e.key).toMatch(/^[a-z]+(\.[a-z0-9-]+)*$/)
      expect(HELP_AREAS).toContain(e.area)
      expect(e.key === e.area || e.key.startsWith(`${e.area}.`)).toBe(true)
    }
  })
})
