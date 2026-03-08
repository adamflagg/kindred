import { describe, it, expect } from 'vitest'
import { Permission, ALL_PERMISSIONS } from './permissions'

describe('Permission constants', () => {
  it('defines all expected permissions', () => {
    expect(Permission.BUNKING_MANAGE).toBe('bunking.manage')
    expect(Permission.METRICS_FINANCIAL).toBe('metrics.financial')
    expect(Permission.METRICS_GEO).toBe('metrics.geo')
  })

  it('ALL_PERMISSIONS contains all 3 permissions', () => {
    expect(ALL_PERMISSIONS).toHaveLength(3)
    expect(ALL_PERMISSIONS).toContain('bunking.manage')
    expect(ALL_PERMISSIONS).toContain('metrics.financial')
    expect(ALL_PERMISSIONS).toContain('metrics.geo')
  })

  it('has no duplicates', () => {
    const unique = new Set(ALL_PERMISSIONS)
    expect(unique.size).toBe(ALL_PERMISSIONS.length)
  })
})
