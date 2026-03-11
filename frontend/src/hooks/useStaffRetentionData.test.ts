/**
 * TDD Tests for useStaffRetentionData hook.
 *
 * Tests are written FIRST before implementation (TDD).
 * This hook joins bunkStaff data with retention metrics to produce
 * a staff-centric view of cabin retention rates.
 *
 * The pure function buildStaffRetentionData is tested directly
 * for deterministic, synchronous behavior.
 */
import { describe, it, expect } from 'vitest'
import type { RetentionBySessionBunk } from '../types/metrics'
import type { BunkStaffInfo } from './useBunkStaff'

// We test the pure function directly for full coverage
import { buildStaffRetentionData } from './useStaffRetentionData'
import type { StaffRetentionRow, StaffSessionData } from './useStaffRetentionData'

describe('buildStaffRetentionData', () => {
  describe('basic joining', () => {
    it('should return empty when bunkStaff is empty', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>()
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-1',
          base_count: 10,
          returned_count: 6,
          retention_rate: 0.6,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.staffRows).toEqual([])
      expect(result.sessions).toEqual([])
    })

    it('should return empty when retention data is empty', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|B-1', [{ name: 'Emma Johnson', personId: '101' }]],
      ])
      const retention: RetentionBySessionBunk[] = []

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.staffRows).toEqual([])
      expect(result.sessions).toEqual([])
    })

    it('should join a single staff member with their retention data', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|B-1', [{ name: 'Emma Johnson', personId: '101' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-1',
          base_count: 10,
          returned_count: 7,
          retention_rate: 0.7,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.staffRows).toHaveLength(1)
      expect(result.staffRows[0]!.personId).toBe('101')
      expect(result.staffRows[0]!.name).toBe('Emma Johnson')
      expect(result.staffRows[0]!.overallRetention).toBeCloseTo(0.7)
      expect(result.staffRows[0]!.totalBaseCount).toBe(10)
      expect(result.staffRows[0]!.totalReturnedCount).toBe(7)
    })

    it('should produce correct session data per staff member', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|B-1', [{ name: 'Emma Johnson', personId: '101' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-1',
          base_count: 10,
          returned_count: 7,
          retention_rate: 0.7,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      const sessionData = result.staffRows[0]!.sessionData.get('Session 1')
      expect(sessionData).toBeDefined()
      expect(sessionData!.bunkName).toBe('B-1')
      expect(sessionData!.baseCount).toBe(10)
      expect(sessionData!.returnedCount).toBe(7)
      expect(sessionData!.retentionRate).toBeCloseTo(0.7)
    })
  })

  describe('multi-session staff', () => {
    it('should compute weighted average across multiple sessions', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|B-3', [{ name: 'Liam Garcia', personId: '102' }]],
        ['Session 2|B-5', [{ name: 'Liam Garcia', personId: '102' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-3',
          base_count: 10,
          returned_count: 8,
          retention_rate: 0.8,
        },
        {
          session: 'Session 2',
          bunk: 'B-5',
          base_count: 20,
          returned_count: 10,
          retention_rate: 0.5,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.staffRows).toHaveLength(1)
      const row = result.staffRows[0]!
      expect(row.totalBaseCount).toBe(30)
      expect(row.totalReturnedCount).toBe(18)
      // Weighted: (8 + 10) / (10 + 20) = 18/30 = 0.6
      expect(row.overallRetention).toBeCloseTo(0.6)
    })

    it('should track each session separately in sessionData', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|G-2', [{ name: 'Olivia Chen', personId: '103' }]],
        ['Session 3|G-4', [{ name: 'Olivia Chen', personId: '103' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'G-2',
          base_count: 12,
          returned_count: 9,
          retention_rate: 0.75,
        },
        {
          session: 'Session 3',
          bunk: 'G-4',
          base_count: 8,
          returned_count: 2,
          retention_rate: 0.25,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)
      const row = result.staffRows[0]!

      expect(row.sessionData.size).toBe(2)
      expect(row.sessionData.get('Session 1')!.bunkName).toBe('G-2')
      expect(row.sessionData.get('Session 3')!.bunkName).toBe('G-4')
    })
  })

  describe('multiple staff members', () => {
    it('should create separate rows for different staff', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|B-1', [{ name: 'Emma Johnson', personId: '101' }]],
        ['Session 1|G-1', [{ name: 'Olivia Chen', personId: '103' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-1',
          base_count: 10,
          returned_count: 7,
          retention_rate: 0.7,
        },
        {
          session: 'Session 1',
          bunk: 'G-1',
          base_count: 12,
          returned_count: 6,
          retention_rate: 0.5,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.staffRows).toHaveLength(2)
      const personIds = result.staffRows.map((r) => r.personId).sort()
      expect(personIds).toEqual(['101', '103'])
    })

    it('should handle multiple staff on the same bunk', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        [
          'Session 1|B-1',
          [
            { name: 'Emma Johnson', personId: '101' },
            { name: 'Liam Garcia', personId: '102' },
          ],
        ],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-1',
          base_count: 10,
          returned_count: 7,
          retention_rate: 0.7,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      // Both staff share the same bunk retention data
      expect(result.staffRows).toHaveLength(2)
      for (const row of result.staffRows) {
        expect(row.overallRetention).toBeCloseTo(0.7)
        expect(row.totalBaseCount).toBe(10)
      }
    })
  })

  describe('AG session handling', () => {
    it('should match AG bunk staff using normalized parent session name', () => {
      // useBunkStaff now normalizes AG session names to parent session names,
      // so bunkStaff key already uses "Session 1" (not "All-Gender Cabin-Session 1")
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|AG-8', [{ name: 'Noah Williams', personId: '104' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'AG-8',
          base_count: 6,
          returned_count: 4,
          retention_rate: 0.667,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.staffRows).toHaveLength(1)
      expect(result.staffRows[0]!.overallRetention).toBeCloseTo(0.667, 2)
      // Session name in sessionData uses the normalized parent name
      expect(result.staffRows[0]!.sessionData.has('Session 1')).toBe(true)
    })

    it('should show AG staff alongside regular staff in same session', () => {
      // AG staff (AG-8) and regular staff (B-3) both keyed under "Session 1"
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|B-3', [{ name: 'Emma Johnson', personId: '101' }]],
        ['Session 1|AG-8', [{ name: 'Noah Williams', personId: '104' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-3',
          base_count: 10,
          returned_count: 7,
          retention_rate: 0.7,
        },
        {
          session: 'Session 1',
          bunk: 'AG-8',
          base_count: 6,
          returned_count: 4,
          retention_rate: 0.667,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.staffRows).toHaveLength(2)
      const names = result.staffRows.map((r) => r.name).sort()
      expect(names).toEqual(['Emma Johnson', 'Noah Williams'])
    })
  })

  describe('sessions list', () => {
    it('should return unique sorted session names', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 3|B-1', [{ name: 'Emma Johnson', personId: '101' }]],
        ['Session 1|B-2', [{ name: 'Liam Garcia', personId: '102' }]],
        ['Session 2|G-1', [{ name: 'Olivia Chen', personId: '103' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 3',
          bunk: 'B-1',
          base_count: 10,
          returned_count: 6,
          retention_rate: 0.6,
        },
        {
          session: 'Session 1',
          bunk: 'B-2',
          base_count: 10,
          returned_count: 8,
          retention_rate: 0.8,
        },
        {
          session: 'Session 2',
          bunk: 'G-1',
          base_count: 10,
          returned_count: 5,
          retention_rate: 0.5,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.sessions).toEqual(['Session 1', 'Session 2', 'Session 3'])
    })

    it('should include parent session name for AG staff (not raw AG session name)', () => {
      // After AG normalization, AG staff appear under parent session name
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|B-1', [{ name: 'Emma Johnson', personId: '101' }]],
        ['Session 1|AG-8', [{ name: 'Noah Williams', personId: '104' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-1',
          base_count: 10,
          returned_count: 6,
          retention_rate: 0.6,
        },
        {
          session: 'Session 1',
          bunk: 'AG-8',
          base_count: 6,
          returned_count: 4,
          retention_rate: 0.667,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      // Both regular and AG staff appear under "Session 1"
      expect(result.sessions).toEqual(['Session 1'])
      expect(result.sessions).not.toContain('Session 1 AG')
      expect(result.sessions).not.toContain('All-Gender Cabin-Session 1')
    })
  })

  describe('staff status propagation', () => {
    it('should propagate status from BunkStaffInfo to StaffRetentionRow', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        [
          'Session 1|B-1',
          [
            { name: 'Emma Johnson', personId: '101', status: 'active' },
            { name: 'Liam Garcia', personId: '102', status: 'dismissed' },
          ],
        ],
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-1',
          base_count: 10,
          returned_count: 7,
          retention_rate: 0.7,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.staffRows).toHaveLength(2)
      const emma = result.staffRows.find((r) => r.personId === '101')
      const liam = result.staffRows.find((r) => r.personId === '102')
      expect(emma?.status).toBe('active')
      expect(liam?.status).toBe('dismissed')
    })
  })

  describe('staff without matching retention data', () => {
    it('should exclude staff entries that have no matching retention data', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|B-1', [{ name: 'Emma Johnson', personId: '101' }]],
        ['Session 1|B-99', [{ name: 'Liam Garcia', personId: '102' }]], // no retention data for B-99
      ])
      const retention: RetentionBySessionBunk[] = [
        {
          session: 'Session 1',
          bunk: 'B-1',
          base_count: 10,
          returned_count: 6,
          retention_rate: 0.6,
        },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      // Only Emma should appear (has retention data), Liam has no matching data
      const names = result.staffRows.map((r) => r.name)
      expect(names).toContain('Emma Johnson')
      expect(names).not.toContain('Liam Garcia')
    })
  })

  describe('edge cases', () => {
    it('should handle zero base_count without division by zero', () => {
      const bunkStaff = new Map<string, BunkStaffInfo[]>([
        ['Session 1|B-1', [{ name: 'Emma Johnson', personId: '101' }]],
      ])
      const retention: RetentionBySessionBunk[] = [
        { session: 'Session 1', bunk: 'B-1', base_count: 0, returned_count: 0, retention_rate: 0 },
      ]

      const result = buildStaffRetentionData(bunkStaff, retention)

      expect(result.staffRows).toHaveLength(1)
      expect(result.staffRows[0]!.overallRetention).toBe(0)
      expect(Number.isFinite(result.staffRows[0]!.overallRetention)).toBe(true)
    })
  })
})

describe('module exports', () => {
  it('should export buildStaffRetentionData pure function', async () => {
    const module = await import('./useStaffRetentionData')
    expect(typeof module.buildStaffRetentionData).toBe('function')
  })

  it('should export useStaffRetentionData hook', async () => {
    const module = await import('./useStaffRetentionData')
    expect(typeof module.useStaffRetentionData).toBe('function')
  })

  it('should export StaffRetentionRow type with optional status', async () => {
    // Type-level assertion - if this compiles, the type exists
    const activeRow: StaffRetentionRow = {
      personId: '1',
      name: 'Emma Johnson',
      sessionData: new Map<string, StaffSessionData>(),
      overallRetention: 0,
      totalBaseCount: 0,
      totalReturnedCount: 0,
      status: 'active',
    }
    expect(activeRow).toBeDefined()
    expect(activeRow.status).toBe('active')

    const dismissedRow: StaffRetentionRow = {
      personId: '2',
      name: 'Liam Garcia',
      sessionData: new Map<string, StaffSessionData>(),
      overallRetention: 0,
      totalBaseCount: 0,
      totalReturnedCount: 0,
      status: 'dismissed',
    }
    expect(dismissedRow.status).toBe('dismissed')

    // Status is optional - backwards compatible
    const noStatusRow: StaffRetentionRow = {
      personId: '3',
      name: 'Olivia Chen',
      sessionData: new Map<string, StaffSessionData>(),
      overallRetention: 0,
      totalBaseCount: 0,
      totalReturnedCount: 0,
    }
    expect(noStatusRow.status).toBeUndefined()
  })

  it('should export StaffSessionData type', async () => {
    const _typeCheck: StaffSessionData = {
      bunkName: 'B-1',
      baseCount: 10,
      returnedCount: 7,
      retentionRate: 0.7,
    }
    expect(_typeCheck).toBeDefined()
  })
})
