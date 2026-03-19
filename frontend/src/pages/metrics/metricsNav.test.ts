/**
 * Tests for metricsNav configuration.
 * Verifies permission gating on sensitive sub-nav items.
 */
import { describe, it, expect } from 'vitest'
import { RETENTION_SUB_NAV } from './metricsNav'
describe('metricsNav', () => {
  describe('RETENTION_SUB_NAV', () => {
    it('gates Staff Analysis tab behind staff.hiring permission', () => {
      const staffItem = RETENTION_SUB_NAV.find((item) => item.id === 'staff')
      expect(staffItem).toBeDefined()
      expect(staffItem!.permission).toBe('staff.hiring')
    })

    it('does not gate other retention tabs', () => {
      const nonStaffItems = RETENTION_SUB_NAV.filter((item) => item.id !== 'staff')
      expect(nonStaffItems.length).toBeGreaterThan(0)
      for (const item of nonStaffItems) {
        expect(item.permission).toBeUndefined()
      }
    })
  })
})
