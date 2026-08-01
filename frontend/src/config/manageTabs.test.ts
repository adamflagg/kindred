import { describe, it, expect } from 'vitest'
import { MANAGE_TABS, canSeeTab } from './manageTabs'
import { Permission } from '../constants/permissions'

describe('MANAGE_TABS', () => {
  it('has six entries in the order Geo, Registration, Sheets, Lodging, Sync, Config', () => {
    expect(MANAGE_TABS.map((tab) => tab.id)).toEqual([
      'geo',
      'registration',
      'sheets',
      'lodging',
      'sync',
      'config',
    ])
  })

  it.each([
    ['geo', Permission.METRICS_GEO],
    ['registration', Permission.REGISTRATION_MANAGE],
    ['sheets', Permission.SHEETS_EXPORT],
    ['lodging', Permission.BUNKING_MANAGE],
  ])('keeps %s as a permission-gated tab with codename %s', (id, codename) => {
    const tab = MANAGE_TABS.find((t) => t.id === id)
    expect(tab?.access).toEqual({ kind: 'permission', codename })
  })

  it.each(['sync', 'config'])('marks %s as an admin-gated tab', (id) => {
    const tab = MANAGE_TABS.find((t) => t.id === id)
    expect(tab?.access).toEqual({ kind: 'admin' })
  })
})

describe('canSeeTab', () => {
  it('resolves a permission tab against hasPermission', () => {
    const access = { kind: 'permission' as const, codename: Permission.METRICS_GEO }
    expect(
      canSeeTab(access, { hasPermission: (p) => p === Permission.METRICS_GEO, isAdmin: false })
    ).toBe(true)
    expect(canSeeTab(access, { hasPermission: () => false, isAdmin: false })).toBe(false)
  })

  // The single most important assertion in this file: an admin-gated tab must
  // resolve against isAdmin directly, never through hasPermission('admin').
  // hasPermission('admin') only happens to return the right thing today
  // because no real permission codename is 'admin' — the day one is added,
  // a bare-string check would silently open /manage/sync to it.
  it('refuses an admin tab when isAdmin is false, even if hasPermission returns true for everything', () => {
    const access = { kind: 'admin' as const }
    expect(canSeeTab(access, { hasPermission: () => true, isAdmin: false })).toBe(false)
  })

  it('allows an admin tab when isAdmin is true', () => {
    const access = { kind: 'admin' as const }
    expect(canSeeTab(access, { hasPermission: () => false, isAdmin: true })).toBe(true)
  })
})
