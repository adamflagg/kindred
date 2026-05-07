import { describe, expect, it } from 'vitest'
import { getNiceTicks } from './cssChartUtils'

describe('getNiceTicks — niceResidual branches', () => {
  it('returns [0] for max <= 0', () => {
    expect(getNiceTicks(0)).toEqual([0])
    expect(getNiceTicks(-5)).toEqual([0])
  })

  it('residual <= 1.5 path: max=5 produces interval=1', () => {
    expect(getNiceTicks(5)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('residual <= 3 path: max=10 produces interval=2', () => {
    expect(getNiceTicks(10)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('residual <= 3 path: max=80 produces interval=20', () => {
    expect(getNiceTicks(80)).toEqual([0, 20, 40, 60, 80])
  })

  it('residual <= 3 path: max=100 produces interval=20', () => {
    expect(getNiceTicks(100)).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('residual <= 7 path: max=35 produces interval=5', () => {
    expect(getNiceTicks(35)).toEqual([0, 5, 10, 15, 20, 25, 30, 35])
  })

  it('residual > 7 path: max=400 produces interval=100', () => {
    expect(getNiceTicks(400)).toEqual([0, 100, 200, 300, 400])
  })

  it('overshoot ceiling appends extra tick when data max meaningfully exceeds last tick', () => {
    // max=11 with count=5 → rawInterval=2.2, residual<=3, interval=2; ticks=[0,2,4,6,8,10]
    // 11 vs last=10 overshoot is (11-10)/2 = 0.5 > 0.02 → appends ceil(11/2)*2 = 12
    expect(getNiceTicks(11)).toEqual([0, 2, 4, 6, 8, 10, 12])
  })

  it('overshoot ceiling skipped when data max barely exceeds last tick', () => {
    // max=100.01 with count=5: rawInterval=20.002, residual<=3, interval=20; ticks=[0..100]
    // 100.01 vs last=100 overshoot is (0.01)/20 = 0.0005 < 0.02 → skipped
    expect(getNiceTicks(100.01)).toEqual([0, 20, 40, 60, 80, 100])
  })
})
