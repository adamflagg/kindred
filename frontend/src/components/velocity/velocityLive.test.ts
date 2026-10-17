import { describe, it, expect } from 'vitest'
import {
  LIVE_SYNC_MAX_AGE_MS,
  liveLabelLines,
  livePoint,
  sinceStoredLabel,
  syncBehind,
  syncTimeLabel,
  type LiveSync,
} from './velocityLive'
import type { VelocityResponse } from '../../types/velocity'

const HOUR = 3_600_000
// The stored point was counted at 3:40 am; the hourly sync finished at 2:05 pm (local time).
const STORED_AT = new Date(2026, 11, 14, 3, 40).toISOString()
const SYNC_AT = new Date(2026, 11, 14, 14, 5).toISOString()
const NOW = new Date(2026, 11, 14, 14, 40).getTime()

function data(
  over: Partial<VelocityResponse> = {}
): Pick<VelocityResponse, 'live' | 'combined' | 'today_day_offset'> {
  const point = (day_offset: number, enrolled: number) => ({
    date: '',
    day_offset,
    gross_enrolled: enrolled,
    enrolled,
    cancelled: 0,
    daily_new: 0,
    daily_cancelled: 0,
    daily_new_boys: null,
    daily_new_girls: null,
    daily_cancelled_boys: null,
    daily_cancelled_girls: null,
    gross_enrolled_boys: null,
    gross_enrolled_girls: null,
    enrolled_boys: null,
    enrolled_girls: null,
    data_source: 'snapshot' as const,
  })
  return {
    live: { enrolled: 1_038, stored_at: STORED_AT },
    today_day_offset: 41,
    combined: {
      year: 2027,
      session_cm_id: null,
      session_name: null,
      gender: null,
      weekly: [],
      daily: [point(40, 400), point(41, 412)],
    },
    ...over,
  }
}

const fresh: LiveSync = { at: SYNC_AT, failed: false, nightly: false }

describe('livePoint', () => {
  it('continues the stored line to the live count after a fresh sync', () => {
    const p = livePoint(data(), fresh, NOW)
    expect(p).not.toBeNull()
    expect(p?.enrolled).toBe(1_038)
    expect(p?.stored).toBe(412)
    expect(p?.added).toBe(626)
    expect(p?.storedDay).toBe(41)
    expect(p?.at).toBe(SYNC_AT)
  })

  it('sits after the stored point by the time between the two counts', () => {
    const p = livePoint(data(), fresh, NOW)
    // 10 h 25 m after 3:40 am, as a share of a day
    expect(p?.x).toBeCloseTo(41 + (10 * 60 + 25) / (24 * 60), 5)
  })

  it('accepts a PocketBase-style stored time with a space', () => {
    const pb = new Date(STORED_AT).toISOString().replace('T', ' ')
    expect(livePoint(data({ live: { enrolled: 1_038, stored_at: pb } }), fresh, NOW)).not.toBeNull()
  })

  it('is null when the response carries no live count (closed season, cancellations)', () => {
    expect(livePoint(data({ live: null }), fresh, NOW)).toBeNull()
    const older = data()
    delete older.live
    expect(livePoint(older, fresh, NOW)).toBeNull()
  })

  it('is null off the live season (#110)', () => {
    expect(livePoint(data({ today_day_offset: null }), fresh, NOW)).toBeNull()
  })

  it('is hidden when the last sync is more than 2 hours old (#111)', () => {
    const old = new Date(NOW - LIVE_SYNC_MAX_AGE_MS - 60_000).toISOString()
    expect(livePoint(data(), { ...fresh, at: old }, NOW)).toBeNull()
    const justInside = new Date(NOW - LIVE_SYNC_MAX_AGE_MS + 60_000).toISOString()
    expect(livePoint(data(), { ...fresh, at: justInside }, NOW)).not.toBeNull()
  })

  it('is hidden while the nightly runs: the stored count only (#111)', () => {
    expect(livePoint(data(), { ...fresh, nightly: true }, NOW)).toBeNull()
  })

  it('is hidden until a sync finishes after the stored count was taken', () => {
    // After the nightly, before the first hourly: the last sync is the nightly's own, older than the count.
    const before = new Date(new Date(STORED_AT).getTime() - 20 * 60_000).toISOString()
    expect(livePoint(data(), { ...fresh, at: before }, NOW)).toBeNull()
  })

  it('is hidden when no sync is known or the last one failed', () => {
    expect(livePoint(data(), { ...fresh, at: null }, NOW)).toBeNull()
    expect(livePoint(data(), { ...fresh, failed: true }, NOW)).toBeNull()
  })

  it('is hidden when the line has no points', () => {
    const d = data()
    expect(livePoint({ ...d, combined: { ...d.combined, daily: [] } }, fresh, NOW)).toBeNull()
  })

  it('keeps a live point that has not moved: it says the line is current', () => {
    const p = livePoint(data({ live: { enrolled: 412, stored_at: STORED_AT } }), fresh, NOW)
    expect(p?.added).toBe(0)
  })
})

describe('syncBehind', () => {
  it('is true only past 2 hours since the last sync', () => {
    expect(syncBehind(new Date(NOW - 2 * HOUR - 1).toISOString(), NOW)).toBe(true)
    expect(syncBehind(new Date(NOW - 2 * HOUR + 1).toISOString(), NOW)).toBe(false)
    expect(syncBehind(null, NOW)).toBe(false)
  })
})

describe('labels', () => {
  it('names the sync time, never "now" (#106)', () => {
    expect(syncTimeLabel(SYNC_AT)).toBe('as of 2:05 pm sync')
    expect(syncTimeLabel(new Date(2026, 11, 14, 9, 0).toISOString())).toBe('as of 9:00 am sync')
  })

  it('says how far the live count moved since 3 a.m., and nothing at zero (#108)', () => {
    expect(sinceStoredLabel(626)).toBe('+626 since 3 a.m.')
    expect(sinceStoredLabel(1_204)).toBe('+1,204 since 3 a.m.')
    expect(sinceStoredLabel(-3)).toBe('−3 since 3 a.m.')
    expect(sinceStoredLabel(0)).toBeNull()
  })
})

describe('liveLabelLines', () => {
  const point = livePoint(data(), fresh, NOW)!

  it('names the sync and the count, then how far it moved, then last year (Velocity)', () => {
    expect(liveLabelLines(point, { year: 2026, value: 986 })).toEqual([
      { text: 'as of 2:05 pm sync · 1,038', tone: 'strong', weight: 700 },
      { text: '+626 since 3 a.m.', tone: 'good', weight: 600 },
      { text: '2026: 986', tone: 'ink', weight: 400 },
    ])
  })

  it('drops the callout at zero and a prior with no value', () => {
    const still = livePoint(data({ live: { enrolled: 412, stored_at: STORED_AT } }), fresh, NOW)!
    expect(liveLabelLines(still, { year: 2026, value: null }).map((l) => l.text)).toEqual([
      'as of 2:05 pm sync · 412',
    ])
  })

  it('reads a fall in the bad ink', () => {
    const fell = livePoint(data({ live: { enrolled: 409, stored_at: STORED_AT } }), fresh, NOW)!
    expect(liveLabelLines(fell)[1]).toEqual({ text: '−3 since 3 a.m.', tone: 'bad', weight: 600 })
  })
})
