import type { GapItem } from '../../../services/geoService'

export interface AddCoordsPanelProps {
  gaps: GapItem[]
  onAdd: (name: string) => void
  onBatchResolve: () => void
  isBatchResolving: boolean
}

// Stub: tests define the spec, implementation follows
export function AddCoordsPanel(_props: AddCoordsPanelProps) {
  return null
}
