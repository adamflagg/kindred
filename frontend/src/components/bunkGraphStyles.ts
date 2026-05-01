/**
 * Bunk-graph styling helpers.
 *
 * Extracted from BunkSocialGraphModal so the connection-color, grade-color
 * and first-year badge logic can be unit-tested without booting cytoscape.
 */

export const BUNK_NODE_COLORS = {
  // Binary connection state — anything > 0 reads as "has connections".
  noConnections: '#ef4444', // red-500
  hasConnections: '#22c55e', // green-500
  // Light → mid → dark grade ramp. Strong luminance contrast so younger vs
  // older reads at a glance even on small screens; replaces the old blue/red
  // pair which was hard to distinguish from the connection colors.
  gradeLight: '#7dd3fc', // sky-300
  gradeMid: '#6366f1', // indigo-500
  gradeDark: '#312e81', // indigo-900
} as const

/** Outer ring drawn around first-year campers — must pop against every grade
 *  fill above and against red/green node fills. Amber gives the strongest
 *  contrast across the palette. */
export const FIRST_YEAR_RING_COLOR = '#fbbf24' // amber-400

/** Border thickness used for the first-year ring. The default border is 0;
 *  bumping this to 6 makes the ring the entire "first-year" signal — no
 *  inner badge needed, and Cytoscape keeps it perfectly centered at every
 *  zoom level since the ring IS the geometry. */
export const FIRST_YEAR_RING_WIDTH = 6

/** Binary node coloring: red when isolated, green otherwise. The earlier
 *  yellow "few connections" tier was dropped because it fought with the
 *  amber first-year ring and added a third state without much signal. */
export function getNodeColor(degree: number): string {
  return degree === 0 ? BUNK_NODE_COLORS.noConnections : BUNK_NODE_COLORS.hasConnections
}

/** Map each grade present in a bunk to a color from the light/dark ramp.
 *  Younger grades get the lighter end of the scale. */
export function getBunkGradeColors(grades: readonly number[]): Record<number, string> {
  const sorted = [...grades].sort((a, b) => a - b)
  const result: Record<number, string> = {}
  sorted.forEach((grade, index) => {
    if (index === 0) {
      result[grade] = BUNK_NODE_COLORS.gradeLight
    } else if (index === sorted.length - 1) {
      result[grade] = BUNK_NODE_COLORS.gradeDark
    } else {
      result[grade] = BUNK_NODE_COLORS.gradeMid
    }
  })
  return result
}
