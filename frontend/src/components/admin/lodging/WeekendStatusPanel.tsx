/**
 * Mark a weekend cancelled, or put it back.
 *
 * WHY THIS EXISTS AT ALL. CampMinder has no field to derive a cancellation
 * from. Its Sessions API exposes twenty properties and not one of them is a
 * status or a registration-availability concept, and both derived rules that
 * were tried failed on measured production data: "attendee rows exist but none
 * are enrolled" misses a weekend cancelled before anyone registered — which is
 * byte-identical to one that has not opened yet — and `is_active` is a
 * passthrough of CampMinder's own field measuring 25% precise for this. So the
 * flag is staff-owned, with no sync source, and nothing in the sync layer may
 * write or clear it (kindred#2092).
 *
 * WHY IT LIVES HERE and not on the weekend lander. Every other season-grain
 * fact is edited on this screen — the unit registry, the cabin-name aliases,
 * the season roll-forward — behind the same `bunking.manage` gate the route
 * carries. The lander BADGES the flag and never sets it, which keeps that
 * screen a read surface and keeps one place to look for "things about a
 * season".
 *
 * ABSENCE OF A ROW MEANS ACTIVE, so reinstating a weekend deletes its row
 * rather than writing `active` — see `setWeekendSessionStatus`.
 *
 * A TOGGLE, not a select, even though the column is a two-value select that is
 * meant to widen later. The select is a STORAGE decision (a third value should
 * be a value addition, not a type migration); with two values a per-row button
 * is the honest control, and the day a third arrives this becomes a picker.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Loader2, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useWeekendSessions } from '../../../hooks/useWeekendRoster'
import { setWeekendSessionStatus } from '../../../services/lodgingCrud'
import type { WeekendSession, WeekendSessionStatusValue } from '../../../types/lodging'
import { invalidateLodgingRegistryQueries } from '../../../utils/queryKeys'
import { formatSessionDates, sortWeekendsByDate } from '../../weekend'
import { QueryGuard } from '../../QueryGuard'
import { ACTION_LINK, HEADER_ROW, MUTED_PILL, PILL } from './lodgingStyles'

interface StatusWrite {
  session: WeekendSession
  status: WeekendSessionStatusValue
}

export function WeekendStatusPanel() {
  const { currentYear } = useCurrentYear()
  const queryClient = useQueryClient()
  // `useWeekendSessions` gates its own fetch on `year > 0` — CurrentYearContext
  // answers the literal 0 until the backend supplies the configured season, and
  // the router declares `ge=2000`, so an ungated call eats a 422 on every cold
  // load. Its query inherits the app cache defaults, as every weekend hook does.
  const sessionsQuery = useWeekendSessions(currentYear)

  const write = useMutation({
    mutationFn: ({ session, status }: StatusWrite) =>
      setWeekendSessionStatus(currentYear, session.session_cm_id, status),
    onSuccess: (_result, { session, status }) => {
      // NOT just this panel's own read. The status is projected into
      // /api/lodging/sessions AND /api/lodging/summary, whose queries inherit
      // the app's 30-minute staleTime, so a registry-local invalidation would
      // leave the lander calling a cancelled weekend "upcoming" for half an
      // hour. This helper carries all three weekend prefixes.
      invalidateLodgingRegistryQueries(queryClient)
      toast.success(
        status === 'cancelled'
          ? `${session.name} marked cancelled`
          : `${session.name} is running again`
      )
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to change the weekend status')
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-2xl text-sm">
        Mark a weekend that is not running. CampMinder has no cancellation field, so this is the
        only place it can be recorded. A cancelled weekend still opens — it keeps its cabin
        assignments and its link — but it drops out of the &ldquo;need a cabin&rdquo; figures on the
        weekend list.
      </p>

      <QueryGuard
        isLoading={sessionsQuery.isLoading}
        error={sessionsQuery.error}
        data={sessionsQuery.data}
        label="weekend sessions"
      >
        {(data) => {
          const sessions = sortWeekendsByDate(data.sessions ?? [])
          if (sessions.length === 0) {
            return (
              <p className="text-muted-foreground text-sm">
                No family or adult weekends in {currentYear} yet.
              </p>
            )
          }
          return (
            <div className="card-lodge overflow-x-auto p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className={HEADER_ROW}>
                    <th scope="col" className="py-2 pr-4 text-left">
                      Weekend
                    </th>
                    <th scope="col" className="py-2 pr-4 text-left">
                      Dates
                    </th>
                    <th scope="col" className="py-2 pr-4 text-left">
                      Status
                    </th>
                    <th scope="col" className="py-2 text-right">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const isCancelled = session.status === 'cancelled'
                    // `variables` is only read while a write is in flight, so
                    // the guard is what makes the non-optional access safe —
                    // TanStack types it non-nullish but leaves it undefined
                    // until the first mutate().
                    const pending =
                      write.isPending &&
                      write.variables.session.session_cm_id === session.session_cm_id
                    return (
                      <tr
                        key={session.session_cm_id}
                        className="border-border/60 border-b last:border-b-0"
                      >
                        <th scope="row" className="py-2 pr-4 text-left font-medium">
                          {session.name}
                        </th>
                        <td className="text-muted-foreground py-2 pr-4">
                          {formatSessionDates(session.start_date, session.end_date)}
                        </td>
                        <td className="py-2 pr-4">
                          {isCancelled ? (
                            <span
                              className={`bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 ${PILL}`}
                            >
                              Cancelled
                            </span>
                          ) : (
                            <span className={MUTED_PILL}>Running</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            disabled={write.isPending}
                            onClick={() => {
                              write.mutate({
                                session,
                                status: isCancelled ? 'active' : 'cancelled',
                              })
                            }}
                            // The weekend's name is IN the accessible name.
                            // Twelve rows of "Cancel" is twelve identical
                            // controls to a screen reader, and this one is
                            // destructive enough to be worth naming.
                            aria-label={
                              isCancelled ? `Reinstate ${session.name}` : `Cancel ${session.name}`
                            }
                            className={`${ACTION_LINK} inline-flex items-center gap-1.5 disabled:opacity-50 ${
                              isCancelled ? 'text-primary' : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {pending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : isCancelled ? (
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            {isCancelled ? 'Reinstate' : 'Cancel'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        }}
      </QueryGuard>
    </div>
  )
}
