/**
 * Merge/split morph EXECUTION — the imperative half of `boardMorph.ts`.
 *
 * Choreography (ruled by eye against three prototyped engines, spec D26):
 * GSAP + Flip. On a merge, the container card MORPHS out of the card staff
 * acted on (`Flip`'s id-swap path: the new element inherits the anchor's
 * captured rect), the other rooms fly into it as overlay clones
 * (`Flip.fit`, pixel-exact), and every surviving card FLIP-slides to its
 * new grid slot. On a split, rooms fly OUT of the container's old rect
 * while its ghost dissolves. Verified constraints this code inherits from
 * the prototype work, all empirically established:
 *
 *  - Flip NEVER animates React-unmounted elements: `onLeave` receives them
 *    detached and paints nothing (no re-insertion in Flip's source). The
 *    vanished cards therefore live on as clones in a fixed overlay.
 *  - `absolute: true` is NOT used for the sibling slide — pulling grid
 *    children out of flow collapses the CSS grid mid-measure. Transform
 *    FLIP only; absolute positioning exists only inside the overlay.
 *  - `.card-lodge` transitions `opacity` (index.css) — `transition: none`
 *    is pinned on any real element gsap tweens, restored on cleanup.
 *  - Interruption policy: FAST-FORWARD. A new morph (or a capture landing
 *    mid-flight) jumps the live timeline to its end, runs its cleanup, and
 *    only then measures — rects are never captured mid-animation.
 *
 * capture() runs in `getSnapshotBeforeUpdate` — after render, before the
 * DOM mutates, so the vanishing cards are still measurable and a scroll
 * during the write round-trip can never stale the rects. play() runs in
 * `componentDidUpdate` — after mutation, before paint, so the container is
 * positioned (or hidden) before the user sees a frame.
 *
 * jsdom: capture() declines (returns null) when the first card measures
 * 0 wide — no layout, nothing to animate — which is what keeps the ~30
 * existing board tests that rerender changed payloads inert here.
 */
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'

import { type BoardMorphOp, nearestRectIndex } from './boardMorph'

gsap.registerPlugin(Flip)

/**
 * Tuning values, mutable so the dev-only tuner can drive them live.
 * Defaults are the prototype settings the engine was ruled on.
 */
export const boardMorphConfig = {
  /** Seconds. Owner-tuned on the live board (D26 gate session). */
  duration: 0.8,
  /** GSAP ease name for the convergence flights. */
  ease: 'back.out(1.4)',
  /** Seconds between successive clone departures. Owner-tuned: 0.05. */
  stagger: 0.05,
  /**
   * Crossfade the outgoing name into the incoming one on the surviving
   * card — the anchor card's title would otherwise hard-cut the instant
   * the container mounts, while its rect is still mid-morph.
   */
  nameEffect: true,
}

export interface BoardMorphSnapshot {
  op: BoardMorphOp
  state: Flip.FlipState
  /** Overlay clones of the cards this commit unmounts. */
  clones: HTMLElement[]
  /** Split only: the container's pre-commit rect, for the fly-out origin. */
  containerRect: DOMRect | null
  /**
   * The title leaving the board — the anchor room's on a merge, the
   * container's on a split — crossfaded into the surviving card's title.
   */
  outgoingName: string | null
}

export interface BoardMorphRunner {
  capture: (op: BoardMorphOp) => BoardMorphSnapshot | null
  play: (snapshot: BoardMorphSnapshot) => void
}

const OVERLAY_ID = 'board-morph-overlay'

