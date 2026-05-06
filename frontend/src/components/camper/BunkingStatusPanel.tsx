/**
 * Panel showing bunking status, assignments, and request satisfaction
 */
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Heart, Home, Clock, CheckCircle } from 'lucide-react'
import { sessionNameToUrl } from '../../utils/sessionUtils'
import { partitionRequestsBySource } from '../../utils/partitionRequestsBySource'
import { isConfirmedRequest } from '../../utils/bunkRequest'
import { BunkRequestRow } from '../BunkRequestRow'
import { ParentStaffDivider, AgePreferenceDivider } from './RequestSectionDividers'
import type { Camper } from '../../types/app-types'
import type { EnhancedBunkRequest } from '../../hooks/camper/useAllBunkRequests'
import type { SatisfactionMap } from '../../hooks/camper/types'
import type { BucketCount, CamperSatisfaction } from '../../types/satisfaction'
import type { BunkRequestsResponse, PersonsResponse } from '../../types/pocketbase-types'

/** Augments a request with the resolved targetPerson used for sort + display.
 *  EnhancedBunkRequest itself doesn't declare targetPerson — we attach it in
 *  partitionInput below. */
type WithTargetPerson<T> = T & {
  targetPerson?: { first_name?: string; last_name?: string } | null
}

function ratioColor(slice: BucketCount): string {
  if (slice.total === 0) return ''
  if (slice.satisfied === slice.total) return 'text-green-600 dark:text-green-400'
  if (slice.satisfied === 0) return 'text-red-600 dark:text-red-400'
  return 'text-amber-600 dark:text-amber-400'
}

function SliceLine({ label, slice }: { label: string; slice: BucketCount }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={`text-sm font-semibold ${ratioColor(slice)}`}>
        {slice.satisfied}/{slice.total} met
      </span>
      {slice.total > 0 && slice.satisfied === slice.total && (
        <CheckCircle className="h-4 w-4 text-green-500 dark:text-green-400" aria-hidden="true" />
      )}
    </div>
  )
}

interface BunkingStatusPanelProps {
  camper: Camper
  enrolledCampers?: Camper[]
  sessionShortName: string
  allBunkRequests: EnhancedBunkRequest[]
  agePreferenceRequests: EnhancedBunkRequest[]
  satisfactionData: SatisfactionMap
  satisfactionLoading: boolean
  /**
   * Authoritative per-camper bucket counts from `/api/satisfaction`. Slice
   * totals on this panel must read from `counted_totals` to stay aligned with
   * the bunking board card and graph node states (#1159).
   */
  camperSatisfaction: CamperSatisfaction
}

