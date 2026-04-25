/**
 * CamperCohortsSection - renders "Also from [X]: N campers" rows
 * for school, congregation, and city cohorts.
 *
 * Placement: below demographics (Quick Stats Bar), above Bunking Preferences
 * in CamperDetailsPanel.
 *
 * Spec: scoreboard item #15. Clicking is OUT OF SCOPE (#15b).
 */
import { Users } from 'lucide-react'
import { useCamperCohorts } from '../hooks/useCamperCohorts'

interface CamperCohortsSectionProps {
  personCmId: number
  sessionCmId: number
  year: number
}

export function CamperCohortsSection({ personCmId, sessionCmId, year }: CamperCohortsSectionProps) {
  const { cohorts, isLoading } = useCamperCohorts(personCmId, sessionCmId, year)

  if (isLoading || !cohorts) return null

  // Build visible rows: only entries where count > 0
  const KINDS = ['school', 'congregation', 'city'] as const
  const rows = KINDS.flatMap((kind) => {
    const entry = cohorts[kind]
    return entry && entry.count > 0 ? [{ kind, ...entry }] : []
  })

  if (rows.length === 0) return null

  return (
    <section data-testid="camper-cohorts-section">
      <div className="space-y-1">
        {rows.map((row) => (
          <div
            key={`${row.kind}-${row.label}`}
            className="text-muted-foreground flex items-center gap-1.5 text-xs"
            data-testid="cohort-row"
            data-cohort-kind={row.kind}
          >
            <Users className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span data-cohort-label={row.label}>
              {`Also from ${row.label}: ${row.count} campers`}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
