import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ShareEmphasisBurst, ShareEmphasisRunner } from '../components/weekend/shareEmphasis'
import { useShareEmphasisBurst } from './useShareEmphasisBurst'

/** A burst that records its own death, standing in for the GSAP timeline. */
function fakeBurst(): ShareEmphasisBurst & { killed: number } {
  const burst = {
    targets: [] as HTMLElement[],
    active: true,
    killed: 0,
    kill(): void {
      burst.killed += 1
      burst.active = false
    },
  }
  return burst
}

function fakeRunner(): ShareEmphasisRunner & { bursts: Array<ReturnType<typeof fakeBurst>> } {
  const bursts: Array<ReturnType<typeof fakeBurst>> = []
  return {
    bursts,
    run: vi.fn(() => {
      const burst = fakeBurst()
      bursts.push(burst)
      return burst
    }),
  }
}

describe('useShareEmphasisBurst — the trigger fires once per board arrival', () => {
  it('fires when the roster first becomes visible', () => {
    const runner = fakeRunner()
    renderHook(() => {
      useShareEmphasisBurst({ ready: true, suppressed: false, runner })
    })
    expect(runner.run).toHaveBeenCalledTimes(1)
  })

  it('does not fire before the roster has anything to draw', () => {
    const runner = fakeRunner()
    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) => {
        useShareEmphasisBurst({ ready, suppressed: false, runner })
      },
      { initialProps: { ready: false } }
    )
    expect(runner.run).not.toHaveBeenCalled()
    rerender({ ready: true })
    expect(runner.run).toHaveBeenCalledTimes(1)
  })

  it('never re-arms — a refetch, a scenario switch, a tab return all re-render, and none re-burst', () => {
    // A CSS animation keyed to mount re-fires on every remount. A board that
    // re-breathes every time staff confirm a cabin is worse than one that
    // never breathes at all, so the ref is the whole point of this hook.
    const runner = fakeRunner()
    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) => {
        useShareEmphasisBurst({ ready, suppressed: false, runner })
      },
      { initialProps: { ready: true } }
    )
    expect(runner.run).toHaveBeenCalledTimes(1)
    rerender({ ready: true })
    rerender({ ready: false })
    rerender({ ready: true })
    expect(runner.run).toHaveBeenCalledTimes(1)
  })
})

describe('useShareEmphasisBurst — a drag kills it outright', () => {
  it('kills the timeline the moment a drag begins, and does not resume after', () => {
    // Kill, never pause-and-resume: a burst that restarts halfway through a
    // placement is the thing this rule exists to prevent.
    const runner = fakeRunner()
    const { rerender } = renderHook(
      ({ suppressed }: { suppressed: boolean }) => {
        useShareEmphasisBurst({ ready: true, suppressed, runner })
      },
      { initialProps: { suppressed: false } }
    )
    const burst = runner.bursts[0]
    expect(burst?.active).toBe(true)

    rerender({ suppressed: true })
    expect(burst?.killed).toBe(1)
    expect(burst?.active).toBe(false)

    rerender({ suppressed: false })
    expect(runner.run).toHaveBeenCalledTimes(1)
    expect(burst?.active).toBe(false)
  })

  it('does not start a burst that arrives mid-drag', () => {
    const runner = fakeRunner()
    renderHook(() => {
      useShareEmphasisBurst({ ready: true, suppressed: true, runner })
    })
    expect(runner.run).not.toHaveBeenCalled()
  })

  it('kills the timeline on unmount so a navigation cannot leave it running', () => {
    const runner = fakeRunner()
    const { unmount } = renderHook(() => {
      useShareEmphasisBurst({ ready: true, suppressed: false, runner })
    })
    unmount()
    expect(runner.bursts[0]?.killed).toBe(1)
  })
})
