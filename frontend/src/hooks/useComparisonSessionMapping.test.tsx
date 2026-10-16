import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useComparisonRegistrationData } from './useComparisonRegistrationData'
import { useComparisonWaitlistData } from './useComparisonWaitlistData'
import { useComparisonCancellationData } from './useComparisonCancellationData'

const reg = vi.fn()
const wait = vi.fn()
const canc = vi.fn()

vi.mock('./useMetrics', () => ({
  useRegistrationMetrics: (...a: unknown[]) => reg(...a),
  useWaitlistMetrics: (...a: unknown[]) => wait(...a),
  useCancellationMetrics: (...a: unknown[]) => canc(...a),
}))

const mk = (cm_id: number, name: string) => ({
  cm_id,
  name,
  session_type: 'embedded',
  start_date: '2026-06-15',
  end_date: '2026-06-20',
})
const byYear: Record<number, Array<ReturnType<typeof mk>>> = {
  2026: [mk(1000802, 'Taste of Camp 1'), mk(1000803, 'Taste of Camp 2')],
  2025: [mk(1000103, 'Taste of Camp'), mk(1000534, 'Session 2b')],
}
vi.mock('./useMetricsSessions', () => ({
  useMetricsSessions: (year: number) => ({ data: byYear[year] ?? [] }),
}))

// Registration reads its compare year at the same point only when the page opts in (decision 7
// covers Overview, not Geo); by default every compare year is read at its final
const cases = [
  ['registration', useComparisonRegistrationData, reg, {}],
  ['waitlist', useComparisonWaitlistData, wait, {}],
  ['cancellation', useComparisonCancellationData, canc, {}],
] as const

describe.each(cases)('useComparison %s data session mapping', (_n, useHook, spy, extra) => {
  beforeEach(() => spy.mockReset().mockReturnValue({}))

  it('sends the compare year its own mapped id', () => {
    renderHook(() => useHook(2026, 2025, { sessionTypes: 'main', sessionCmId: 1000802 }))
    expect(spy).toHaveBeenCalledWith(2026, expect.objectContaining({ sessionCmId: 1000802 }))
    expect(spy).toHaveBeenCalledWith(2025, expect.objectContaining({ sessionCmId: 1000103 }))
  })

  it('maps a renamed session the other way too', () => {
    renderHook(() => useHook(2026, 2025, { sessionCmId: 1000803 }))
    expect(spy).toHaveBeenCalledWith(2025, expect.objectContaining({ sessionCmId: 1000534 }))
  })

  it('keeps the original id when nothing matches', () => {
    renderHook(() => useHook(2026, 2025, { sessionCmId: 555 }))
    expect(spy).toHaveBeenCalledWith(2025, expect.objectContaining({ sessionCmId: 555 }))
  })

  it('passes options through when no session is picked', () => {
    const opts = { sessionTypes: 'main' }
    renderHook(() => useHook(2026, 2025, opts))
    expect(spy).toHaveBeenCalledWith(2025, { ...opts, ...extra })
  })
})

describe('useComparisonRegistrationData same point (decision 7, PR 7)', () => {
  beforeEach(() => reg.mockReset().mockReturnValue({}))

  it('asks for the compare year at the same point of the primary season when the page opts in', () => {
    renderHook(() =>
      useComparisonRegistrationData(2026, 2025, { sessionTypes: 'main' }, { samePoint: true })
    )
    expect(reg).toHaveBeenCalledWith(2025, expect.objectContaining({ samePointOf: 2026 }))
  })

  it('reads the compare year at its final when the page does not opt in', () => {
    renderHook(() => useComparisonRegistrationData(2026, 2025, { sessionTypes: 'main' }))
    const compareCall = reg.mock.calls.find((c) => c[0] === 2025)
    expect(compareCall?.[1]).not.toHaveProperty('samePointOf')
  })

  it('reads the primary year as it stands', () => {
    renderHook(() =>
      useComparisonRegistrationData(2026, 2025, { sessionTypes: 'main' }, { samePoint: true })
    )
    const primaryCall = reg.mock.calls.find((c) => c[0] === 2026)
    expect(primaryCall?.[1]).not.toHaveProperty('samePointOf')
  })
})
