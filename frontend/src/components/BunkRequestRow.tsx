import type React from 'react'
import { CheckCircle, XCircle, Clock, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import CamperLink from './CamperLink'
import { MUTUAL_BADGE_CLASSES } from '../utils/dispositionColors'
import { isConfirmedRequest } from '../utils/bunkRequest'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

export type SatisfactionStatus = 'satisfied' | 'not_satisfied' | 'unknown' | 'checking'

export interface BunkRequestRowProps {
  /** The bunk request record to render. */
  request: BunkRequestsResponse
  /** Resolved target person (from cm_id lookup). If provided and request is resolved, displayName will use first_name + last_name. */
  targetPerson?: PersonsResponse | null
  /** When true, renders a "you are here" highlight ring. */
  isCurrent?: boolean
  /** Satisfaction status — only rendered when `showSatisfaction` is true. */
  satisfaction?: SatisfactionStatus | null
  /** Whether to render the satisfaction icon (typically true for confirmed rows in the modal). */
  showSatisfaction?: boolean
  /** Whether satisfaction is still being checked (shows spinner). */
  satisfactionLoading?: boolean
  /** Optional detail text for the satisfaction tooltip. */
  satisfactionDetail?: string | undefined
  /**
   * When provided, renders the row as a <button> and calls this on click.
   * The click event stops propagation so the surrounding expanded-row toggler is not fired.
   */
  onSelect?: (() => void) | undefined
  /**
   * Optional badge rendered immediately after the mutual badge. Used by the
   * camper-requests panel to inject the "Current request" chip.
   */
  badge?: React.ReactNode | undefined
}

function statusIcon(status: string) {
  if (status === 'resolved')
    return <CheckCircle className="text-forest-600 dark:text-forest-400 h-4 w-4 flex-shrink-0" />
  if (status === 'declined')
    return <XCircle className="text-bark-600 dark:text-bark-400 h-4 w-4 flex-shrink-0" />
  return <Clock className="h-4 w-4 flex-shrink-0 text-amber-500" />
}

const SATISFACTION_ICONS = {
  satisfied: <span className="sat-icon sat-icon-met">✓</span>,
  not_satisfied: <span className="sat-icon sat-icon-unmet">✗</span>,
  unknown: <span className="sat-icon sat-icon-unknown">?</span>,
}

function SatisfactionIcon({
  satisfaction,
  satisfactionLoading,
  satisfactionDetail,
}: {
  satisfaction: SatisfactionStatus | null
  satisfactionLoading: boolean
  satisfactionDetail?: string | undefined
}) {
  return (
    <span className="ml-auto" title={satisfactionDetail}>
      {satisfactionLoading ? (
        <span className="sat-spinner" />
      ) : satisfaction ? (
        (SATISFACTION_ICONS[satisfaction as keyof typeof SATISFACTION_ICONS] ?? null)
      ) : null}
    </span>
  )
}

/**
 * Renders a single bunk request as a compact row. Used by both the camper
 * side-panel (CamperDetailsPanel) and the expanded row requester summary
 * (CamperRequestSummary) so the two surfaces render identically.
 */
export function BunkRequestRow({
  request,
  targetPerson,
  isCurrent = false,
  satisfaction = null,
  showSatisfaction = false,
  satisfactionLoading = false,
  satisfactionDetail,
  onSelect,
  badge,
}: BunkRequestRowProps) {
  const rowClass = clsx(
    'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors',
    isCurrent ? 'ring-primary/40 bg-primary/5 ring-1' : 'hover:bg-muted/50',
    onSelect &&
      'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
  )

  // Age preference variant
  if (request.request_type === 'age_preference') {
    const prefersOlder = request.age_preference_target === 'older'
    const ageChildren = (
      <>
        <Sparkles className="h-3 w-3 flex-shrink-0 text-amber-500" />
        <span>
          Prefers bunking with{' '}
          <span className="text-foreground font-medium">{prefersOlder ? 'older' : 'younger'}</span>{' '}
          campers
        </span>
        {badge}
        {showSatisfaction && (
          <SatisfactionIcon
            satisfaction={satisfaction}
            satisfactionLoading={satisfactionLoading}
            satisfactionDetail={satisfactionDetail}
          />
        )}
      </>
    )
    if (onSelect) {
      return (
        <button
          type="button"
          className={clsx(rowClass, 'text-muted-foreground text-xs')}
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
        >
          {ageChildren}
        </button>
      )
    }
    return <div className={clsx(rowClass, 'text-muted-foreground text-xs')}>{ageChildren}</div>
  }

  const isBunkWith = request.request_type === 'bunk_with'
  const isConfirmed = isConfirmedRequest(request)

  // Prefer resolved person name if we have it; fall back to requested_person_name.
  const resolvedName = targetPerson ? `${targetPerson.first_name} ${targetPerson.last_name}` : null
  const displayName = resolvedName ?? request.requested_person_name ?? 'Unknown'

  const children = (
    <>
      {/* Status indicator */}
      {statusIcon(request.status)}

      {/* Type label */}
      <span
        className={clsx('text-muted-foreground', !isBunkWith && 'text-red-600 dark:text-red-400')}
      >
        {isBunkWith ? 'Bunk with' : 'Not bunk with'}
      </span>

      {/* Arrow */}
      <span className="text-muted-foreground">→</span>

      {/* Target - clickable if confirmed */}
      <CamperLink
        personCmId={request.requestee_id}
        displayName={displayName}
        isConfirmed={isConfirmed}
        showUnresolved={!isConfirmed && !!request.requested_person_name}
      />

      {/* Reciprocal badge - only if reciprocal */}
      {request.is_reciprocal && <span className={MUTUAL_BADGE_CLASSES}>mutual</span>}

      {/* Optional badge slot (e.g. "Current request", "Pinned") */}
      {badge}

      {/* Satisfaction - concise icon only */}
      {showSatisfaction && (
        <SatisfactionIcon
          satisfaction={satisfaction}
          satisfactionLoading={satisfactionLoading}
          satisfactionDetail={satisfactionDetail}
        />
      )}
    </>
  )

  if (onSelect) {
    return (
      <button
        type="button"
        className={rowClass}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
      >
        {children}
      </button>
    )
  }

  return <div className={rowClass}>{children}</div>
}
