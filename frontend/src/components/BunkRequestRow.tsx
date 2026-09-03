import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import clsx from 'clsx'
import CamperLink from './CamperLink'
import { formatReason, MUTUAL_BADGE_CLASSES } from '../utils/dispositionColors'
import { hasMatchedRequestTarget } from '../utils/bunkRequest'
import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

export interface BunkRequestRowProps {
  /** The bunk request record to render. */
  request: BunkRequestsResponse
  /** Resolved target person (from cm_id lookup). If provided and request is resolved, displayName will use first_name + last_name. */
  targetPerson?: PersonsResponse | null
  /** When true, renders a "you are here" highlight ring. */
  isCurrent?: boolean
  /**
   * Whether the request is satisfied. Only rendered when `showSatisfaction` is true.
   * `null` ⇒ no pill (unknown / unassigned / missing-from-lookup).
   */
  satisfied?: boolean | null
  /** Whether to render the satisfaction icon (typically true for confirmed rows in the modal). */
  showSatisfaction?: boolean
  /** Optional detail text for the satisfaction tooltip (e.g. "Same bunk", "No grade on file"). */
  detail?: string | null
  /**
   * When provided, renders the row as a <button> and calls this on click.
   * The click event stops propagation so the surrounding expanded-row toggler is not fired.
   */
  onSelect?: (() => void) | undefined
  /**
   * Optional badge rendered immediately after the mutual badge. Used by the
   * camper-requests panel to inject the "Current request" chip.
   */
  badge?: ReactNode | undefined
  /** When true: applies sparkle-material class to the Sparkles icon and renders an amber "P" badge. */
  isMaterialAgePreference?: boolean
  /** When true: renders an indigo "S" badge next to the Sparkles icon. */
  staffAgeBadge?: boolean
}

function ClickableRow({
  className,
  onSelect,
  children,
}: {
  className: string
  onSelect?: (() => void) | undefined
  children: ReactNode
}) {
  if (!onSelect) return <div className={className}>{children}</div>
  return (
    <div
      role="button"
      tabIndex={0}
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onSelect()
        }
      }}
    >
      {children}
    </div>
  )
}

// Type-keyed dot: green for bunk_with (and age_preference fallback), red for
// not_bunk_with. We only render resolved rows here, so there is no pending /
// declined branching — the dot color reflects the request's intent.
function typeDot(requestType: string) {
  const isNotWith = requestType === 'not_bunk_with'
  return (
    <span
      className={clsx(
        'h-2 w-2 flex-shrink-0 rounded-full',
        isNotWith ? 'bg-red-500' : 'bg-green-500'
      )}
      aria-hidden="true"
    />
  )
}

function MetPill({ satisfied, detail }: { satisfied: boolean | null; detail: string | null }) {
  if (satisfied === null) return null

  const tooltip = detail ?? undefined
  if (satisfied) {
    return (
      <span className="ml-auto" title={tooltip}>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Met
        </span>
      </span>
    )
  }
  return (
    <span className="ml-auto" title={tooltip}>
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Unmet
      </span>
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
  satisfied = null,
  showSatisfaction = false,
  detail = null,
  onSelect,
  badge,
  isMaterialAgePreference = false,
  staffAgeBadge = false,
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
        {/* Wrap the SVG in a span so the animation has a reliable inline-flex
            container — applying CSS animations directly to <svg> is fragile
            across browsers and the `transform-origin` interacts oddly with
            SVG default rendering boxes. The span owns the animation; the SVG
            inherits the transform via the parent. */}
        <span
          className={clsx('inline-flex', isMaterialAgePreference && 'sparkle-material')}
          aria-hidden="true"
        >
          <Sparkles
            className={clsx(
              'h-3 w-3 flex-shrink-0',
              isMaterialAgePreference ? 'text-amber-600 dark:text-amber-400' : 'text-amber-500'
            )}
          />
        </span>
        {isMaterialAgePreference && (
          <span className="rounded bg-amber-100 px-1.5 text-[10px] leading-4 font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            P
          </span>
        )}
        {staffAgeBadge && (
          <span className="rounded bg-indigo-100 px-1.5 text-[10px] leading-4 font-bold text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
            S
          </span>
        )}
        <span>
          Prefers bunking with{' '}
          <span className="text-foreground font-medium">{prefersOlder ? 'older' : 'younger'}</span>{' '}
          campers
        </span>
        {badge}
        {showSatisfaction && <MetPill satisfied={satisfied} detail={detail} />}
      </>
    )
    return (
      <ClickableRow className={clsx(rowClass, 'text-muted-foreground')} onSelect={onSelect}>
        {ageChildren}
      </ClickableRow>
    )
  }

  const isBunkWith = request.request_type === 'bunk_with'

  // Prefer resolved person name if we have it; fall back to requested_person_name.
  //
  // Two different operators, deliberately. `resolvedName` is genuinely
  // `string | null`, so `??` is right for the first link. `requested_person_name`
  // is not nullable -- PocketBase zero-values scalars rather than omitting them,
  // so an absent name arrives as '' -- which made the old `?? 'Unknown'` dead
  // and rendered a blank. `||` is what actually reaches the fallback (#2669).
  const resolvedName = targetPerson ? `${targetPerson.first_name} ${targetPerson.last_name}` : null
  const displayName = resolvedName ?? (request.requested_person_name || 'Unknown')

  // A "matched target" is one with a real requestee_id — true for both resolved
  // AND declined requests that pointed at a known camper. Shared with
  // AllCamperRequestsModal so declined rows still get a clickable CamperLink
  // and don't render "(unresolved)".
  const hasMatchedTarget = hasMatchedRequestTarget(
    request,
    resolvedName ?? request.requested_person_name
  )

  const children = (
    <>
      {/* Type-keyed dot: green for bunk_with, red for not_with. */}
      {typeDot(request.request_type)}

      {/* Type label — colored to match the dot. */}
      <span
        className={clsx(
          'font-medium',
          isBunkWith ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
        )}
      >
        {isBunkWith ? 'Bunk with' : 'Not with'}
      </span>

      {/* Arrow */}
      <span className="text-muted-foreground/60">→</span>

      {/* Target - clickable when we have a real requestee match (resolved OR
          declined-but-matched, e.g. cross-session). Unresolved italic fallback
          only kicks in for rows without any matched requestee_id. */}
      <CamperLink
        personCmId={request.requestee_id}
        displayName={displayName}
        isConfirmed={hasMatchedTarget}
        showUnresolved={!hasMatchedTarget && !!request.requested_person_name}
      />

      {/* Decline/disposition reason, when present — appended in the same inline
          style as AllCamperRequestsModal. Skipped for resolved rows where the
          reason isn't user-meaningful here. */}
      {request.disposition_reason && request.status !== 'resolved' && (
        <span className="text-muted-foreground truncate text-[11px]">
          · {formatReason(request.disposition_reason)}
        </span>
      )}

      {/* Reciprocal badge - only if reciprocal */}
      {request.is_reciprocal && <span className={MUTUAL_BADGE_CLASSES}>mutual</span>}

      {/* Optional badge slot (e.g. "Current request", "Pinned") */}
      {badge}

      {/* "Met" pill on right when satisfied (nothing for unmet/unknown). */}
      {showSatisfaction && <MetPill satisfied={satisfied} detail={detail} />}
    </>
  )

  return (
    <ClickableRow className={rowClass} onSelect={onSelect}>
      {children}
    </ClickableRow>
  )
}
