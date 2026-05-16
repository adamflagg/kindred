import { describe, it, expect } from 'vitest'
import {
  REASON_HINTS,
  FRIENDLY_REASON_LABELS,
  camperActionHints,
  friendlyReasonLabel,
  type ReasonCode,
} from './reasonHints'

describe('camperActionHints', () => {
  it('returns the same string regardless of input code order', () => {
    const codesA: ReasonCode[] = ['grade_compatibility', 'cross_session']
    const codesB: ReasonCode[] = ['cross_session', 'grade_compatibility']
    expect(camperActionHints(codesA)).toBe(camperActionHints(codesB))
  })

  it('deduplicates hints that resolve to the same copy', () => {
    const result = camperActionHints(['grade_compatibility', 'grade_compatibility'])
    expect(result).toBe(REASON_HINTS.grade_compatibility)
  })

  it('joins multiple distinct hints with " / "', () => {
    const result = camperActionHints(['cross_session', 'grade_compatibility'])
    expect(result).toContain(' / ')
    expect(result).toContain(REASON_HINTS.cross_session)
    expect(result).toContain(REASON_HINTS.grade_compatibility)
  })

  it('falls back to "review request" for unknown codes at runtime', () => {
    // Cast: we keep the runtime fallback even though TS forbids unknown codes.
    const result = camperActionHints(['totally_unknown' as ReasonCode])
    expect(result).toBe('review request')
  })
})

describe('REASON_HINTS / FRIENDLY_REASON_LABELS coverage', () => {
  it('FRIENDLY_REASON_LABELS covers every ReasonCode in REASON_HINTS', () => {
    const hintKeys = Object.keys(REASON_HINTS).sort()
    const labelKeys = Object.keys(FRIENDLY_REASON_LABELS).sort()
    expect(labelKeys).toEqual(expect.arrayContaining(hintKeys))
  })
})

describe('friendlyReasonLabel', () => {
  it('returns the friendly label when present', () => {
    expect(friendlyReasonLabel('grade_compatibility')).toBe(
      FRIENDLY_REASON_LABELS.grade_compatibility
    )
  })

  it('falls back to the raw code for unknown values', () => {
    expect(friendlyReasonLabel('totally_unknown')).toBe('totally_unknown')
  })
})
