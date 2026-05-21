/**
 * Bunk-graph styling helpers.
 *
 * Extracted from BunkSocialGraphModal so the connection-color, grade-color
 * and first-year badge logic can be unit-tested without booting cytoscape.
 */

import type { EdgeSingular, NodeSingular, StylesheetStyle } from 'cytoscape'
import { resolveEdgeColor } from './graph/cytoscapeStyles'

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
  const sorted = grades.toSorted((a, b) => a - b)
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

/**
 * Cytoscape stylesheet for the per-bunk graph (BunkSocialGraphModal).
 *
 * Edge color/arrow resolution routes through `resolveEdgeColor` from the
 * shared graph module so `not_bunk_with` requests render red on the bunk
 * graph the same way they do on the session graph. Previously a local
 * single-entry `EDGE_COLORS` map keyed on `edge_type` alone collapsed both
 * positive and negative requests to the same blue (#1545).
 */
export function getBunkCytoscapeStyles(): StylesheetStyle[] {
  return [
    {
      selector: 'node',
      style: {
        'background-color': (ele: NodeSingular) => getNodeColor(ele.degree(false)),
        width: 40,
        height: 40,
        label: 'data(label)',
        'font-size': '14px',
        'font-weight': 600,
        'text-valign': 'bottom',
        'text-margin-y': 8,
        'text-wrap': 'wrap',
        'text-max-width': '120px',
        // gradeColor is set per-node in the element data builder so each
        // camper's label picks up the light → dark ramp from getBunkGradeColors.
        color: 'data(gradeColor)',
        'text-outline-width': 2,
        'text-outline-color': '#ffffff',
        'overlay-padding': '6px',
      },
    },
    {
      selector: 'node.isolated',
      style: {
        // Isolated nodes don't need special border styling.
      },
    },
    {
      selector: 'node.first-year',
      style: {
        // The amber ring is the entire first-year signal — making it
        // thicker than the default node border keeps the marker centered
        // by geometry (no SVG badge to drift at fractional zooms).
        'border-width': FIRST_YEAR_RING_WIDTH,
        'border-color': FIRST_YEAR_RING_COLOR,
        'border-style': 'solid',
      },
    },
    {
      selector: 'edge',
      style: {
        // Default is a dashed one-way request arrow. The backend
        // (build_bunk_graph) already collapses mutual pairs into a single
        // edge tagged reciprocal — those pick up the bold solid
        // double-headed style from the edge[?reciprocal] selector below.
        // Mirrors the session-level treatment in graph/cytoscapeStyles.ts.
        width: 2,
        'line-style': 'dashed',
        'line-color': (ele: EdgeSingular) => resolveEdgeColor(ele),
        'target-arrow-shape': (ele: EdgeSingular) => {
          const edgeType = ele.data('edge_type')
          return edgeType === 'request' ? 'triangle' : 'none'
        },
        'target-arrow-color': (ele: EdgeSingular) => resolveEdgeColor(ele),
        'line-opacity': (ele: EdgeSingular) => {
          const confidence = (ele.data('confidence') as number | undefined) ?? 0.5
          return Math.max(0.3, Math.min(0.9, confidence))
        },
        'curve-style': 'straight',
        'control-point-step-size': 40,
        'overlay-padding': '3px',
      },
    },
    {
      selector: 'edge[?reciprocal]',
      style: {
        // Bold solid double-headed line for backend-collapsed mutual pairs.
        // line-color and target-arrow-color inherit from the base 'edge'
        // rule; source-arrow-color must mirror them so a recip not_bunk_with
        // doesn't render with a blue source arrow.
        width: 4,
        'line-style': 'solid',
        'source-arrow-shape': 'triangle',
        'source-arrow-color': (ele: EdgeSingular) => resolveEdgeColor(ele),
      },
    },
  ]
}
