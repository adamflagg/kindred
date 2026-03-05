/**
 * CanonicalCard — Expandable card for a canonical entry.
 *
 * Stub: implementation pending (TDD — tests first).
 */
import type { CanonicalEntry } from '../../../services/geoService'
import type { GeoCategory } from '../geoConstants'

export interface CanonicalCardProps {
  entry: CanonicalEntry
  category: GeoCategory
  year: number
  isExpanded: boolean
  onToggleExpand: () => void
  onReassignSource?: (originalValue: string) => void
  onMerge?: (canonicalName: string) => void
}

export function CanonicalCard(_props: CanonicalCardProps): React.ReactNode {
  return null
}

export default CanonicalCard
