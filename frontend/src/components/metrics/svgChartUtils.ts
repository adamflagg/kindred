/**
 * SVG math utilities for CSS chart components.
 *
 * Pure functions for generating SVG path data — no React, no DOM.
 * Used by CssLineChart (monotone curves) and CssPieChart (arc segments).
 */

/**
 * Convert polar coordinates to SVG cartesian.
 * 0 deg = top (12 o'clock), clockwise.
 */
export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  }
}

/**
 * Generate SVG path for a pie/donut segment (wedge or ring arc).
 *
 * - innerRadius = 0 -> filled wedge (pie slice)
 * - innerRadius > 0 -> ring arc (donut segment)
 *
 * Returns empty string if startAngle === endAngle.
 */
export function arcPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const sweep = endAngle - startAngle
  if (Math.abs(sweep) < 0.01) return ''

  // Clamp near-full circles to avoid rendering glitch
  const effectiveSweep = Math.min(sweep, 359.99)
  const effectiveEnd = startAngle + effectiveSweep
  const largeArc = effectiveSweep > 180 ? 1 : 0

  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle)
  const outerEnd = polarToCartesian(cx, cy, outerRadius, effectiveEnd)

  if (innerRadius <= 0) {
    // Filled wedge: center -> arc -> close
    return [
      `M ${cx} ${cy}`,
      `L ${outerStart.x} ${outerStart.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      'Z',
    ].join(' ')
  }

  // Ring arc (donut): outer arc -> line to inner -> inner arc (reverse) -> close
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle)
  const innerEnd = polarToCartesian(cx, cy, innerRadius, effectiveEnd)

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

/**
 * Generate a monotone cubic spline SVG path through the given points.
 *
 * Uses Fritsch-Carlson method to ensure monotonicity (no overshoot).
 * This is the same algorithm Recharts uses for type="monotone".
 *
 * Returns empty string if fewer than 2 points.
 */
export function monotoneCubicPath(points: Array<{ x: number; y: number }>): string {
  const n = points.length
  if (n < 2) return ''

  const p0 = points[0]!
  const p1 = points[1]!
  if (n === 2) {
    return `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`
  }

  // Step 1: Compute secants (slopes between consecutive points)
  const deltas: number[] = []
  const secants: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const cur = points[i]!
    const next = points[i + 1]!
    const dx = next.x - cur.x
    const dy = next.y - cur.y
    deltas.push(dx)
    secants.push(dx === 0 ? 0 : dy / dx)
  }

  // Step 2: Initialize tangents as average of secants (Fritsch-Carlson)
  const tangents: number[] = [secants[0]!]
  for (let i = 1; i < n - 1; i++) {
    const prev = secants[i - 1]!
    const cur = secants[i]!
    if (prev * cur <= 0) {
      // Sign change or zero — set tangent to 0 (monotonicity)
      tangents.push(0)
    } else {
      tangents.push((prev + cur) / 2)
    }
  }
  tangents.push(secants[n - 2]!)

  // Step 3: Fritsch-Carlson modification to ensure monotonicity
  for (let i = 0; i < n - 1; i++) {
    const sec = secants[i]!
    if (Math.abs(sec) < 1e-10) {
      tangents[i] = 0
      tangents[i + 1] = 0
    } else {
      const alpha = tangents[i]! / sec
      const beta = tangents[i + 1]! / sec
      const s = alpha * alpha + beta * beta
      if (s > 9) {
        const tau = 3 / Math.sqrt(s)
        tangents[i] = tau * alpha * sec
        tangents[i + 1] = tau * beta * sec
      }
    }
  }

  // Step 4: Build cubic bezier path
  let d = `M ${p0.x} ${p0.y}`
  for (let i = 0; i < n - 1; i++) {
    const cur = points[i]!
    const next = points[i + 1]!
    const dx = deltas[i]! / 3
    const cp1x = cur.x + dx
    const cp1y = cur.y + tangents[i]! * dx
    const cp2x = next.x - dx
    const cp2y = next.y - tangents[i + 1]! * dx
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`
  }

  return d
}
