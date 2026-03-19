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
})
