/**
 * CamperCohortsSection - renders "Also from [X]: N campers" rows
 * for school, congregation, and city cohorts.
 *
 * Placement: below demographics (Quick Stats Bar), above Bunking Preferences
 * in CamperDetailsPanel.
 *
 * Each row is a button that opens CohortDrillDownModal listing the matched
 * campers (already gender-scoped + same-session by useCamperCohorts).
 */
import { useState } from 'react'
import { Users } from 'lucide-react'
import { useCamperCohorts } from '../hooks/useCamperCohorts'
import { useCohortRequestRelations } from '../hooks/useCohortRequestRelations'
import { CohortDrillDownModal, type CohortKind } from './CohortDrillDownModal'

interface CamperCohortsSectionProps {
  personCmId: number
  sessionCmId: number
  year: number
  /** Source camper's display name (preferred or first), used in modal copy. */
  selfDisplayName: string
}

export function CamperCohortsSection({
  personCmId,
  sessionCmId,
  year,
  selfDisplayName,
}: CamperCohortsSectionProps) {
  const { cohorts, isLoading } = useCamperCohorts(personCmId, sessionCmId, year)
  const { relations } = useCohortRequestRelations(personCmId, sessionCmId, year)
  const [openKind, setOpenKind] = useState<CohortKind | null>(null)

  if (isLoading || !cohorts) return null

  const KINDS: CohortKind[] = ['school', 'congregation', 'city']
  const rows = KINDS.flatMap((kind) => {
    const entry = cohorts[kind]
    return entry && entry.count > 0 ? [{ kind, ...entry }] : []
  })

  if (rows.length === 0) return null

  const openEntry = openKind ? cohorts[openKind] : null

  return (
    <section aria-label="Session cohorts" data-testid="camper-cohorts-section">
      <div className="space-y-1">
        {rows.map((row) => {
          const camperWord = row.count === 1 ? 'camper' : 'campers'
          return (
            <button
              key={`${row.kind}-${row.label}`}
              type="button"
              onClick={() => setOpenKind(row.kind)}
              className="text-muted-foreground hover:bg-muted/50 hover:text-foreground flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition-colors"
              data-testid="cohort-row"
              data-cohort-kind={row.kind}
            >
              <Users className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
              <span data-cohort-label={row.label}>
                {`Also from ${row.label}: ${row.count} ${camperWord}`}
              </span>
            </button>
          )
        })}
      </div>

      {openKind && openEntry && (
        <CohortDrillDownModal
          open
          kind={openKind}
          label={openEntry.label}
          selfDisplayName={selfDisplayName}
          sessionType={cohorts.sessionType}
          attendees={openEntry.attendees}
          requestRelations={relations}
          onClose={() => setOpenKind(null)}
        />
      )}
    </section>
  )
}
