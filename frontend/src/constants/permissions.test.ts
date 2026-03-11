import { describe, it, expect } from 'vitest'
import { Permission, ALL_PERMISSIONS } from './permissions'

describe('Permission constants', () => {
  it('defines all expected permissions', () => {
    expect(Permission.BUNKING_MANAGE).toBe('bunking.manage')
    expect(Permission.METRICS_FINANCIAL).toBe('metrics.financial')
    expect(Permission.METRICS_GEO).toBe('metrics.geo')
    expect(Permission.REGISTRATION_MANAGE).toBe('registration.manage')
    expect(Permission.SHEETS_EXPORT).toBe('sheets.export')
    expect(Permission.USERS_MANAGE).toBe('users.manage')
  })

  it('ALL_PERMISSIONS contains all 6 permissions', () => {
    expect(ALL_PERMISSIONS).toHaveLength(6)
    expect(ALL_PERMISSIONS).toContain('bunking.manage')
    expect(ALL_PERMISSIONS).toContain('metrics.financial')
    expect(ALL_PERMISSIONS).toContain('metrics.geo')
    expect(ALL_PERMISSIONS).toContain('registration.manage')
    expect(ALL_PERMISSIONS).toContain('sheets.export')
    expect(ALL_PERMISSIONS).toContain('users.manage')
  })

  it('has no duplicates', () => {
    const unique = new Set(ALL_PERMISSIONS)
    expect(unique.size).toBe(ALL_PERMISSIONS.length)
  })
})
