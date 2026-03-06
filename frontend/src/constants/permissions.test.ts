import { describe, it, expect } from 'vitest'
import { Permission, ALL_PERMISSIONS } from './permissions'

describe('Permission constants', () => {
  it('defines all expected permissions', () => {
    expect(Permission.BUNKING_VIEW).toBe('bunking.view')
    expect(Permission.BUNKING_MANAGE).toBe('bunking.manage')
    expect(Permission.METRICS_VIEW).toBe('metrics.view')
    expect(Permission.METRICS_FINANCIAL).toBe('metrics.financial')
    expect(Permission.METRICS_GEO).toBe('metrics.geo')
    expect(Permission.SYNC_RUN).toBe('sync.run')
    expect(Permission.SOLVER_CONFIGURE).toBe('solver.configure')
    expect(Permission.USERS_MANAGE).toBe('users.manage')
  })

  it('ALL_PERMISSIONS contains all 8 permissions', () => {
    expect(ALL_PERMISSIONS).toHaveLength(8)
    expect(ALL_PERMISSIONS).toContain('bunking.view')
    expect(ALL_PERMISSIONS).toContain('bunking.manage')
    expect(ALL_PERMISSIONS).toContain('metrics.view')
    expect(ALL_PERMISSIONS).toContain('metrics.financial')
    expect(ALL_PERMISSIONS).toContain('metrics.geo')
    expect(ALL_PERMISSIONS).toContain('sync.run')
    expect(ALL_PERMISSIONS).toContain('solver.configure')
    expect(ALL_PERMISSIONS).toContain('users.manage')
  })

  it('has no duplicates', () => {
    const unique = new Set(ALL_PERMISSIONS)
    expect(unique.size).toBe(ALL_PERMISSIONS.length)
  })
})
