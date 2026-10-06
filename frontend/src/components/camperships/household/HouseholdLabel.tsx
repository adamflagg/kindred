import type { HouseholdLabel } from './householdModel'
import { HH_NOTE } from './householdStyles'

/**
 * A household's label (#3025; owner, 2026-10-05): the adults' names, then the tie-break muted when
 * another household on the page reads the same. Callers put it beside the chip, which is unchanged.
 */
export function HouseholdLabelText({
  label,
  className = '',
}: {
  label: HouseholdLabel
  className?: string
}) {
  return (
    <>
      <span className={className}>{label.text}</span>
      {label.tiebreak !== '' && (
        <>
          {' '}
          <span className={HH_NOTE}>{label.tiebreak}</span>
        </>
      )}
    </>
  )
}
