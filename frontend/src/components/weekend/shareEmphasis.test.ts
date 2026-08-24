import { readFileSync } from 'fs'
import { resolve } from 'path'

import gsap from 'gsap'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SHARE_EMPHASIS_AMP,
  SHARE_EMPHASIS_CYCLES,
  SHARE_EMPHASIS_CYCLE_SECONDS,
  SHARE_EMPHASIS_PEAK_SCALE,
  SHARE_EMPHASIS_STAGGER_SECONDS,
  SHARE_GLOW_CLASS,
  SHARE_MOTION_ATTR,
  SHARE_MOTION_SELECTOR,
  anchorIsEmphasized,
  clusterIsEmphasized,
  defaultShareEmphasisRunner,
  prefersReducedMotion,
  shareEmphasisTargets,
} from './shareEmphasis'
import type { ShareAnchorSpec, ShareClusterMark } from './shareMarks'

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf-8')

/** jsdom honours no media query at all — every reduced-motion read is mocked. */
function mockReducedMotion(reduce: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function mountVehicle(): HTMLElement {
  const el = document.createElement('span')
  el.setAttribute(SHARE_MOTION_ATTR, '')
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('shareEmphasis — the locked knobs (spec §2)', () => {
  it('carries the ruled intensity, cycle count, duration and stagger', () => {
    expect(SHARE_EMPHASIS_AMP).toBe(0.4)
    expect(SHARE_EMPHASIS_CYCLES).toBe(4)
    expect(SHARE_EMPHASIS_CYCLE_SECONDS).toBe(1.4)
    expect(SHARE_EMPHASIS_STAGGER_SECONDS).toBe(0.035)
  })

  it('resolves the peak scale from the amp rather than hard-coding 1.064', () => {
    expect(SHARE_EMPHASIS_PEAK_SCALE).toBeCloseTo(1.064, 5)
    expect(SHARE_EMPHASIS_PEAK_SCALE).toBe(1 + SHARE_EMPHASIS_AMP * 0.16)
  })

  it('runs four cycles at 1400ms — a 5600ms burst before the stagger tail', () => {
    expect(SHARE_EMPHASIS_CYCLES * SHARE_EMPHASIS_CYCLE_SECONDS).toBeCloseTo(5.6, 5)
  })
})

describe('shareEmphasis — the halo is CSS, and one number tunes it', () => {
  it('index.css declares --share-emphasis-amp at the value the module animates to', () => {
    const declared = css.match(/--share-emphasis-amp:\s*([\d.]+)\s*;/)?.[1]
    expect(declared).toBeDefined()
    expect(Number(declared)).toBe(SHARE_EMPHASIS_AMP)
  })

  it(`declares .${SHARE_GLOW_CLASS} as a plain class rule so it is emitted without a scan`, () => {
    // #1894/#2027: a Tailwind @utility that never appears as a scanned
    // candidate generates NOTHING and the element silently keeps its old
    // styling. This class is only ever applied through a constant, so it is
    // written as a plain rule that is always emitted.
    expect(css).toMatch(new RegExp(`\\.${SHARE_GLOW_CLASS}\\s*{`))
  })

  it('expresses blur, spread and alpha against the amp, never as resolved pixels', () => {
    const rule = css.match(new RegExp(`\\.${SHARE_GLOW_CLASS}\\s*{([\\s\\S]*?)\\n {2}}`))?.[1] ?? ''
    expect(rule).toContain('box-shadow')
    expect(rule).toContain('var(--share-emphasis-amp)')
    expect(rule).toContain('var(--share-yes)')
    // The resolved 7.2px/0.8px/48% must not be pasted in — the whole point of
    // the calc form is that the intensity stays ONE tunable number.
    expect(rule).not.toContain('7.2px')
  })

  it('defines --share-yes in both themes, because the halo is always the share green', () => {
    expect(css).toMatch(/--share-yes:\s*hsl\(160 100% 24%\)/)
    expect(css).toMatch(/--share-yes:\s*hsl\(160 55% 62%\)/)
  })

  it('adds no prefers-reduced-motion block — the burst is gated in JS instead', () => {
    // `index.css.guard.test.ts` pins the same fact from the other side. The
    // app's zero-reduced-motion CSS policy is unchanged: GSAP owns the
    // breathe, so `matchMedia` is where the gate belongs.
    expect(css).not.toMatch(/prefers-reduced-motion/)
  })
})

describe('shareEmphasis — which marks are hot (spec §1)', () => {
  const anchor = (state: ShareAnchorSpec['state']): ShareAnchorSpec => ({
    state,
    className: '',
    tooltip: '',
    ariaLabel: '',
  })
  const mark = (key: ShareClusterMark['key']): ShareClusterMark =>
    ({ key }) as unknown as ShareClusterMark

  it('emphasizes the yes anchor and nothing else', () => {
    expect(anchorIsEmphasized(anchor('yes'))).toBe(true)
    expect(anchorIsEmphasized(anchor('maybe'))).toBe(false)
    expect(anchorIsEmphasized(anchor('no'))).toBe(false)
    expect(anchorIsEmphasized(anchor('unanswered'))).toBe(false)
    expect(anchorIsEmphasized(null)).toBe(false)
  })

  it('emphasizes a cluster holding WITH-named or similar-age, never NEAR alone', () => {
    expect(clusterIsEmphasized([mark('with')])).toBe(true)
    expect(clusterIsEmphasized([mark('similar_ages')])).toBe(true)
    expect(clusterIsEmphasized([mark('with'), mark('near')])).toBe(true)
    expect(clusterIsEmphasized([mark('near')])).toBe(false)
    expect(clusterIsEmphasized([])).toBe(false)
  })
})

describe('shareEmphasis — the burst', () => {
  it('collects its targets in document order, which is what the stagger indexes', () => {
    const first = mountVehicle()
    const second = mountVehicle()
    expect(shareEmphasisTargets()).toEqual([first, second])
  })

  it('reads prefers-reduced-motion through matchMedia', () => {
    mockReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    mockReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
  })

  it('does not animate under prefers-reduced-motion — the glow stands alone', () => {
    mockReducedMotion(true)
    mountVehicle()
    expect(defaultShareEmphasisRunner.run()).toBeNull()
  })

  it('declines when the board carries no emphasized mark at all', () => {
    mockReducedMotion(false)
    expect(defaultShareEmphasisRunner.run()).toBeNull()
  })

  it('animates every emphasized vehicle and reports itself alive', () => {
    mockReducedMotion(false)
    const el = mountVehicle()
    const burst = defaultShareEmphasisRunner.run()
    expect(burst).not.toBeNull()
    expect(burst?.targets).toEqual([el])
    expect(burst?.active).toBe(true)
  })

  it('kill() leaves the mark at its resting glow — no inline transform, nothing running', () => {
    mockReducedMotion(false)
    const el = mountVehicle()
    el.classList.add(SHARE_GLOW_CLASS)
    const burst = defaultShareEmphasisRunner.run()
    burst?.kill()
    expect(burst?.active).toBe(false)
    expect(el.style.transform).toBe('')
    // The glow is markup, not motion — killing the burst must not remove it.
    expect(el.classList.contains(SHARE_GLOW_CLASS)).toBe(true)
  })

  it('kill() is idempotent, so an unmount after a drag cannot double-kill', () => {
    mockReducedMotion(false)
    mountVehicle()
    const burst = defaultShareEmphasisRunner.run()
    burst?.kill()
    expect(() => {
      burst?.kill()
    }).not.toThrow()
    expect(burst?.active).toBe(false)
  })

  it('selects vehicles by the attribute the markup stamps', () => {
    expect(SHARE_MOTION_SELECTOR).toBe(`[${SHARE_MOTION_ATTR}]`)
  })
})

describe('shareEmphasis — the burst is FOUR CONTINUOUS CYCLES, not four staggered sets', () => {
  /** The median weekend's emphasized-mark count (spec §6). */
  const MEDIAN_MARKS = 13

  function runOnMedianBoard(): {
    /** Head and tail of the cascade — the only two the assertions need. */
    first: HTMLElement
    last: HTMLElement
    timeline: gsap.core.Timeline
    kill: () => void
  } {
    mockReducedMotion(false)
    const first = mountVehicle()
    for (let i = 0; i < MEDIAN_MARKS - 2; i += 1) mountVehicle()
    const last = mountVehicle()
    const spy = vi.spyOn(gsap, 'timeline')
    const burst = defaultShareEmphasisRunner.run()
    expect(burst?.targets).toHaveLength(MEDIAN_MARKS)
    const timeline = spy.mock.results[0]?.value as gsap.core.Timeline
    expect(timeline).toBeDefined()
    return {
      first,
      last,
      timeline,
      kill: () => {
        burst?.kill()
      },
    }
  }

  it('lasts one breathe-run plus the cascade tail — never one tail PER cycle', () => {
    // `repeat` beside `stagger` at the TWEEN level makes GSAP repeat the whole
    // staggered SET as one unit: the set is 1.4s + a 0.42s tail = 1.82s, and
    // four of those is 7.28s — 21% over the locked ~6.0s, and it gets worse as
    // the board gets busier (0.63s of tail on a 19-mark weekend).
    const { timeline, kill } = runOnMedianBoard()
    const expectedSeconds =
      SHARE_EMPHASIS_CYCLES * SHARE_EMPHASIS_CYCLE_SECONDS +
      (MEDIAN_MARKS - 1) * SHARE_EMPHASIS_STAGGER_SECONDS
    expect(expectedSeconds).toBeCloseTo(6.02, 5)
    expect(timeline.totalDuration()).toBeCloseTo(expectedSeconds, 5)
    kill()
  })

  it('breathes without a stall — the first mark is at peak halfway through cycle two', () => {
    // The stall is what the totals above are made of, and it is the part a
    // viewer actually sees: with the repeat at tween level the mark sits dead
    // at scale 1 for 420ms between every cycle, so "breathe" reads as four
    // separate blips rather than one continuous pulse.
    const { first, timeline, kill } = runOnMedianBoard()
    timeline.time(SHARE_EMPHASIS_CYCLE_SECONDS * 1.5)
    expect(Number(gsap.getProperty(first, 'scaleX'))).toBeCloseTo(SHARE_EMPHASIS_PEAK_SCALE, 3)
    kill()
  })

  it('staggers the LAST mark by exactly the cascade, so the tail stays a cascade', () => {
    const { last, timeline, kill } = runOnMedianBoard()
    // The last mark starts its first breathe one full cascade in, so at that
    // moment it is still at rest while the first mark has already moved.
    timeline.time((MEDIAN_MARKS - 1) * SHARE_EMPHASIS_STAGGER_SECONDS)
    expect(Number(gsap.getProperty(last, 'scaleX'))).toBeCloseTo(1, 4)
    // ...and one half-cycle later it is at its own peak.
    timeline.time(
      (MEDIAN_MARKS - 1) * SHARE_EMPHASIS_STAGGER_SECONDS + SHARE_EMPHASIS_CYCLE_SECONDS / 2
    )
    expect(Number(gsap.getProperty(last, 'scaleX'))).toBeCloseTo(SHARE_EMPHASIS_PEAK_SCALE, 3)
    kill()
  })
})
