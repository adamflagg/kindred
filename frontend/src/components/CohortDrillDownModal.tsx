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
  /**
   * True when the cohort list spans all genders (AG session, or self has no
   * gender on file and the hook skipped the gender filter). Controls the
   * subtitle's gender qualifier so it reflects what was actually filtered.
   */
  allGenders?: boolean
  /** Confirmed incoming bunk_with / not_bunk_with requests targeting the source camper. */
  requestRelations?: CohortRelationsMap
  /**
   * Map of personCmId → current bunk name (or null when unassigned). Sourced
   * from the active scenario's drafts or production assignments by the
   * parent. When omitted entirely, the modal hides the bunk line — that
   * keeps tests and standalone usage from inventing an "Unassigned" label.
   */
  bunkByPerson?: Map<number, string | null>
  /**
   * When true (default), the modal reserves 28rem of right-edge space so the
   * source CamperDetailsPanel slide-out remains visible and unblurred — staff
   * referenced the source camper while the cohort opens. Set to false when
   * opened from the full-page CamperDetail view, which has no side panel.
   */
  reserveSidePanel?: boolean
  onClose: () => void
  /** Forwarded to Modal — fires when the leave completes; parents use it to release their retained snapshot (kindred#2529). */
  afterLeave?: () => void
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

function getRelationBadge(
  relationType: 'bunk_with' | 'not_bunk_with' | undefined,
  selfDisplayName: string
): { text: string; classes: string } | null {
  if (relationType === 'bunk_with') {
    return {
      text: `Requested to bunk with ${selfDisplayName}`,
      classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    }
  }
  if (relationType === 'not_bunk_with') {
    return {
      text: `Not to bunk with ${selfDisplayName}`,
      classes: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    }
  }
  return null
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
  allGenders,
  requestRelations,
  bunkByPerson,
  reserveSidePanel = true,
  onClose,
  afterLeave,
}: CohortDrillDownModalProps) {
  const count = attendees.length
  const camperWord = count === 1 ? 'camper' : 'campers'
  // The hook decides whether the gender filter was applied (skipped for AG
  // sessions and for null-gender selves); the subtitle simply mirrors that
  // decision so a staffer reading the count knows whether opposite-gender
  // candidates were filtered out.
  const genderQualifier = allGenders ? 'all genders' : 'same gender'

  const header = (
    <div className="border-border border-b px-6 py-4">
      <h2 id="cohort-modal-title" className="text-lg font-semibold">
        {KIND_TITLE[kind]}: {label}
      </h2>
      <p className="text-muted-foreground mt-0.5 text-sm">
        {count} {camperWord} · same session · {genderQualifier} · potential bunkmates only
      </p>
    </div>
  )

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      {...(afterLeave !== undefined && { afterLeave })}
      header={header}
      ariaLabelledBy="cohort-modal-title"
      size="lg"
      noPadding
      scrollable
      // When opened from the slide-out panel, match its width so it stays
      // unblurred (staff reference the source camper while the cohort opens).
      // From the full page there's no side panel — center normally.
      {...(reserveSidePanel ? { backdropInsetRight: '28rem' } : {})}
    >
      {count === 0 ? (
        <p className="text-muted-foreground p-6 text-sm">No other campers in this session match.</p>
      ) : (
        <ul className="divide-border divide-y">
          {attendees.map((a) => {
            const relation = requestRelations?.get(a.personCmId)
            const relationBadge = getRelationBadge(relation?.type, selfDisplayName)
            // The hook returns the key with `null` for unassigned campers,
            // and is omitted entirely from the prop when callers don't
            // want the bunk line. Distinguish the two:
            //  - prop absent → no metadata line at all when grade is also null
            //  - prop present, value null → render "Unassigned"
            const hasBunkLookup = bunkByPerson?.has(a.personCmId) ?? false
            const bunkName = hasBunkLookup ? (bunkByPerson?.get(a.personCmId) ?? null) : null
            const gradeText = a.grade != null ? `${formatGradeOrdinal(a.grade)} grade` : null
            const bunkText = hasBunkLookup ? (bunkName ?? 'Unassigned') : null
            const metaText =
              gradeText && bunkText ? `${gradeText} · ${bunkText}` : (gradeText ?? bunkText)
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
                  {metaText && <div className="text-muted-foreground text-xs">{metaText}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {relationBadge && (
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${relationBadge.classes}`}
                      data-testid="cohort-modal-relation"
                      data-relation={relation?.type}
                    >
                      {relationBadge.text}
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
