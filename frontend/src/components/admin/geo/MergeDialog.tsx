/**
 * MergeDialog -- Dialog for merging one canonical into another.
 *
 * Lets the user search for a target canonical and merge the source into it.
 * All source variants will be reassigned to the target canonical.
 *
 * TODO: Implementation follows in next commit (TDD).
 */

import type { GeoCategory } from '../geoConstants'

interface MergeDialogProps {
  open: boolean
  onClose: () => void
  sourceCanonical: string
  category: GeoCategory
  year: number
}

export function MergeDialog(_props: MergeDialogProps) {
  return null
}

export default MergeDialog
