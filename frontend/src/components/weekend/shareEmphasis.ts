/**
 * The share-mark EMPHASIS treatment — spec 2026-08-24 (`docs/plans/`, LOCAL
 * ONLY; the picks were made in the Share Emphasis Lab artifact). Parent
 * contract: the 2026-08-22 share-icons spec, which locks the vocabulary this
 * module must not touch.
 *
 * ## What it emphasizes, and what it never does
 *
 * Exactly the owner's "open to sharing" set — the same three marks the
 * unplaced-popout filter predicate keys on:
 *
 *   - the anchor when the radio says **yes** (61 households in 2026)
 *   - a cluster carrying **WITH-named** (55) or **similar-age** (8)
 *
 * NEAR is proximity, not sharing, and is never the REASON a card is
 * emphasized (158 households; 147 of them NEAR-only, which draw nothing at
 * all). `maybe`/`no`/`unanswered` anchors, the need glyphs and the Baby mark
 * are untouched.
 *
 * **Fills never change in any mode.** Emphasis is a halo plus motion layer
 * and nothing else — a treatment that recoloured NEAR would contradict the
 * parent spec's green-means-share ruling. That is why this module owns no
 * class names beyond the one glow utility, and why `shareMarks.ts` is
 * imported for its TYPES only.
 *
 * ## Two vehicles, deliberately not collapsed into one
 *
 * The halo rides `share-emphasis-glow` (plain CSS, `index.css`); the breathe
 * rides `data-share-emphasis-motion` (queried here, animated by GSAP). They
 * land on the same element today, and are kept apart in code because a future
 * per-glyph halo — the "two-tone" mode that was built, measured and rejected
 * — would move the halo without moving the transform.
 *
 * **The transform target is always a WRAPPER, never a glyph inside a
 * capsule.** Measured in a real browser 2026-08-24: scaling one glyph of a
 * flush capsule takes it to 21.45px beside its 20px neighbour, so the pill
 * goes lopsided and the seam overlap grows from -1px to -1.72px. Scaling the
 * wrapper takes both halves to 21.45px and scales the seam proportionally.
 *
 * ## Why GSAP rather than a CSS animation
 *
 * Two reasons, both structural. `stagger` over the emphasized marks in
 * document order is exactly this problem; and a timeline can be KILLED
 * cleanly when a drag starts, which a CSS animation cannot be without
 * fighting the class that draws the resting glow.
 *
 * ## Why `prefers-reduced-motion` is gated HERE and not in the stylesheet
 *
 * `index.css.guard.test.ts` pins that the stylesheet carries no
 * `prefers-reduced-motion` block, and that policy is unchanged: the breathe
 * lives in JS, so the gate lives in JS with it. A reduced-motion viewer gets
 * the static glow and nothing else — which is the argument that settled the
 * "4 cycles then settle" ruling in the first place. Some viewers only ever
 * see the resting state, so the glow has to carry the signal alone.
 */
import gsap from 'gsap'

import type { ShareAnchorSpec, ShareClusterMark } from './shareMarks'

/**
 * The one tunable number (locked at 0.4). Everything else about the treatment
 * — blur, spread, alpha, peak scale — is resolved from it, here and in
 * `index.css`'s `--share-emphasis-amp`. `shareEmphasis.test.ts` pins the two
 * declarations to the same value.
 */
export const SHARE_EMPHASIS_AMP = 0.4

/** Four breathes, then a permanent static glow. */
export const SHARE_EMPHASIS_CYCLES = 4

/** Seconds per breathe. 4 x 1.4 = a 5.6s burst before the stagger tail. */
export const SHARE_EMPHASIS_CYCLE_SECONDS = 1.4

/**
 * Seconds between successive marks, indexed over the EMPHASIZED MARKS in
 * document order — a deliberate deviation from the lab, which indexed over
 * all cards and left a 56-card board still animating at ~7.5s. ~13 marks on a
 * median weekend gives a 420ms cascade tail, so the whole burst is ~6.0s.
 *
 * If the cascade ever reads as too tight, RAISE THIS — do not re-index over
 * all cards. A two-second lead-in on a signal that lasts four cycles is
 * mostly dead air.
 */
export const SHARE_EMPHASIS_STAGGER_SECONDS = 0.035

/** Peak of the breathe, resolved from the amp: 1.064 at 0.4. */
export const SHARE_EMPHASIS_PEAK_SCALE = 1 + SHARE_EMPHASIS_AMP * 0.16

