import { readFileSync } from 'fs'
import { resolve } from 'path'

import gsap from 'gsap'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SHARE_EMPHASIS_CYCLE_SECONDS, SHARE_EMPHASIS_PEAK_SCALE } from './shareEmphasis'
import { AMENITY_CAP_CUE_GLOW_CLASS, startAmenityCapCueBreath } from './amenityCapCue'

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf-8')

function mountTarget(): HTMLElement {
  const el = document.createElement('span')
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('amenityCapCue — the halo is CSS, and it re-points shareEmphasis at --primary', () => {
  it(`declares .${AMENITY_CAP_CUE_GLOW_CLASS} as a plain class rule so it is emitted without a scan`, () => {
    // #1894/#2027: a Tailwind @utility that never appears as a scanned
    // candidate generates NOTHING and the element silently keeps its old
    // styling — the same guard shareEmphasis.test.ts runs for its own halo.
    expect(css).toMatch(new RegExp(`\\.${AMENITY_CAP_CUE_GLOW_CLASS}\\s*{`))
  })

  it('re-points the share-emphasis-glow formula at --primary, never --share-yes', () => {
    const rule =
      css.match(new RegExp(`\\.${AMENITY_CAP_CUE_GLOW_CLASS}\\s*{([\\s\\S]*?)\\n {2}}`))?.[1] ?? ''
    expect(rule).toContain('box-shadow')
    expect(rule).not.toContain('var(--share-yes)')
    /*
     * ⚠️ THIS ASSERTION USED TO BE `toContain('var(--primary)')`, AND THAT WAS A
     * FALSE GREEN. It pinned the token's NAME while the declaration was invalid:
     * `--primary` is a shadcn HSL COMPONENT TRIPLET (`160 100% 21%`), not a
     * <color>, so `color-mix(in srgb, var(--primary) ...)` does not parse and the
     * browser dropped the entire box-shadow. Measured in Chrome: the class was
     * applied, GSAP was scaling the icon, nothing was clipped -- and computed
     * `box-shadow` was `none`. The cue shipped invisible and the suite stayed green.
     *
     * So assert the WRAPPED form. A bare `var(--primary)` inside color-mix now
     * fails here, which is the regression that actually matters.
     */
    expect(rule).toContain('hsl(var(--primary))')
    expect(rule).not.toMatch(/color-mix\([^)]*[^l(]var\(--primary\)/)
  })

  it('reuses --share-emphasis-amp rather than minting a new intensity token', () => {
    const rule =
      css.match(new RegExp(`\\.${AMENITY_CAP_CUE_GLOW_CLASS}\\s*{([\\s\\S]*?)\\n {2}}`))?.[1] ?? ''
    expect(rule).toContain('var(--share-emphasis-amp)')
  })
})

describe('amenityCapCue — the hover breathe', () => {
  it('borrows SHARE_EMPHASIS_PEAK_SCALE and half the 1.4s cycle, on power1.inOut', () => {
    const el = mountTarget()
    const spy = vi.spyOn(gsap, 'timeline')
    const breath = startAmenityCapCueBreath(el)
    const timeline = spy.mock.results[0]?.value as gsap.core.Timeline
    expect(timeline).toBeDefined()

    timeline.time(SHARE_EMPHASIS_CYCLE_SECONDS / 2)
    expect(Number(gsap.getProperty(el, 'scaleX'))).toBeCloseTo(SHARE_EMPHASIS_PEAK_SCALE, 3)

    breath.kill()
  })

  it('breathes forever while running — a real hover has no fixed number of cycles', () => {
    const el = mountTarget()
    const spy = vi.spyOn(gsap, 'timeline')
    const breath = startAmenityCapCueBreath(el)
    const timeline = spy.mock.results[0]?.value as gsap.core.Timeline
    // A finite breath would report a finite totalDuration; -1 is GSAP's own
    // "infinite repeat" reading.
    expect(timeline.repeat()).toBe(-1)
    breath.kill()
  })

  it('adds the glow class on start', () => {
    const el = mountTarget()
    expect(el.classList.contains(AMENITY_CAP_CUE_GLOW_CLASS)).toBe(false)
    const breath = startAmenityCapCueBreath(el)
    expect(el.classList.contains(AMENITY_CAP_CUE_GLOW_CLASS)).toBe(true)
    breath.kill()
  })

  it('kill() removes the glow, clears the transform and reports itself dead — no resting halo', () => {
    // Unlike shareEmphasis's mount burst, this cue has NO permanent resting
    // state (ruled out: "Mount-fired halo pulse ... ruled OUT"). kill() must
    // leave nothing behind.
    const el = mountTarget()
    const spy = vi.spyOn(gsap, 'timeline')
    const breath = startAmenityCapCueBreath(el)
    const timeline = spy.mock.results[0]?.value as gsap.core.Timeline
    timeline.time(SHARE_EMPHASIS_CYCLE_SECONDS / 2)
    expect(el.style.transform).not.toBe('')

    breath.kill()
    expect(breath.active).toBe(false)
    expect(el.style.transform).toBe('')
    expect(el.classList.contains(AMENITY_CAP_CUE_GLOW_CLASS)).toBe(false)
  })

  it('kill() is idempotent, so a mouseleave racing an unmount cannot double-kill', () => {
    const el = mountTarget()
    const breath = startAmenityCapCueBreath(el)
    breath.kill()
    expect(() => {
      breath.kill()
    }).not.toThrow()
    expect(breath.active).toBe(false)
  })

  it('kills any tween already running on the element before starting a new one', () => {
    // A re-hover before a prior breath was ever explicitly killed must not
    // stack two competing timelines on the same wrapper.
    const el = mountTarget()
    const first = startAmenityCapCueBreath(el)
    const killSpy = vi.spyOn(gsap, 'killTweensOf')
    startAmenityCapCueBreath(el)
    expect(killSpy).toHaveBeenCalledWith(el)
    // The stale reference is inert — starting fresh only guarantees the
    // ELEMENT stops the old tween; it does not retroactively kill `first`'s
    // own object.
    first.kill()
  })
})
