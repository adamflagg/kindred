/**
 * Modal showing the campers behind a cohort row in CamperCohortsSection.
 *
 * Receives the matched-attendee list pre-computed by useCamperCohorts and
 * incoming-request relations from useCohortRequestRelations — already scoped
 * to the same session, enrolled-only, current-camper excluded, and (for
 * non-AG sessions) same-gender. So this component is a pure renderer.
 *
 * Relation badges show OTHER campers who have requested the source camper
 * (incoming requests). Mutual ('M') marker is added when the source camper
 * also requested back.
 */
import { Link } from 'react-router'
import { Modal } from './ui/Modal'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import type { CohortMatchedAttendee } from '../hooks/useCamperCohorts'
import type { CohortRelationsMap } from '../hooks/useCohortRequestRelations'

export type CohortKind = 'school' | 'congregation' | 'city'

interface CohortDrillDownModalProps {
  open: boolean
  kind: CohortKind
  label: string
  attendees: CohortMatchedAttendee[]
  /** Display name of the source camper (whose detail panel is open). */
  selfDisplayName: string
  /** Confirmed incoming bunk_with / not_bunk_with requests targeting the source camper. */
  requestRelations?: CohortRelationsMap
  onClose: () => void
}

const KIND_TITLE: Record<CohortKind, string> = {
  school: 'Same school',
  congregation: 'Same congregation',
  city: 'Same city',
}

function displayName(a: CohortMatchedAttendee): string {
  const first = a.preferredName?.trim() || a.firstName
  return `${first} ${a.lastName}`.trim()
}

/**
 * Tiny boy/girl silhouettes — same SVGs the session-list page uses for the
 * sexDistribution counts (frontend/src/components/SessionList.tsx). Kept inline
 * so the visual stays in lockstep without an extra abstraction.
 */
function GenderIcon({ gender }: { gender: string }) {
  if (gender === 'M') {
    return (
      <svg
        data-testid="cohort-modal-gender"
        data-gender="M"
        aria-label="Boy"
        className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <circle cx="12" cy="4" r="3" />
        <path d="M12 8c-2.5 0-4 1.5-4 3v5h2v6h4v-6h2v-5c0-1.5-1.5-3-4-3z" />
      </svg>
    )
  }
  if (gender === 'F') {
    return (
      <svg
        data-testid="cohort-modal-gender"
        data-gender="F"
        aria-label="Girl"
        className="h-4 w-4 flex-shrink-0 text-pink-600 dark:text-pink-400"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <circle cx="12" cy="4" r="3" />
        <path d="M12 8c-3 0-5 1.5-5 3l2 7h2v4h2v-4h2l2-7c0-1.5-2-3-5-3z" />
      </svg>
    )
  }
  return null
}

export function CohortDrillDownModal({
  open,
  kind,
  label,
  attendees,
  selfDisplayName,
  requestRelations,
  onClose,
}: CohortDrillDownModalProps) {
  if (!open) return null

  const count = attendees.length

  const header = (
    <div className="border-border border-b px-6 py-4">
      <h2 id="cohort-modal-title" className="text-lg font-semibold">
        {KIND_TITLE[kind]}: {label}
      </h2>
      <p className="text-muted-foreground mt-0.5 text-sm">
        {count} campers · same session · potential bunkmates only
      </p>
    </div>
  )

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      header={header}
      ariaLabelledBy="cohort-modal-title"
      size="lg"
      noPadding
      scrollable
    >
      {count === 0 ? (
        <p className="text-muted-foreground p-6 text-sm">No other campers in this session match.</p>
      ) : (
        <ul className="divide-border divide-y">
          {attendees.map((a) => {
            const relation = requestRelations?.get(a.personCmId)
            const badgeText =
              relation?.type === 'bunk_with'
                ? `Requested to bunk with ${selfDisplayName}`
                : relation?.type === 'not_bunk_with'
                  ? `Not to bunk with ${selfDisplayName}`
                  : null
            const badgeClasses =
              relation?.type === 'bunk_with'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
            return (
              <li
                key={a.attendeeId}
                data-testid="cohort-modal-row"
                className="flex items-center justify-between gap-4 px-6 py-3"
              >
                <div className="min-w-0">
                  <Link
                    to={`/camper/${a.personCmId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary block truncate text-sm font-medium hover:underline"
                  >
                    {displayName(a)}
                  </Link>
                  <div className="text-muted-foreground text-xs">
                    {formatGradeOrdinal(a.grade)} grade
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {badgeText && (
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${badgeClasses}`}
                      data-testid="cohort-modal-relation"
                      data-relation={relation?.type}
                    >
                      {badgeText}
                    </span>
                  )}
                  {relation?.mutual && (
                    <span
                      data-testid="cohort-modal-mutual"
                      title="Mutual — both campers requested each other"
                      className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    >
                      Mutual
                    </span>
                  )}
                  {a.gender && <GenderIcon gender={a.gender} />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
