/**
 * "Average 2.6 summers per camper, this one included." under the Summers at Camp chart
 * (owner ruling D-UNCOVERED, 2026-10-15). The figure is CampMinder's Years At Camp, as
 * decision 12 requires of any average-seasons figure, with a numbered note saying so.
 */
import { DefRef } from '../camperships/kit/DefinitionNotes'
import { TENURE_NOTE } from './tenureNotes'

export function AverageSummersLine({ average }: { average: number | null | undefined }) {
  if (average == null) return null
  return (
    <p className="text-foreground pt-2 text-sm">
      Average <b className="font-semibold">{average.toFixed(1)}</b> summers per camper, this one
      included.
      <DefRef n={TENURE_NOTE} />
    </p>
  )
}
