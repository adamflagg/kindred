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
import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { useCamperCohorts } from '../hooks/useCamperCohorts'
import { useCohortBunkAssignments } from '../hooks/useCohortBunkAssignments'
import { useCohortRequestRelations } from '../hooks/useCohortRequestRelations'
import { CohortDrillDownModal, type CohortKind } from './CohortDrillDownModal'

const KINDS: CohortKind[] = ['school', 'congregation', 'city']

interface CamperCohortsSectionProps {
  personCmId: number
  sessionCmId: number
  year: number
  /** Source camper's display name (preferred or first), used in modal copy. */
  selfDisplayName: string
  /** When true, shows a "(primary session)" note — for campers enrolled in multiple sessions. */
  hasMultipleEnrollments?: boolean
}

export function CamperCohortsSection({
  personCmId,
  sessionCmId,
  year,
  selfDisplayName,
  hasMultipleEnrollments = false,
}: CamperCohortsSectionProps) {
  const { cohorts, isLoading } = useCamperCohorts(personCmId, sessionCmId, year)
  const { relations } = useCohortRequestRelations(personCmId, sessionCmId, year)
  // `openKind` is a RETAINED SNAPSHOT, not the open flag (kindred#2529): the
  // drill-down must stay mounted through Modal's 150ms leave transition after
  // close, so closing clears only `drillOpen` and the last-viewed cohort keeps
  // the content renderable through the fade. The modal is hookless, so a
  // mounted-closed instance does no work — Modal's <Transition> unmounts its
  // children while closed.
  const [openKind, setOpenKind] = useState<CohortKind | null>(null)
  const [drillOpen, setDrillOpen] = useState(false)

  // Union of every cohort's matched person ids — feeds the bunk lookup so
  // switching between school/congregation/city tabs reuses the same query.
  const allCohortPersonIds = useMemo(() => {
    if (!cohorts) return [] as number[]
    const ids = new Set<number>()
    for (const kind of KINDS) {
      for (const a of cohorts[kind]?.attendees ?? []) ids.add(a.personCmId)
    }
    return [...ids]
  }, [cohorts])

  const { bunkByPerson } = useCohortBunkAssignments(allCohortPersonIds, sessionCmId, year)

  if (isLoading || !cohorts) return null

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
              key={row.kind}
              type="button"
              onClick={() => {
                setOpenKind(row.kind)
                setDrillOpen(true)
              }}
              className="text-muted-foreground hover:bg-muted/50 hover:text-foreground flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition-colors"
              data-testid="cohort-row"
              data-cohort-kind={row.kind}
            >
              <Users className="h-3 w-3 flex-shrink-0" />
              <span data-cohort-label={row.label}>
                {`Also from ${row.label}: ${row.count} ${camperWord}`}
              </span>
            </button>
          )
        })}
      </div>

      {hasMultipleEnrollments && (
        <p className="text-muted-foreground/60 mt-0.5 px-1 text-xs">
          Cohorts from this session only
        </p>
      )}

      {openKind && openEntry && (
        <CohortDrillDownModal
          open={drillOpen}
          kind={openKind}
          label={openEntry.label}
          selfDisplayName={selfDisplayName}
          allGenders={cohorts.allGenders}
          attendees={openEntry.attendees}
          requestRelations={relations}
          bunkByPerson={bunkByPerson}
          onClose={() => setDrillOpen(false)}
        />
      )}
    </section>
  )
}
