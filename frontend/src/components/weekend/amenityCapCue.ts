/**
 * The amenity-cap trailing-icon hover cue — kindred#2327 follow-up, settled
 * across two measured mockup rounds
 * (`docs/plans/2026-08-31-mockup-sparkle-lab.html`, LOCAL ONLY): "Hover-
 * triggered Trailing Breathe" on the last visible icon when `amenityCap.ts`
 * has dropped at least one mark.
 *
 * ## Why this is not `shareEmphasis.ts`'s burst, reused
 *
 * That module's burst is MOUNT-fired: it plays once when the board arrives
 * and settles to a permanent resting glow. A mount-fired cue on THIS row was
 * measured and ruled OUT — GSAP fires on component mount, not on
 * scroll-into-view, so a card below the fold at mount time burns its one
 * cue unseen and never gets another. Hover has no such blind spot: any card
 * the pointer ever visits gets its chance, and a card nobody hovers didn't
 * need a cue that would have already expired anyway.
 *
 * This module borrows shareEmphasis's VOCABULARY — `SHARE_EMPHASIS_PEAK_SCALE`,
 * half of `SHARE_EMPHASIS_CYCLE_SECONDS`, `power1.inOut`, and the
 * kill()-not-pause discipline — without borrowing its lifecycle. There is no
 * settle-to-resting-glow here at all: `kill()` leaves the icon at true rest,
 * because a permanent halo on a card that merely HAD an overflow was
 * measured as a disco once 11 cards on a board carry one simultaneously
 * (the mockup's "Continuous Restless Glow" verdict).
 *
 * ## kill(), never pause
 *
 * A breath that resumes mid-cycle after a re-hover reads as a stutter, not a
 * restart — the same argument `shareEmphasis.ts`'s own header makes for its
 * drag-interrupt case. Every re-hover here starts clean.
 */
import gsap from 'gsap'

import { SHARE_EMPHASIS_CYCLE_SECONDS, SHARE_EMPHASIS_PEAK_SCALE } from './shareEmphasis'

/**
 * The halo vehicle — `index.css`'s re-point of `.share-emphasis-glow` at
 * `--primary`. Only ever reaches the markup through this constant, matching
 * `SHARE_GLOW_CLASS`'s own reasoning: a class Tailwind never scans as a
 * candidate generates nothing at all (#1894/#2027).
 */
export const AMENITY_CAP_CUE_GLOW_CLASS = 'amenity-cap-cue-glow'

/** A running breath. Killed, never paused — see the module doc. */
export interface AmenityCapCueBreath {
  /** False once `kill()` has run. */
  readonly active: boolean
  /**
   * Stop immediately and leave the icon at TRUE rest — no glow, no residual
   * transform. Not a settle-to-resting-halo (unlike `shareEmphasis`'s
   * burst): this cue has no permanent state at all. Idempotent.
   */
  kill: () => void
}

/**
 * Starts the trailing icon's hover breathe on `el` — a WRAPPER span, never
 * the glyph itself. `shareEmphasis.ts`'s own measured rule: scaling one
 * glyph inside a row of siblings skews it relative to them; scaling a
 * wrapper that shrink-wraps the glyph does not.
 *
 * Repeats (yoyo) for as long as the caller keeps the breath alive — a real
 * hover has no fixed cycle count, unlike the mount burst's ruled "4 cycles
 * then rest". `kill()` is what stops it, driven by the card's own
 * `mouseleave`.
 */
export function startAmenityCapCueBreath(el: HTMLElement): AmenityCapCueBreath {
  // A re-hover before a prior breath on the SAME element was ever explicitly
  // killed (e.g. a caller that forgot to track its own reference) must not
  // stack two competing timelines on one node.
  gsap.killTweensOf(el)
  el.classList.add(AMENITY_CAP_CUE_GLOW_CLASS)

  let alive = true
  const half = SHARE_EMPHASIS_CYCLE_SECONDS / 2
  const timeline = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: 'power1.inOut' } })
  timeline.to(el, { scale: SHARE_EMPHASIS_PEAK_SCALE, duration: half })

  return {
    get active(): boolean {
      return alive
    },
    kill: (): void => {
      if (!alive) return
      alive = false
      timeline.kill()
      el.classList.remove(AMENITY_CAP_CUE_GLOW_CLASS)
      gsap.set(el, { clearProps: 'transform' })
    },
  }
}
