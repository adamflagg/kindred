// Stub — implementation in next commit
import type { GapItem } from '../../../services/geoService'

export interface NonCanonicalsPanelProps {
  grouped: GapItem[]
  ungrouped: GapItem[]
  onResolve: (name: string, gapType: string) => void
}

export function NonCanonicalsPanel(_props: NonCanonicalsPanelProps) {
  return null
}
