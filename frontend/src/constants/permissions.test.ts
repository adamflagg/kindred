import { describe, it, expect } from 'vitest'
import { Permission, ALL_PERMISSIONS } from './permissions'

describe('Permission constants', () => {
  it('ALL_PERMISSIONS matches Permission object values', () => {
    const expected = Object.values(Permission)
    expect(ALL_PERMISSIONS).toHaveLength(expected.length)
    for (const perm of expected) {
      expect(ALL_PERMISSIONS).toContain(perm)
    }
  })

  it('has no duplicates', () => {
    const unique = new Set(ALL_PERMISSIONS)
    expect(unique.size).toBe(ALL_PERMISSIONS.length)
  })

  it('declares the four financial aid permissions with their exact strings', () => {
    expect(Permission.FINANCIAL_AID_VIEW).toBe('financial_aid.view')
    expect(Permission.FINANCIAL_AID_CASEWORK).toBe('financial_aid.casework')
    expect(Permission.FINANCIAL_AID_RULES).toBe('financial_aid.rules')
    expect(Permission.FINANCIAL_AID_SUMMARY).toBe('financial_aid.summary')
  })

  // PocketBase rules match cached_permissions with `~`, a case-insensitive
  // LIKE '%x%'. A name inside another would let the longer one pass the
  // shorter one's rule.
  it('no permission is a case-insensitive substring of another', () => {
    const clashes = ALL_PERMISSIONS.flatMap((short) =>
      ALL_PERMISSIONS.filter(
        (long) => long !== short && long.toLowerCase().includes(short.toLowerCase())
      ).map((long) => `${short} ⊂ ${long}`)
    )
    expect(clashes).toEqual([])
  })
})
