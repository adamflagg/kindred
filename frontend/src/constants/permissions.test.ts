import { describe, it, expect } from 'vitest'
import { Permission, ALL_PERMISSIONS } from './permissions'

describe('Permission constants', () => {
  it('defines all expected permissions', () => {
    expect(Permission.BUNKING_MANAGE).toBe('bunking.manage')
    expect(Permission.METRICS_FINANCIAL).toBe('metrics.financial')
    expect(Permission.METRICS_GEO).toBe('metrics.geo')
    expect(Permission.REGISTRATION_MANAGE).toBe('registration.manage')
    expect(Permission.SHEETS_EXPORT).toBe('sheets.export')
    expect(Permission.STAFF_HIRING).toBe('staff.hiring')
    expect(Permission.USERS_MANAGE).toBe('users.manage')
  })

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
