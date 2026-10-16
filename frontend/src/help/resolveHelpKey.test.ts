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
  it('falls back to people for an unknown route under any people-area prefix', () => {
    expect(resolveHelpKey('/campers/not-a-page', '')).toBe('people')
    expect(resolveHelpKey('/users/not-a-page', '')).toBe('people')
    expect(resolveHelpKey('/camper/1000001/not-a-page', '')).toBe('people')
  })
  it('resolves a weekend session ref to the session entry, not the area', () => {
    expect(resolveHelpKey('/weekend/1000001', '')).toBe('weekend.session')
  })
  it('keeps the literal weekend sessions route above the param route', () => {
    expect(resolveHelpKey('/weekend/sessions', '')).toBe('weekend.sessions')
  })
  it('maps Analytics › Today to its own key (#3207 PR 8)', () => {
    expect(resolveHelpKey('/analytics/today', '')).toBe('analytics.today')
  })
  it('maps the camper detail screen to its key', () => {
    expect(resolveHelpKey('/camper/1000001', '')).toBe('people.camper')
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
    // the area fallback returns the area name as a key, so each must exist
    for (const a of HELP_AREAS) expect(keys).toContain(a)
  })
})