/**
 * The HALO vehicle — a plain class rule in `index.css`, never a Tailwind
 * `@utility`. #1894/#2027 both bit this codebase the same way: a utility that
 * never appears as a scanned candidate generates no rule at all and the
 * element silently keeps its old styling. This class only ever reaches the
 * markup through this constant, so it is written as a rule that is always
 * emitted.
 */
export const SHARE_GLOW_CLASS = 'share-emphasis-glow'

/** The TRANSFORM vehicle's query handle. */
export const SHARE_MOTION_ATTR = 'data-share-emphasis-motion'

/** `SHARE_MOTION_ATTR` as a selector, so callers never rebuild the brackets. */
export const SHARE_MOTION_SELECTOR = `[${SHARE_MOTION_ATTR}]`

/** A running burst. Killed, never paused — see `kill`. */
export interface ShareEmphasisBurst {
  /** The vehicles this burst animates, in document order. */
  readonly targets: readonly HTMLElement[]
  /** False once the burst has finished or been killed. */
  readonly active: boolean
  /**
   * Stop immediately and leave every mark at its RESTING GLOW.
   *
   * Not a pause: a burst that resumes halfway through a placement is the
   * thing the drag rule exists to prevent. Idempotent.
   */
  kill: () => void
}

/** Injectable for tests, exactly as `BoardMorphRunner` is. */
export interface ShareEmphasisRunner {
  /** `null` when there is nothing to animate, or nothing that should be. */
  run: () => ShareEmphasisBurst | null
}

/** Emphasized iff the radio says yes (spec §1). */
export function anchorIsEmphasized(anchor: ShareAnchorSpec | null): boolean {
  return anchor?.state === 'yes'
}

/**
 * Emphasized iff the capsule carries a HOT mark. NEAR rides along inside an
 * emphasized capsule but is never the reason for one — the whole capsule gets
 * one halo, so the same NEAR answer never renders two ways depending on its
 * neighbour (the rejected two-tone mode's defect).
 */
export function clusterIsEmphasized(cluster: readonly ShareClusterMark[]): boolean {
  return cluster.some((mark) => mark.key === 'with' || mark.key === 'similar_ages')
}

/** True when the viewer asked for no motion. jsdom honours no media query; tests mock this. */
export function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Every emphasized vehicle currently on the page, in DOCUMENT ORDER — which
 * is what `SHARE_EMPHASIS_STAGGER_SECONDS` indexes over.
 *
 * Document-scoped rather than scoped to the board's own subtree, on purpose.
 * The board's marks are spread across the area grids, `LodgingUnitCard`, the
 * off-board grid and `FloatingUnplacedBadge`, and a subtree root tight enough
 * to exclude the map tab would drop some of those. The only leakage is the
 * map tab when it has been opened before the board (`Activity` keeps an
 * opened tab mounted-but-hidden): its marks sit AFTER the housing panel in
 * document order, so they take the tail of the cascade and animate nothing
 * anybody can see.
 */
export function shareEmphasisTargets(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SHARE_MOTION_SELECTOR))
}

function run(): ShareEmphasisBurst | null {
  if (prefersReducedMotion()) return null
  const targets = shareEmphasisTargets()
  if (targets.length === 0) return null

  let alive = true
  /**
   * Drop the inline transform GSAP wrote, so the mark sits at its resting
   * glow with nothing left over. No `animation-fill-mode` question arises —
   * the keyframe already ends at rest; this only removes the residue.
   */
  const settle = (): void => {
    alive = false
    gsap.set(targets, { clearProps: 'transform,transformOrigin' })
  }

  const half = SHARE_EMPHASIS_CYCLE_SECONDS / 2
  const timeline = gsap.timeline({ onComplete: settle })
  timeline.to(targets, {
    keyframes: [
      { scale: SHARE_EMPHASIS_PEAK_SCALE, duration: half, ease: 'power1.inOut' },
      { scale: 1, duration: half, ease: 'power1.inOut' },
    ],
    repeat: SHARE_EMPHASIS_CYCLES - 1,
    stagger: SHARE_EMPHASIS_STAGGER_SECONDS,
  })

  return {
    targets,
    get active(): boolean {
      return alive
    },
    kill: (): void => {
      if (!alive) return
      timeline.kill()
      settle()
    },
  }
}

export const defaultShareEmphasisRunner: ShareEmphasisRunner = { run }
