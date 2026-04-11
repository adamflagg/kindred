/**
 * Tests for raw data date display logic
 *
 * Rules:
 * - If `processed` is empty/null, show "Not yet processed"
 * - If both dates are the same day, show a single "Synced & Processed: date"
 * - If different, show both with clear labels
 */
import { describe, it, expect } from 'vitest'
import { formatSyncDates } from './rawDataDates'

describe('formatSyncDates', () => {
  describe('when processed is missing', () => {
    it('returns synced date and "Not yet processed" when processed is undefined', () => {
      const result = formatSyncDates('2026-04-07T10:00:00Z', undefined, true)
      expect(result).toEqual({
        mode: 'unprocessed',
        syncedDisplay: '4/7/2026',
        processedDisplay: null,
      })
    })

    it('returns synced date and "Not yet processed" when processed is empty string', () => {
      const result = formatSyncDates('2026-04-07T10:00:00Z', '', true)
      expect(result).toEqual({
        mode: 'unprocessed',
        syncedDisplay: '4/7/2026',
        processedDisplay: null,
      })
    })

    it('returns null for all when value has no content and processed is empty', () => {
      const result = formatSyncDates('2026-04-07T10:00:00Z', undefined, false)
      expect(result).toEqual({
        mode: 'synced-only',
        syncedDisplay: '4/7/2026',
        processedDisplay: null,
      })
    })
  })

  describe('when both dates are the same day', () => {
    it('returns combined display when synced and processed are same day', () => {
      const result = formatSyncDates('2026-04-07T10:00:00Z', '2026-04-07T14:30:00Z', true)
      expect(result).toEqual({
        mode: 'same-day',
        syncedDisplay: '4/7/2026',
        processedDisplay: '4/7/2026',
      })
    })

    it('recognizes same day even with different times', () => {
      // Use times that stay on the same local day regardless of timezone
      const result = formatSyncDates('2026-04-07T15:00:00Z', '2026-04-07T18:30:00Z', true)
      expect(result.mode).toBe('same-day')
    })
  })

  describe('when dates differ', () => {
    it('returns both dates with separate labels', () => {
      const result = formatSyncDates('2026-04-05T10:00:00Z', '2026-04-07T14:30:00Z', true)
      expect(result).toEqual({
        mode: 'different-days',
        syncedDisplay: '4/5/2026',
        processedDisplay: '4/7/2026',
      })
    })
  })

  describe('when synced date is also missing', () => {
    it('returns null displays when both are undefined', () => {
      const result = formatSyncDates(undefined, undefined, false)
      expect(result).toEqual({
        mode: 'none',
        syncedDisplay: null,
        processedDisplay: null,
      })
    })
  })
})