const cardByCode = (code: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-unit-code="${code}"]`)

const allCards = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-unit-code]'))

/**
 * Fixed, pointer-transparent host for the flying clones. z-40: above the
 * board's cards, below `ui/Modal`'s z-[100] overlays — a morph must never
 * paint over an open dialog.
 */
function overlay(): HTMLElement {
  let el = document.getElementById(OVERLAY_ID)
  if (el === null) {
    el = document.createElement('div')
    el.id = OVERLAY_ID
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:40;'
    document.body.appendChild(el)
  }
  return el
}

/**
 * Clone a live card into the overlay at its current viewport rect. Ids are
 * stripped so duplicated `data-testid`/`id` handles can never satisfy a
 * query; the clone is pixels, not a control.
 */
function cloneCard(el: HTMLElement): HTMLElement {
  const rect = el.getBoundingClientRect()
  const clone = el.cloneNode(true) as HTMLElement
  clone.removeAttribute('data-unit-code')
  clone.removeAttribute('data-flip-id')
  clone.removeAttribute('id')
  for (const inner of Array.from(clone.querySelectorAll('[id], [data-testid], [data-unit-code]'))) {
    inner.removeAttribute('id')
    inner.removeAttribute('data-testid')
    inner.removeAttribute('data-unit-code')
  }
  clone.style.position = 'absolute'
  clone.style.left = `${String(rect.left)}px`
  clone.style.top = `${String(rect.top)}px`
  clone.style.width = `${String(rect.width)}px`
  clone.style.height = `${String(rect.height)}px`
  clone.style.margin = '0'
  clone.style.transition = 'none'
  overlay().appendChild(clone)
  return clone
}

const titleOf = (card: HTMLElement): HTMLElement | null => card.querySelector('h3')

/**
 * Crossfade `outgoingName` into `card`'s own title: a lookalike span sits
 * over the real h3 (inside the card, so it rides the Flip transform) and
 * dissolves out as the real title dissolves in. Returns the pieces the
 * timeline animates plus the undo, or null when the card has no title.
 */
function mountNameCrossfade(
  card: HTMLElement,
  outgoingName: string
): { title: HTMLElement; ghost: HTMLElement; undo: () => void } | null {
  const title = titleOf(card)
  if (title === null) return null
  const cardRect = card.getBoundingClientRect()
  const titleRect = title.getBoundingClientRect()
  // An <h3>, not a <span> — the title's display face comes from index.css's
  // `h1, h2, h3` ELEMENT rule (Fraunces, tracking, ss01/ss02), which the
  // copied classes do not carry. A span ghost renders the outgoing name in
  // the body sans for the whole crossfade (owner-reported).
  const ghost = document.createElement('h3')
  ghost.textContent = outgoingName
  // The real title's classes minus `truncate`, and NO fixed width: the ghost
  // was sized to the INCOMING title's box, so an outgoing name wider than the
  // incoming one ("Cedar Upstairs" over "Cedar") ellipsized mid-crossfade
  // (owner-reported). It lays out at its own width instead, capped at the
  // card's edge — clipped without an ellipsis in the rare overflow.
  ghost.className = title.className
    .split(' ')
    .filter((cls) => cls !== 'truncate')
    .join(' ')
  const left = titleRect.left - cardRect.left
  ghost.style.cssText = `position:absolute;left:${String(left)}px;top:${String(
    titleRect.top - cardRect.top
  )}px;max-width:${String(cardRect.width - left - 8)}px;margin:0;white-space:nowrap;overflow:hidden;pointer-events:none;`
  // `.card-lodge` is position:relative, so the ghost rides the transform.
  card.appendChild(ghost)
  return {
    title,
    ghost,
    undo: () => {
      ghost.remove()
      gsap.set(title, { clearProps: 'opacity,filter' })
    },
  }
}

/** The shared crossfade tween pair, positioned inside the morph. */
function addNameCrossfade(
  tl: gsap.core.Timeline,
  parts: { title: HTMLElement; ghost: HTMLElement },
  duration: number
): void {
  const at = duration * 0.25
  const dur = duration * 0.55
  gsap.set(parts.title, { opacity: 0, filter: 'blur(5px)' })
  tl.to(parts.ghost, { opacity: 0, filter: 'blur(5px)', duration: dur, ease: 'power2.in' }, at)
  tl.to(parts.title, { opacity: 1, filter: 'blur(0px)', duration: dur, ease: 'power2.out' }, at)
}

let active: { tl: gsap.core.Timeline; cleanup: () => void } | null = null

/** Jump the in-flight morph to its end state and clean it up. */
function finishActive(): void {
  if (active === null) return
  const finished = active
  // Null FIRST so nothing re-enters through `active`; suppressEvents=true
  // so progress(1) does NOT fire onComplete — cleanup runs exactly once,
  // here (review finding: without it, both onComplete and this line ran
  // cleanup — idempotent today, a trap for any non-idempotent addition).
  active = null
  finished.tl.progress(1, true).kill()
  finished.cleanup()
}

/** Place `el` over `rect` with transforms (its own rect is elsewhere). */
function fitToRect(el: HTMLElement, rect: DOMRect): void {
  const own = el.getBoundingClientRect()
  gsap.set(el, {
    x: rect.left + rect.width / 2 - (own.left + own.width / 2),
    y: rect.top + rect.height / 2 - (own.top + own.height / 2),
    scaleX: rect.width / own.width,
    scaleY: rect.height / own.height,
    transformOrigin: '50% 50%',
  })
}

function capture(op: BoardMorphOp): BoardMorphSnapshot | null {
  finishActive()
  const vanishing = op.type === 'merge' ? op.leaverCodes : [op.containerCode]
  const els = vanishing.map(cardByCode)
  if (els.some((el) => el === null)) return null // collapsed area — cards not in the DOM
  const first = els[0] as HTMLElement
  if (first.getBoundingClientRect().width === 0) return null // jsdom, or a hidden board
  // Flip identifies elements across the commit by data-flip-id; stamp every
  // card with its own code so the state carries the whole grid.
  for (const card of allCards()) {
    card.dataset['flipId'] = card.dataset['unitCode'] ?? ''
  }
  const state = Flip.getState(allCards())
  const containerRect = op.type === 'split' ? first.getBoundingClientRect() : null
  // Merge: the anchor room's title crossfades into the container's. Split:
  // the container's title crossfades into whichever room lands nearest its
  // old slot. Read now — this element unmounts in the coming commit.
  const outgoingEl = op.type === 'merge' ? cardByCode(op.anchorCode) : first
  const outgoingName = outgoingEl === null ? null : (titleOf(outgoingEl)?.textContent ?? null)
  // Merge: the anchor card BECOMES the container (id swap in play) — clone
  // only the other leavers. Split: the container dissolves as a ghost.
  const cloneSources =
    op.type === 'merge' ? op.leaverCodes.filter((c) => c !== op.anchorCode) : vanishing
  const clones: HTMLElement[] = []
  for (const code of cloneSources) {
    const el = cardByCode(code)
    if (el !== null) clones.push(cloneCard(el))
  }
  return { op, state, clones, containerRect, outgoingName }
}

function play(snapshot: BoardMorphSnapshot): void {
  const { op, state, clones } = snapshot
  const { duration: D, ease, stagger } = boardMorphConfig
  if (op.type === 'merge') {
    const containerEl = cardByCode(op.containerCode)
    if (containerEl === null) {
      for (const clone of clones) clone.remove()
      return
    }
    // The id swap: the container inherits the anchor's captured identity, so
    // Flip.from animates it FROM the clicked card's rect — the building
    // visibly forms out of the card staff acted on.
    containerEl.dataset['flipId'] = op.anchorCode
    containerEl.style.transition = 'none'
    const nameParts =
      boardMorphConfig.nameEffect && snapshot.outgoingName !== null
        ? mountNameCrossfade(containerEl, snapshot.outgoingName)
        : null
    const cleanup = (): void => {
      for (const clone of clones) clone.remove()
      containerEl.dataset['flipId'] = op.containerCode
      containerEl.style.transition = ''
      gsap.set(containerEl, { clearProps: 'transform,opacity' })
      nameParts?.undo()
    }
    const tl = gsap.timeline({
      onComplete: () => {
        cleanup()
        if (active?.tl === tl) active = null
      },
    })
    tl.add(Flip.from(state, { targets: allCards(), duration: D, ease: 'power3.inOut' }), 0)
    if (nameParts !== null) addNameCrossfade(tl, nameParts, D)
    clones.forEach((clone, i) => {
      const at = 0.04 + i * stagger
      gsap.set(clone, { opacity: 0.9 })
      tl.add(
        Flip.fit(clone, containerEl, { duration: D * 0.85, ease, scale: true }) as gsap.core.Tween,
        at
      )
      tl.to(clone, { opacity: 0, duration: D * 0.35, ease: 'power1.in' }, at + D * 0.5)
    })
    active = { tl, cleanup }
    return
  }
  // Split: rooms fly OUT of the container's old rect; its ghost dissolves.
  const containerRect = snapshot.containerRect
  const enters = op.enterCodes.map(cardByCode).filter((el): el is HTMLElement => el !== null)
  const enterSet = new Set<HTMLElement>(enters)
  const survivors = allCards().filter((el) => !enterSet.has(el))
  // The room landing nearest the container's old slot reads as "the same
  // card, renamed" — it inherits the reverse name crossfade.
  const heirIndex =
    containerRect === null
      ? -1
      : nearestRectIndex(
          containerRect,
          enters.map((el) => el.getBoundingClientRect())
        )
  const heir = heirIndex === -1 ? undefined : enters[heirIndex]
  const nameParts =
    boardMorphConfig.nameEffect && snapshot.outgoingName !== null && heir !== undefined
      ? mountNameCrossfade(heir, snapshot.outgoingName)
      : null
  const cleanup = (): void => {
    for (const clone of clones) clone.remove()
    for (const el of enters) {
      el.style.transition = ''
    }
    gsap.set(enters, { clearProps: 'transform,opacity' })
    nameParts?.undo()
  }
  const tl = gsap.timeline({
    onComplete: () => {
      cleanup()
      if (active?.tl === tl) active = null
    },
  })
  tl.add(Flip.from(state, { targets: survivors, duration: D, ease: 'power3.inOut' }), 0)
  if (nameParts !== null) addNameCrossfade(tl, nameParts, D)
  enters.forEach((el, i) => {
    el.style.transition = 'none'
    if (containerRect !== null) fitToRect(el, containerRect)
    gsap.set(el, { opacity: 0 })
    tl.to(
      el,
      { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1, duration: D * 0.9, ease },
      0.04 + i * stagger
    )
  })
  const ghost = clones[0]
  if (ghost !== undefined) {
    tl.to(
      ghost,
      { opacity: 0, scale: 0.88, transformOrigin: '50% 50%', duration: D * 0.5, ease: 'power2.in' },
      0.02
    )
  }
  active = { tl, cleanup }
}

export const defaultBoardMorphRunner: BoardMorphRunner = { capture, play }
