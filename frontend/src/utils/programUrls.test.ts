import { describe, expect, it } from 'vitest'

import {
  isProgramRoute,
  getProgramFromPath,
  getProgramUrl,
  getProgramHomeUrl,
  removeProgramPrefix,
  getSummerUrl,
  getWeekendUrl,
  getSessionUrl,
  getCamperUrl,
  getAllCampersUrl,
  getAdminUrl,
  getUsersUrl,
  getUserUrl,
  getSessionsListUrl,
} from './programUrls'

describe('programUrls', () => {
  describe('getAnalyticsUrl is removed', () => {
    it('should not export getAnalyticsUrl', async () => {
      const mod = await import('./programUrls')
      expect('getAnalyticsUrl' in mod).toBe(false)
    })
  })

  describe('isProgramRoute', () => {
    it('matches /summer/ with trailing slash', () => {
      expect(isProgramRoute('/summer/')).toBe(true)
      expect(isProgramRoute('/summer/sessions')).toBe(true)
    })

    it('matches /summer without trailing slash', () => {
      expect(isProgramRoute('/summer')).toBe(true)
    })

    it('matches /weekend/ with trailing slash', () => {
      expect(isProgramRoute('/weekend/')).toBe(true)
      expect(isProgramRoute('/weekend/housing')).toBe(true)
    })

    it('matches /weekend without trailing slash', () => {
      expect(isProgramRoute('/weekend')).toBe(true)
    })

    it('matches /analytics paths', () => {
      expect(isProgramRoute('/analytics')).toBe(true)
      expect(isProgramRoute('/analytics/dashboard')).toBe(true)
    })

    it('does not match other paths', () => {
      expect(isProgramRoute('/admin')).toBe(false)
      expect(isProgramRoute('/campers')).toBe(false)
      expect(isProgramRoute('/')).toBe(false)
    })
  })

  describe('getProgramFromPath', () => {
    it('extracts summer from /summer/ paths', () => {
      expect(getProgramFromPath('/summer/')).toBe('summer')
      expect(getProgramFromPath('/summer/sessions')).toBe('summer')
    })

    it('extracts summer from /summer without trailing slash', () => {
      expect(getProgramFromPath('/summer')).toBe('summer')
    })

    it('extracts weekend from /weekend/ paths', () => {
      expect(getProgramFromPath('/weekend/')).toBe('weekend')
      expect(getProgramFromPath('/weekend/housing')).toBe('weekend')
    })

    it('extracts weekend from /weekend without trailing slash', () => {
      expect(getProgramFromPath('/weekend')).toBe('weekend')
    })

    it('extracts analytics from /analytics paths', () => {
      expect(getProgramFromPath('/analytics')).toBe('analytics')
      expect(getProgramFromPath('/analytics/dashboard')).toBe('analytics')
    })

    it('returns null for non-program paths', () => {
      expect(getProgramFromPath('/admin')).toBeNull()
      expect(getProgramFromPath('/campers')).toBeNull()
      expect(getProgramFromPath('/')).toBeNull()
    })
  })

  describe('getProgramUrl', () => {
    it('prepends program prefix for program routes', () => {
      expect(getProgramUrl('sessions', 'summer')).toBe('/summer/sessions')
      expect(getProgramUrl('/sessions', 'summer')).toBe('/summer/sessions')
    })

    it('does not prepend for shared routes', () => {
      expect(getProgramUrl('admin', 'summer')).toBe('/admin')
      expect(getProgramUrl('campers', 'summer')).toBe('/campers')
      expect(getProgramUrl('user', 'summer')).toBe('/user')
      expect(getProgramUrl('users', 'summer')).toBe('/users')
      expect(getProgramUrl('camper/123', 'summer')).toBe('/camper/123')
    })

    // /admin was folded into /manage as one top-level nav tab (nav
    // consolidation, #1895/#450). 'admin' stays in sharedRoutes too — the
    // /admin redirects still resolve, and nothing calls this with an admin
    // path — but 'manage' needs the same shared-route treatment now that it
    // hosts the same kind of cross-program tools.
    it('does not prepend for the manage route either', () => {
      expect(getProgramUrl('manage', 'summer')).toBe('/manage')
      expect(getProgramUrl('manage/sync', 'weekend')).toBe('/manage/sync')
    })
  })

  describe('getProgramHomeUrl', () => {
    it('returns correct home URL for each program', () => {
      expect(getProgramHomeUrl('summer')).toBe('/summer/sessions')
      // Weekend now has a sessions lander of its own, so its home is the same
      // shape as summer's rather than a bare program root.
      expect(getProgramHomeUrl('weekend')).toBe('/weekend/sessions')
      expect(getProgramHomeUrl('analytics')).toBe('/analytics')
    })
  })

  describe('removeProgramPrefix', () => {
    it('removes summer prefix', () => {
      expect(removeProgramPrefix('/summer/sessions')).toBe('/sessions')
    })

    it('removes weekend prefix', () => {
      expect(removeProgramPrefix('/weekend/housing')).toBe('/housing')
    })

    it('removes analytics prefix', () => {
      expect(removeProgramPrefix('/analytics/')).toBe('/')
    })

    it('handles bare /analytics', () => {
      expect(removeProgramPrefix('/analytics')).toBe('/')
    })

    it('returns path unchanged for non-program routes', () => {
      expect(removeProgramPrefix('/admin')).toBe('/admin')
    })
  })

  describe('helper URL generators', () => {
    it('getSummerUrl', () => {
      expect(getSummerUrl('sessions')).toBe('/summer/sessions')
      expect(getSummerUrl('/sessions')).toBe('/summer/sessions')
    })

    it('getWeekendUrl', () => {
      expect(getWeekendUrl('housing')).toBe('/weekend/housing')
      expect(getWeekendUrl('/housing')).toBe('/weekend/housing')
    })

    it('getSessionUrl', () => {
      expect(getSessionUrl('1000001')).toBe('/summer/session/1000001')
      expect(getSessionUrl('1000001', 'bunks')).toBe('/summer/session/1000001/bunks')
    })

    it('getCamperUrl', () => {
      expect(getCamperUrl('42')).toBe('/camper/42')
      expect(getCamperUrl(42)).toBe('/camper/42')
    })

    it('getAllCampersUrl', () => {
      expect(getAllCampersUrl()).toBe('/campers')
    })

    it('getAdminUrl', () => {
      expect(getAdminUrl()).toBe('/admin')
    })

    it('getUsersUrl', () => {
      expect(getUsersUrl()).toBe('/users')
    })

    it('getUserUrl', () => {
      expect(getUserUrl()).toBe('/user')
    })

    it('getSessionsListUrl', () => {
      expect(getSessionsListUrl()).toBe('/summer/sessions')
    })
  })
})
