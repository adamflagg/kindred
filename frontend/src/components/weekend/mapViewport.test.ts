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

  it('lets the no-gutter clamp override cursor invariance at an edge', () => {
    // The documented precedence, pinned so nobody "fixes" the clamp to
    // preserve invariance: at the left edge the tx invariance wants is
    // positive, which would open a gutter, so the clamp takes it to 0.
    const view = zoomAt(IDENTITY_VIEW, 0, 0, 4, W, H)
    expect(view.k).toBe(4)
    expect(view.tx).toBe(0)
    expect(view.ty).toBe(0)
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
