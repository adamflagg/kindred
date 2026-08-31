/**
 * The viewport maths, which is where a map stops telling the truth if it is
 * wrong. Pure functions, no DOM.
 */
import { describe, expect, it } from 'vitest'

import {
  basePosition,
  clampView,
  IDENTITY_VIEW,
  K_MAX,
  K_MIN,
  MAP_ASPECT,
  screenPosition,
  screenToNormalized,
  zoomAt,
} from './mapViewport'

// A canvas at EXACTLY the map's aspect — derived from MAP_ASPECT, not a
// rounded literal. The component locks the canvas to this ratio via CSS
// `aspect-ratio`, and the proportions test below asserts to 5 decimal places,
// which a rounded 1294/1000 misses by 23x the tolerance.
const H = 1000
const W = H * MAP_ASPECT

describe('basePosition', () => {
  it('maps the normalized centre to the canvas centre', () => {
    expect(basePosition(0.5, 0.5, W, H)).toEqual({ x: W / 2, y: H / 2 })
  })

  it('maps the origin to the top-left, because the coordinates are not flipped', () => {
    expect(basePosition(0, 0, W, H)).toEqual({ x: 0, y: 0 })
  })

  it('preserves the source image proportions, so a distance on screen is a distance on site', () => {
    const a = basePosition(0.2, 0.2, W, H)
    const b = basePosition(0.3, 0.3, W, H)
    // Equal normalized deltas must produce a screen delta in the image's own
    // aspect. If this drifts, x and y have stopped sharing a scale and the
    // whole "is this family near that one" premise is broken.
    expect((b.x - a.x) / (b.y - a.y)).toBeCloseTo(MAP_ASPECT, 5)
  })
})

describe('screenPosition', () => {
  it('is the identity at rest', () => {
    expect(screenPosition({ x: 120, y: 80 }, IDENTITY_VIEW)).toEqual({ x: 120, y: 80 })
  })

  it('scales about the origin then translates', () => {
    expect(screenPosition({ x: 100, y: 50 }, { k: 2, tx: -30, ty: -10 })).toEqual({
      x: 170,
      y: 90,
    })
  })
})

describe('zoomAt', () => {
  it('leaves the point under the cursor exactly where it was', () => {
    const before = screenPosition({ x: 400, y: 300 }, IDENTITY_VIEW)
    const view = zoomAt(IDENTITY_VIEW, before.x, before.y, 2.5, W, H)
    const after = screenPosition({ x: 400, y: 300 }, view)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('never zooms out past the fit', () => {
    expect(zoomAt(IDENTITY_VIEW, W / 2, H / 2, 0.1, W, H).k).toBe(K_MIN)
  })

  it('never zooms in past the ceiling', () => {
    expect(zoomAt({ k: K_MAX, tx: 0, ty: 0 }, W / 2, H / 2, 4, W, H).k).toBe(K_MAX)
  })

  // The documented precedence, pinned so nobody "fixes" the clamp to preserve
  // invariance. Both cases below were checked by hand to CONFIRM the clamp
  // actually engages: zooming about the origin from tx=0 does NOT engage it —
  // the invariant tx is already 0 — so that shape asserts nothing and is why
  // these start from a panned view and zoom OUT.
  it('lets the no-gutter clamp override cursor invariance at the zoom floor', () => {
    // Invariance wants tx = -625; at k=1 the valid pan range collapses to the
    // single point [0, 0], so the clamp forces 0 and the cursor drifts 625px.
    const view = zoomAt({ k: 8, tx: -5000, ty: -4000 }, 0, 0, 0.01, W, H)
    expect(view.k).toBe(K_MIN)
    expect(view.tx).toBe(0)
    expect(view.ty).toBe(0)
  })

  it('clamps to the real pan bound, not merely to zero', () => {
    // Invariance wants tx = -1500, but at k=1.5 the bound is W - 1.5*W. A test
    // that only covered the floor above would miss a sign error here.
    const view = zoomAt({ k: 10, tx: -10000, ty: -8000 }, 0, 0, 0.15, W, H)
    expect(view.k).toBeCloseTo(1.5, 10)
    expect(view.tx).toBeCloseTo(W - 1.5 * W, 6)
    expect(view.ty).toBeCloseTo(H - 1.5 * H, 6)
  })
})

/**
 * The INVERSE of `basePosition` + `screenPosition` — where a pointer's screen
 * position lands in normalized 0-1 map space, for kindred#2396's pin drag.
 * Read-only maths, exactly like every other function in this file: it never
 * touches the DOM, so a drag handler can be tested without mocking
 * `getBoundingClientRect`.
 */
describe('screenToNormalized', () => {
  it('round-trips a normalized point through the forward transform at rest', () => {
    const normalized = { x: 0.37, y: 0.62 }
    const base = basePosition(normalized.x, normalized.y, W, H)
    const screen = screenPosition(base, IDENTITY_VIEW)
    // toBeCloseTo per axis, not toEqual — floating point division is not
    // exact even when the forward transform is the identity multiply.
    const back = screenToNormalized(screen.x, screen.y, IDENTITY_VIEW, W, H)
    expect(back.x).toBeCloseTo(normalized.x, 10)
    expect(back.y).toBeCloseTo(normalized.y, 10)
  })

  it('round-trips through a panned, zoomed view — not just the identity', () => {
    const normalized = { x: 0.15, y: 0.85 }
    const view = { k: 3, tx: -220, ty: -140 }
    const base = basePosition(normalized.x, normalized.y, W, H)
    const screen = screenPosition(base, view)
    const back = screenToNormalized(screen.x, screen.y, view, W, H)
    expect(back.x).toBeCloseTo(normalized.x, 10)
    expect(back.y).toBeCloseTo(normalized.y, 10)
  })

  it('clamps a point dragged past the canvas edge to the edge, never outside 0-1', () => {
    expect(screenToNormalized(-500, -500, IDENTITY_VIEW, W, H)).toEqual({ x: 0, y: 0 })
    expect(screenToNormalized(W + 500, H + 500, IDENTITY_VIEW, W, H)).toEqual({ x: 1, y: 1 })
  })
})

describe('clampView', () => {
  it('pins the view to the frame exactly at rest', () => {
    expect(clampView(IDENTITY_VIEW, W, H)).toEqual(IDENTITY_VIEW)
  })

  it('never leaves a gutter, however hard the map is dragged', () => {
    // The map fills the frame at every zoom, so a positive offset would show
    // background beside the image.
    const dragged = clampView({ k: 3, tx: 900, ty: 700 }, W, H)
    expect(dragged.tx).toBe(0)
    expect(dragged.ty).toBe(0)

    const far = clampView({ k: 3, tx: -99999, ty: -99999 }, W, H)
    expect(far.tx).toBe(W - W * 3)
    expect(far.ty).toBe(H - H * 3)
  })
})
