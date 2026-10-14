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

const cases = [
  ['registration', useComparisonRegistrationData, reg],
  ['waitlist', useComparisonWaitlistData, wait],
  ['cancellation', useComparisonCancellationData, canc],
] as const

describe.each(cases)('useComparison %s data session mapping', (_n, useHook, spy) => {
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
    expect(spy).toHaveBeenCalledWith(2025, opts)
  })
})
