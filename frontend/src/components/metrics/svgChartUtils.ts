/**
 * SVG math utilities for CSS chart components.
 *
 * Pure functions for generating SVG path data — no React, no DOM.
 * Used by CssLineChart (monotone curves) and CssPieChart (arc segments).
 */

/** Convert polar coordinates to SVG cartesian. 0 deg = top (12 o'clock), clockwise. */
export function polarToCartesian(
  _cx: number,
  _cy: number,
  _radius: number,
  _angleDeg: number
): { x: number; y: number } {
  throw new Error('Not implemented')
}

/** Generate SVG path for a pie/donut segment. */
export function arcPath(
  _cx: number,
  _cy: number,
  _innerRadius: number,
  _outerRadius: number,
  _startAngle: number,
  _endAngle: number
): string {
  throw new Error('Not implemented')
}

/** Generate a monotone cubic spline SVG path through points. */
export function monotoneCubicPath(_points: Array<{ x: number; y: number }>): string {
  throw new Error('Not implemented')
}
