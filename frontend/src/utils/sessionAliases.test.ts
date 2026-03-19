/**
 * TDD tests for session alias mapping - written FIRST before implementation.
 *
 * Session aliases bridge renamed sessions across years for YoY comparison.
 * When CampMinder creates new sessions (new cm_ids) that replace old ones,
 * matchKey="id" can't bridge them. The alias map lets merge logic treat
 * renamed sessions as the same row.
 */

import { describe, it, expect } from 'vitest'
import { SESSION_NAME_ALIASES, resolveSessionAlias } from './sessionAliases'

describe('SESSION_NAME_ALIASES', () => {
  it('maps old session names to canonical current-year names', () => {
    expect(SESSION_NAME_ALIASES['Taste of Camp']).toBe('Taste of Camp 1')
    expect(SESSION_NAME_ALIASES['Session 2b']).toBe('Taste of Camp 2')
  })
})

describe('resolveSessionAlias', () => {
  it('returns the alias for a known old name', () => {
    expect(resolveSessionAlias('Taste of Camp')).toBe('Taste of Camp 1')
    expect(resolveSessionAlias('Session 2b')).toBe('Taste of Camp 2')
  })

  it.each([
    ['Session 2', 'Session 2'],
    ['Session 3', 'Session 3'],
    ['Session 4', 'Session 4'],
    ['Taste of Camp 1', 'Taste of Camp 1'],
    ['Taste of Camp 2', 'Taste of Camp 2'],
    ['', ''],
  ])('returns original name for %s', (input, expected) => {
    expect(resolveSessionAlias(input)).toBe(expected)
  })
})
