/**
 * ResolveDialog — Stub for TDD (tests written first).
 * Will be implemented after tests are committed.
 */
import type { GeoCategory } from '../geoConstants'

interface ResolveDialogProps {
  open: boolean
  onClose: () => void
  gapName: string
  gapType: string
  category: GeoCategory
  year: number
}

export function ResolveDialog(_props: ResolveDialogProps) {
  return null
}
