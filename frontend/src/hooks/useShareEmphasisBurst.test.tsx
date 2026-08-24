import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ShareEmphasisBurst, ShareEmphasisRunner } from '../components/weekend/shareEmphasis'
import { useShareEmphasisBurst } from './useShareEmphasisBurst'

/** A burst that records its own death, standing in for the GSAP timeline. */
function fakeBurst(targets: HTMLElement[] = []): ShareEmphasisBurst & { killed: number } {
  const burst = {
    targets,
    active: true,
    killed: 0,
    kill(): void {
      burst.killed += 1
      burst.active = false
    },
  }
  return burst
}

function fakeRunner(
  targets: HTMLElement[] = []
): ShareEmphasisRunner & { bursts: Array<ReturnType<typeof fakeBurst>> } {
  const bursts: Array<ReturnType<typeof fakeBurst>> = []
  return {
    bursts,
    run: vi.fn(() => {
      const burst = fakeBurst(targets)
      bursts.push(burst)
      return burst
    }),
  }
}

/**
 * A stand-in for a share mark sitting on the board. Tracked so it is removed
 * between tests without clearing `document.body`, which would fight RTL's own
 * cleanup for the render containers.
 */
const vehicles: HTMLElement[] = []
function mountVehicle(): HTMLElement {
  const el = document.createElement('span')
  document.body.appendChild(el)
  vehicles.push(el)
  return el
}

afterEach(() => {
  while (vehicles.length > 0) vehicles.pop()?.remove()
})

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

  it('kills it when the marks themselves have left the document', () => {
    // React tears the board's host nodes out during the mutation phase, which
    // runs BEFORE passive cleanups — so a real navigation reaches this cleanup
    // with every target already disconnected. Verified against React 19 in
    // this worktree: `isConnected` is false by the time the cleanup fires.
    const el = mountVehicle()
    const runner = fakeRunner([el])
    const { unmount } = renderHook(() => {
      useShareEmphasisBurst({ ready: true, suppressed: false, runner })
    })
    el.remove()
    unmount()
    expect(runner.bursts[0]?.killed).toBe(1)
    expect(runner.bursts[0]?.active).toBe(false)
  })
})

describe('useShareEmphasisBurst — StrictMode must not eat the burst', () => {
  it('survives the double-invoked mount effect, so the breathe plays in dev', () => {
    // `main.tsx` wraps the app in <StrictMode> and React 19 double-invokes
    // mount effects in development: setup -> cleanup -> setup. `armed` is
    // spent by pass 1, so a cleanup that kills unconditionally kills the only
    // burst there will ever be and pass 2 returns early — the dev server (the
    // environment the design review happens in) shows the static glow and no
    // motion at all. Production builds do not double-invoke, which is exactly
    // why this is invisible until someone looks at the running app.
    //
    // The cleanup tells the two cases apart by the DOM: StrictMode's simulated
    // unmount removes nothing, so the marks are still connected.
    const el = mountVehicle()
    const runner = fakeRunner([el])
    renderHook(
      () => {
        useShareEmphasisBurst({ ready: true, suppressed: false, runner })
      },
      { wrapper: StrictMode }
    )
    expect(runner.run).toHaveBeenCalledTimes(1)
    expect(runner.bursts[0]?.killed).toBe(0)
    expect(runner.bursts[0]?.active).toBe(true)
  })

  it('still kills on drag under StrictMode — suppression is the unconditional kill', () => {
    const el = mountVehicle()
    const runner = fakeRunner([el])
    const { rerender } = renderHook(
      ({ suppressed }: { suppressed: boolean }) => {
        useShareEmphasisBurst({ ready: true, suppressed, runner })
      },
      { initialProps: { suppressed: false }, wrapper: StrictMode }
    )
    expect(runner.bursts[0]?.active).toBe(true)
    rerender({ suppressed: true })
    expect(runner.bursts[0]?.killed).toBeGreaterThanOrEqual(1)
    expect(runner.bursts[0]?.active).toBe(false)
  })
})
