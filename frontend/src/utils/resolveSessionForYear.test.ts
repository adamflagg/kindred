import { describe, it, expect } from 'vitest'
import { matchSessionInYear } from './resolveSessionForYear'
import { getAliasGroup, resolveSessionAlias } from './sessionAliases'
import type { MetricsSession } from '../hooks/useMetricsSessions'

const s = (cm_id: number, name: string): MetricsSession => ({
  cm_id,
  name,
  session_type: 'embedded',
  start_date: '2026-06-15',
  end_date: '2026-06-20',
})

const y2026 = [s(1000802, 'Taste of Camp 1'), s(1000803, 'Taste of Camp 2'), s(11, 'Session 3')]
const y2025 = [s(1000103, 'Taste of Camp'), s(1000534, 'Session 2b'), s(12, 'Session 3')]

describe('getAliasGroup', () => {
  it('returns canonical first, then alternates', () => {
    expect(getAliasGroup('Taste of Camp')).toEqual(['Taste of Camp 1', 'Taste of Camp'])
    expect(getAliasGroup('Taste of Camp 2')).toEqual(['Taste of Camp 2', 'Session 2b'])
    expect(getAliasGroup('Session 3')).toEqual(['Session 3'])
  })
})

describe('matchSessionInYear', () => {
  it('uses the cm_id when the year has it', () => {
    expect(matchSessionInYear(y2026, 11, 'Whatever')).toBe(11)
  })
  it('maps an old name forward through the alias group', () => {
    expect(matchSessionInYear(y2026, 1000103, 'Taste of Camp')).toBe(1000802)
    expect(matchSessionInYear(y2026, 1000534, 'Session 2b')).toBe(1000803)
  })
  it('maps a canonical name backward', () => {
    expect(matchSessionInYear(y2025, 1000802, 'Taste of Camp 1')).toBe(1000103)
    expect(matchSessionInYear(y2025, 1000803, 'Taste of Camp 2')).toBe(1000534)
  })
  it('falls back to an exact name', () => {
    expect(matchSessionInYear(y2026, 12, 'Session 3')).toBe(11)
  })
  it('returns null with no match or no name', () => {
    expect(matchSessionInYear(y2026, 999, 'Nope')).toBeNull()
    expect(matchSessionInYear(y2026, 999, null)).toBeNull()
  })
})

// Pins (owner, 2026-10-14): 2027 returns to "Taste of Camp", which is 2026's "Taste of Camp 1".
// An alias group is an equivalence class, so the match holds in both directions.
describe('2027 Taste of Camp and 2026 Taste of Camp 1 are the same session', () => {
  it('maps 2027 "Taste of Camp" onto 2026 "Taste of Camp 1"', () => {
    expect(matchSessionInYear([s(900261, 'Taste of Camp 1')], 900271, 'Taste of Camp')).toBe(900261)
  })
  it('maps 2026 "Taste of Camp 1" onto 2027 "Taste of Camp"', () => {
    expect(matchSessionInYear([s(900271, 'Taste of Camp')], 900261, 'Taste of Camp 1')).toBe(900271)
  })
  it('gives both names one alias key', () => {
    expect(resolveSessionAlias('Taste of Camp')).toBe(resolveSessionAlias('Taste of Camp 1'))
  })
})
