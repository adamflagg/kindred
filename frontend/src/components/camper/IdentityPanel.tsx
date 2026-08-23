/**
 * Collapsible identity panel showing personal details
 * Birthday, school, location, gender identity, pronouns
 *
 * When a cohortContext is provided (current-year enrolled camper), each of
 * school / city / congregation surfaces a small clickable cohort badge below
 * its value, opening a drill-down modal of session peers sharing that field.
 */
import { useMemo, useState } from 'react'
import {
  User,
  ChevronDown,
  ChevronRight,
  Cake,
  School,
  MapPin,
  Building2,
  Users,
} from 'lucide-react'
import { formatAge } from '../../utils/age'
import { formatGenderFull } from '../../utils/genderUtils'
import { formatGradeOrdinal } from '../../utils/gradeUtils'
import { getDisplayAgeForYear } from '../../utils/displayAge'
import { useYear } from '../../hooks/useCurrentYear'
import { useCamperCohorts } from '../../hooks/useCamperCohorts'
import { useCohortRequestRelations } from '../../hooks/useCohortRequestRelations'
import { useCohortBunkAssignments } from '../../hooks/useCohortBunkAssignments'
import { CohortDrillDownModal, type CohortKind } from '../CohortDrillDownModal'
import type { Camper } from '../../types/app-types'

interface CohortContext {
  personCmId: number
  sessionCmId: number
  year: number
  selfDisplayName: string
}

interface IdentityPanelProps {
  camper: Camper
  location: string | null
  congregation: string | null
  pronouns: string
  defaultExpanded?: boolean
  cohortContext?: CohortContext | undefined
}

const KINDS: CohortKind[] = ['school', 'congregation', 'city']

export function IdentityPanel({
  camper,
  location,
  congregation,
  pronouns,
  defaultExpanded = false,
  cohortContext,
}: IdentityPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const viewingYear = useYear()
  // `openKind` is a RETAINED SNAPSHOT, not the open flag (kindred#2529) —
  // same shape as CamperCohortsSection: closing clears only `drillOpen`, so
  // the drill-down stays mounted (and its content stays renderable) through
  // Modal's 150ms leave transition, and afterLeave releases the snapshot
  // once the fade completes so the element tree stops re-evaluating.
  const [openKind, setOpenKind] = useState<CohortKind | null>(null)
  const [drillOpen, setDrillOpen] = useState(false)

  const openCohort = (kind: CohortKind) => {
    setOpenKind(kind)
    setDrillOpen(true)
  }

  const personCmId = cohortContext?.personCmId ?? null
  const sessionCmId = cohortContext?.sessionCmId ?? 0
  const cohortYear = cohortContext?.year ?? 0

  const { cohorts } = useCamperCohorts(personCmId, sessionCmId, cohortYear)
  const { relations } = useCohortRequestRelations(personCmId, sessionCmId, cohortYear)
  const allCohortPersonIds = useMemo(() => {
    if (!cohorts) return [] as number[]
    const ids = new Set<number>()
    for (const kind of KINDS) {
      for (const a of cohorts[kind]?.attendees ?? []) ids.add(a.personCmId)
    }
    return [...ids]
  }, [cohorts])
  const { bunkByPerson } = useCohortBunkAssignments(allCohortPersonIds, sessionCmId, cohortYear)

  const openEntry = openKind && cohorts ? cohorts[openKind] : null

  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-muted/30 hover:bg-muted/50 flex w-full items-center justify-between px-6 py-4 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sky-100 p-2 dark:bg-sky-900/30">
            <User className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <h2 className="font-display text-foreground text-lg font-bold">Identity & Details</h2>
        </div>
        {isExpanded ? (
          <ChevronDown className="text-muted-foreground h-5 w-5" />
        ) : (
          <ChevronRight className="text-muted-foreground h-5 w-5" />
        )}
      </button>

      {isExpanded && (
        <div className="p-6 pt-4">
          {/* Personal Info Row: Birthday | Sex/Gender | Pronouns */}
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="bg-muted/30 rounded-xl p-4">
              <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
                <Cake className="h-3.5 w-3.5" />
                <span>Birthday</span>
              </div>
              <div className="text-sm font-medium">
                {camper.birthdate
                  ? new Date(camper.birthdate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Not provided'}
              </div>
              <div className="text-muted-foreground text-xs">
                {formatAge(getDisplayAgeForYear(camper, viewingYear) ?? 0)}
              </div>
            </div>

            <div className="bg-muted/30 rounded-xl p-4">
              <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                Sex / Gender Identity
              </div>
              <div className="text-sm">
                <span className="font-medium">{formatGenderFull(camper.gender)}</span>
                {' • '}
                <span className="text-muted-foreground">
                  {camper.gender_identity_write_in && camper.gender_identity_write_in.trim() !== ''
                    ? camper.gender_identity_write_in
                    : (camper.gender_identity_name ?? 'Not specified')}
                </span>
              </div>
            </div>

            <div className="bg-muted/30 rounded-xl p-4">
              <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                Pronouns
              </div>
              <div className="text-sm font-medium">{pronouns}</div>
            </div>
          </div>

          {/* Cohort Row: School | City | Congregation. Cohort badges only when
              the parent supplies cohortContext (current-year enrolled). */}
          <div className="border-border grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-3">
            <CohortField
              icon={School}
              label="School"
              value={camper.school ?? 'Not provided'}
              subValue={`${formatGradeOrdinal(camper.grade)} Grade`}
              cohortKind="school"
              cohortCount={cohortContext ? (cohorts?.school?.count ?? 0) : 0}
              onOpenCohort={() => openCohort('school')}
            />
            <CohortField
              icon={MapPin}
              label="Location"
              value={location ?? 'Not specified'}
              cohortKind="city"
              cohortCount={cohortContext ? (cohorts?.city?.count ?? 0) : 0}
              onOpenCohort={() => openCohort('city')}
            />
            <CohortField
              icon={Building2}
              label="Congregation"
              value={congregation ?? 'Not provided'}
              cohortKind="congregation"
              cohortCount={cohortContext ? (cohorts?.congregation?.count ?? 0) : 0}
              onOpenCohort={() => openCohort('congregation')}
            />
          </div>
        </div>
      )}

      {openKind && openEntry && cohorts && cohortContext && (
        <CohortDrillDownModal
          open={drillOpen}
          kind={openKind}
          label={openEntry.label}
          selfDisplayName={cohortContext.selfDisplayName}
          allGenders={cohorts.allGenders}
          attendees={openEntry.attendees}
          requestRelations={relations}
          bunkByPerson={bunkByPerson}
          reserveSidePanel={false}
          onClose={() => setDrillOpen(false)}
          afterLeave={() => setOpenKind(null)}
        />
      )}
    </div>
  )
}

interface CohortFieldProps {
  icon: typeof School
  label: string
  value: string
  subValue?: string
  cohortKind: CohortKind
  cohortCount: number
  onOpenCohort: () => void
}

function CohortField({
  icon: Icon,
  label,
  value,
  subValue,
  cohortKind,
  cohortCount,
  onOpenCohort,
}: CohortFieldProps) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
        {subValue && <div className="text-muted-foreground text-xs">{subValue}</div>}
        {cohortCount > 0 && (
          <button
            type="button"
            onClick={onOpenCohort}
            data-testid={`cohort-badge-${cohortKind}`}
            data-cohort-kind={cohortKind}
            className="bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors"
          >
            <Users className="h-3 w-3" />
            <span>
              {cohortCount} other{cohortCount === 1 ? '' : 's'} here
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

export default IdentityPanel
