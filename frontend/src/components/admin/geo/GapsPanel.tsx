/**
 * GapsPanel — Stub for TDD.
 *
 * Minimal export so tests can import the component.
 * Will be replaced with full implementation after tests are committed.
 */

import type { GapsResponse } from '../../../services/geoService'
import type { GeoCategory } from '../geoConstants'

export interface GapsPanelProps {
  gaps: GapsResponse
  category: GeoCategory
  year: number
  onResolve?: (gapName: string, gapType: string) => void
}

export function GapsPanel(_props: GapsPanelProps) {
  return null
}

export default GapsPanel