export function BunkingStatusPanel({
  camper,
  enrolledCampers,
  sessionShortName,
  allBunkRequests,
  agePreferenceRequests,
  satisfactionData,
  satisfactionLoading,
  camperSatisfaction,
}: BunkingStatusPanelProps) {
  // The per-camper list must agree with the summary above — both filter to
  // status === 'resolved' so pending and declined rows don't render with
  // status-colored dots. `personRequests` covers non-age_preference resolved
  // rows; resolved age prefs flow in via `agePreferenceRequests` and are
  // merged into `summaryRequests` for both the slice summary and the row list.
  const personRequests = useMemo(
    () =>
      allBunkRequests.filter(
        (r) =>
          r.session_id === camper.session_cm_id &&
          r.status === 'resolved' &&
          !r.merged_into &&
          r.request_type !== 'age_preference'
      ),
    [allBunkRequests, camper.session_cm_id]
  )

  // agePreferenceRequests is fetched year-only (allBunkRequests query is not
  // session-scoped), so apply the same defensive gate as personRequests above.
  // Without this, sibling-session age-pref rows leak into summaryRequests and
  // the row partition.
  const resolvedAgePrefs = useMemo(
    () =>
      (agePreferenceRequests ?? []).filter(
        (r) => r.session_id === camper.session_cm_id && !r.merged_into && r.status === 'resolved'
      ),
    [agePreferenceRequests, camper.session_cm_id]
  )

  // Used for both the summary slices and the row partition so material parent
  // age prefs (source_field='bunk_with') and staff age prefs (source='staff')
  // contribute to "X/Y met" instead of only rendering as rows below.
  const summaryRequests = useMemo(
    () => [...personRequests, ...resolvedAgePrefs],
    [personRequests, resolvedAgePrefs]
  )

  // Slice totals come from the centralized aggregator (`/api/satisfaction`),
  // not from re-bucketing rows here. This is the single source of truth shared
  // with the bunking-board card and graph node states (#1159).
  const slices = useMemo(
    () => ({
      materialParent: camperSatisfaction.counted_totals.material_parent,
      staff: camperSatisfaction.counted_totals.staff,
    }),
    [camperSatisfaction]
  )

  const showParent = slices.materialParent.total > 0
  const showStaff = slices.staff.total > 0
  const showSummary = showParent || showStaff

  // R3: targetPerson enrichment strategy (Case b): EnhancedBunkRequest carries
  // `requestedPersonName` (a pre-built "First Last" string) for production
  // data. The partition utility sorts by `targetPerson.{first_name,last_name}`.
  // We split the string here so the sort works; if the string is absent (rare
  // edge case) the row gets a no-op sort key of '' which is acceptable.
  // In tests, `targetPerson` is supplied directly via the WithTargetPerson type
  // and takes precedence via the `?? parsedFallback` below.
  const partitionInput = useMemo(
    () =>
      summaryRequests.map((r) => {
        // r may carry targetPerson directly (test injection or future enrichment).
        const existing = (r as WithTargetPerson<EnhancedBunkRequest>).targetPerson
        if (existing) return { ...r, targetPerson: existing }
        // Fall back: split requestedPersonName "First Last" into parts
        const name = r.requestedPersonName ?? ''
        const spaceIdx = name.indexOf(' ')
        const parsedFallback = name
          ? {
              first_name: spaceIdx >= 0 ? name.slice(0, spaceIdx) : name,
              last_name: spaceIdx >= 0 ? name.slice(spaceIdx + 1) : '',
            }
          : undefined
        return { ...r, targetPerson: parsedFallback }
      }),
    [summaryRequests]
  )

  const {
    parent: parentRows,
    staff: staffRows,
    age: ageRows,
  } = useMemo(() => partitionRequestsBySource(partitionInput), [partitionInput])

  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
      {/* Header with integrated session/bunk status */}
      <div className="border-b border-amber-100 bg-amber-50/50 px-6 py-4 dark:border-amber-900/50 dark:bg-amber-950/40">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-100 p-2 dark:bg-amber-900/30">
              <Heart className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="font-display text-foreground text-lg font-bold">Bunking Status</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">{sessionShortName}</p>
            </div>
          </div>

          {/* Current Assignment Badge(s) */}
          <div className="flex flex-shrink-0 flex-wrap gap-2">
            {enrolledCampers && enrolledCampers.length > 1 ? (
              enrolledCampers.map((ec) => {
                const sess = ec.expand?.session
                const bunk = ec.expand?.assigned_bunk
                const sessMatch = sess?.name.match(/(\d+[ab]?)/i)
                const sessLabel = sessMatch?.[1]
                  ? `S${sessMatch[1]}`
                  : sess?.name.toLowerCase().includes('taste')
                    ? 'ToC'
                    : sess?.session_type === 'ag'
                      ? 'AG'
                      : (sess?.name ?? '?')
                return bunk ? (
                  <Link
                    key={ec.id}
                    to={`/summer/session/${sessionNameToUrl(sess?.name ?? '')}/board`}
                    className="bg-forest-50 dark:bg-forest-900/30 border-forest-200 dark:border-forest-800 hover:bg-forest-100 dark:hover:bg-forest-900/50 inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 transition-colors"
                  >
                    <Home className="text-forest-600 dark:text-forest-400 h-3.5 w-3.5" />
                    <span className="text-forest-700 dark:text-forest-300 text-sm font-semibold">
                      {sessLabel}: {bunk.name}
                    </span>
                  </Link>
                ) : (
                  <span
                    key={ec.id}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 dark:border-amber-800 dark:bg-amber-900/20"
                  >
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      {sessLabel}: Awaiting
                    </span>
                  </span>
                )
              })
            ) : camper.expand?.assigned_bunk ? (
              <Link
                to={`/summer/session/${sessionNameToUrl(camper.expand.session?.name ?? '')}/board`}
                className="bg-forest-50 dark:bg-forest-900/30 border-forest-200 dark:border-forest-800 hover:bg-forest-100 dark:hover:bg-forest-900/50 inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 transition-colors"
              >
                <Home className="text-forest-600 dark:text-forest-400 h-4 w-4" />
                <span className="text-forest-700 dark:text-forest-300 hover:text-forest-800 dark:hover:text-forest-200 font-semibold">
                  {camper.expand.assigned_bunk.name}
                </span>
              </Link>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20">
                <Clock className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Awaiting Assignment
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        {/* Request Satisfaction Summary — rendered above the row list, matching
            the spec design. Summary appears first so staff can immediately see
            overall satisfaction before scanning individual rows. */}
        {showSummary && (
          <div className="bg-muted/20 border-border rounded-lg border px-4 py-3">
            {showParent && showStaff ? (
              <div className="grid grid-cols-[1fr_1px_1fr] items-center">
                <div className="px-4">
                  <SliceLine label="Parent request satisfaction:" slice={slices.materialParent} />
                </div>
                <div className="bg-border self-stretch" />
                <div className="px-4">
                  <SliceLine label="Staff request satisfaction:" slice={slices.staff} />
                </div>
              </div>
            ) : showParent ? (
              <SliceLine label="Parent request satisfaction:" slice={slices.materialParent} />
            ) : (
              <SliceLine label="Staff request satisfaction:" slice={slices.staff} />
            )}
          </div>
        )}

        {/* Bunk Requests - partitioned into parent / staff / age sections. */}
        {parentRows.length > 0 || staffRows.length > 0 || ageRows.length > 0 ? (
          <div className="space-y-1">
            {parentRows.map((req) => {
              const sat = satisfactionData[req.id]
              return (
                <BunkRequestRow
                  key={req.id}
                  request={req as unknown as BunkRequestsResponse}
                  // targetPerson drives displayName in BunkRequestRow. EnhancedBunkRequest
                  // uses camelCase requestedPersonName (not the PB snake_case field), so
                  // we pass the targetPerson we already computed in partitionInput.
                  targetPerson={req.targetPerson as unknown as PersonsResponse | null}
                  satisfaction={sat?.status ?? null}
                  showSatisfaction={isConfirmedRequest(req)}
                  satisfactionLoading={satisfactionLoading}
                  satisfactionDetail={sat?.detail}
                />
              )
            })}

            {parentRows.length > 0 && staffRows.length > 0 && <ParentStaffDivider />}
            {staffRows.map((req) => {
              const sat = satisfactionData[req.id]
              return (
                <BunkRequestRow
                  key={req.id}
                  request={req as unknown as BunkRequestsResponse}
                  targetPerson={req.targetPerson as unknown as PersonsResponse | null}
                  satisfaction={sat?.status ?? null}
                  showSatisfaction={isConfirmedRequest(req)}
                  satisfactionLoading={satisfactionLoading}
                  satisfactionDetail={sat?.detail}
                />
              )
            })}

            {ageRows.length > 0 && (parentRows.length > 0 || staffRows.length > 0) && (
              <AgePreferenceDivider />
            )}
            {ageRows.map((req) => {
              const sat = satisfactionData[req.id]
              return (
                <BunkRequestRow
                  key={req.id}
                  request={req as unknown as BunkRequestsResponse}
                  targetPerson={req.targetPerson as unknown as PersonsResponse | null}
                  satisfaction={sat?.status ?? null}
                  showSatisfaction={true}
                  satisfactionLoading={satisfactionLoading}
                  satisfactionDetail={sat?.detail}
                  isMaterialAgePreference={req.source_field === 'bunk_with'}
                  staffAgeBadge={req.source === 'staff'}
                />
              )
            })}
          </div>
        ) : (
          <div className="py-4 text-center">
            <p className="text-muted-foreground text-sm">No bunk requests on file</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default BunkingStatusPanel
