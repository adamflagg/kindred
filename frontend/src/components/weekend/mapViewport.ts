/**
 * Viewport maths for the lodging map. Pure, DOM-free, and unit-tested because
 * this is where a map quietly stops telling the truth.
 *
 * THE COORDINATE SPACE IS THE CAMP MAP PAGE. `map_x`/`map_y` were digitised
 * against page 1 of the camp map PDF (792x612pt, rendering to 3300x2550), so
 * positioning is a plain `x*W, y*H` with a top-left origin and NO axis flip.
 * There is nothing to fit and nothing to project.
 *
 * The canvas MUST be rendered at `MAP_ASPECT`. If it is not, x and y stop
 * sharing the image's own scale and a surface whose entire purpose is judging
 * nearness starts lying about distance.
 */

/** Pan and zoom. `screen = base * k + t`. */
export interface Viewport {
  k: number
  tx: number
  ty: number
}

/** The rendered camp map's aspect. The canvas is locked to this. */
export const MAP_ASPECT = 3300 / 2550

/** Fit — the whole map, filling the frame. */
export const IDENTITY_VIEW: Viewport = { k: 1, tx: 0, ty: 0 }

/** Zoomed out past 1 would show background beside the map, so 1 is the floor. */
export const K_MIN = 1

/**
 * Separating the tightest pair of rooms is what sets this ceiling, and it is
 * CANVAS-DEPENDENT in the unhelpful direction: measured on the real registry,
 * full separation needs ~8.4x on a 1400px canvas and ~13.1x on a 900px one, so
 * a narrower canvas needs MORE zoom. 14 covers every realistic width.
 *
 * The background is upscaled long before that — a 3300px source reaches 1:1 at
 * ~2.75x on a 1200px canvas — but the marks are drawn at CONSTANT size and do
 * not blur with it, and separating them is the whole point of zooming here.
 */
export const K_MAX = 14

/** Normalized 0-1 map coordinates to canvas pixels at rest. */
export function basePosition(
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } {
  return { x: x * width, y: y * height }
}

export function screenPosition(
  base: { x: number; y: number },
  view: Viewport
): { x: number; y: number } {
  return { x: base.x * view.k + view.tx, y: base.y * view.k + view.ty }
}

/**
 * Keep the map filling the frame at every zoom.
 *
 * Deliberately stricter than "keep some of it on screen": the background is an
 * illustration of the whole site, so any gutter reads as the map having been
 * lost rather than panned.
 */
export function clampView(view: Viewport, width: number, height: number): Viewport {
  const k = Math.min(K_MAX, Math.max(K_MIN, view.k))
  return {
    k,
    tx: Math.min(0, Math.max(width - width * k, view.tx)),
    ty: Math.min(0, Math.max(height - height * k, view.ty)),
  }
}

/**
 * Zoom about a point.
 *
 * Whatever sits under (px, py) stays under it EXACTLY — but only while the pan
 * clamp does not engage. Near a map edge the tx the invariance wants falls
 * outside `[width - width*k, 0]` and the clamp wins, sliding the content. That
 * is the intended precedence: a gutter is a worse lie than a few pixels of
 * drift, because it reads as the map having been lost.
 */
export function zoomAt(
  view: Viewport,
  px: number,
  py: number,
  factor: number,
  width: number,
  height: number
): Viewport {
  const k = Math.min(K_MAX, Math.max(K_MIN, view.k * factor))
  const ratio = k / view.k
  return clampView(
    { k, tx: px - (px - view.tx) * ratio, ty: py - (py - view.ty) * ratio },
    width,
    height
  )
}
