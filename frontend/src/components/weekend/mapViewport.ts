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
 * The source is 3300px wide. Past roughly 8x a ~1200px canvas is upscaling,
 * and 8x is also where the last proximity cluster dissolves, so there is
 * little reason to go further.
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

/** Zoom about a point, leaving whatever is under it exactly where it is. */
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

/**
 * Frame a set of base-space points.
 *
 * An empty set returns the resting view rather than NaN — callers pass a
 * filtered list, and an empty one means "nothing to frame", not "an error".
 */
export function fitTo(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  pad = 80
): Viewport {
  if (points.length === 0) return IDENTITY_VIEW
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const k = Math.min(
    K_MAX,
    Math.max(
      K_MIN,
      Math.min((width - pad * 2) / Math.max(x1 - x0, 1), (height - pad * 2) / Math.max(y1 - y0, 1))
    )
  )
  return clampView(
    { k, tx: width / 2 - ((x0 + x1) / 2) * k, ty: height / 2 - ((y0 + y1) / 2) * k },
    width,
    height
  )
}
