/**
 * Adult-weekend Jotform setup (kindred#2759). One TAB per active-season adult
 * weekend and, from 2027, per Adult Reg session (kindred#3213 re-ruling
 * 2026-10-14) — built from camp_sessions by the API, never a hardcoded list —
 * each holding that session's form card. An adult weekend's queue of filings
 * lives on the weekend itself, in its Requests tab (kindred#2828 ruling
 * 2026-09-25); its tab here links there with the count that needs a guest.
 * An Adult Reg session has no weekend board (its guests reach the Family Camp
 * board with the 2027 lodging work), so its queue is shown here, in place. The selected
 * tab lives in the URL (`?session=<cm_id>`), so it is linkable and survives a
 * reload (CLAUDE.md "Family Camp Models Summer"); it defaults to the first.
 *
 * Each card's Save & pull (kindred#2828) runs the `jotform_submissions` sync
 * job, which pulls EVERY enabled form, not only the open tab's, and refreshes
 * this tab when that run finishes (`useJotformPull`).
 */
import { lazy, Suspense } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useJotformForms, useJotformQueue } from '../../../hooks/useJotformAdmin'
import { sessionName } from '../../../utils/sessionName'
import { isFamilyAdultSessionType } from '../../../utils/sessionTypePredicates'
import { QueryGuard } from '../../QueryGuard'
import { JotformFormCard } from './JotformFormCard'
import { TAB_NAV, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from './lodgingStyles'

const SESSION_PARAM = 'session'

/**
 * Split as the weekend page splits it: only an Adult Reg tab renders the queue
 * here, so the rest of Manage never downloads it.
 */
const JotformQueue = lazy(() => import('./JotformQueue').then((m) => ({ default: m.JotformQueue })))

/**
 * The one line pointing at the weekend's Requests tab, where its filings are
 * reviewed. Addressed by CampMinder id, which the weekend route resolves as
 * readily as a slug, so this tab needs no weekend list of its own.
 */
function RequestsLink({ sessionCmId, needsAGuest }: { sessionCmId: number; needsAGuest: number }) {
  const count =
    needsAGuest === 0
      ? 'No filings need a guest.'
      : `${String(needsAGuest)} ${needsAGuest === 1 ? 'filing needs' : 'filings need'} a guest.`
  return (
    <p data-testid="jotform-requests-link" className="text-muted-foreground text-sm">
      {`${count} `}
      <Link
        to={`/weekend/${String(sessionCmId)}/requests`}
        className="text-primary font-semibold hover:underline"
      >
        Review filings on the weekend&apos;s Requests tab
      </Link>
    </p>
  )
}

export function JotformPanel() {
  const { currentYear } = useCurrentYear()
  const yearReady = currentYear > 0
  const forms = useJotformForms(currentYear)
  // The year's queue, for each weekend's needs-a-guest count only.
  const queue = useJotformQueue(currentYear, yearReady)
  const [searchParams] = useSearchParams()
  const requested = Number(searchParams.get(SESSION_PARAM))

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-2xl text-sm">
        One Jotform per adult weekend and Adult Reg session this season. Paste the form&apos;s
        builder link and click Save &amp; pull: Kindred reads the form, maps its questions and
        matches the submissions. Check any question marked in amber. An adult weekend&apos;s bunking
        requests then appear on the adult board for staff with bunking access; an Adult Reg
        session&apos;s filings are reviewed here, below its form.
      </p>

      <QueryGuard
        isLoading={forms.isLoading || !yearReady}
        error={forms.error}
        data={forms.data}
        label="Jotform forms"
      >
        {(data) => {
          const rows = data.rows ?? []
          // An unknown or missing ?session= opens the first weekend rather than
          // an empty tab — a stale link should not look like a broken feature.
          const row = rows.find((entry) => entry.session_cm_id === requested) ?? rows[0]
          if (row === undefined) {
            return (
              <p className="text-muted-foreground text-sm">
                No adult weekends or Adult Reg sessions in {currentYear}.
              </p>
            )
          }
          return (
            <div className="flex flex-col gap-4">
              <nav className={TAB_NAV} aria-label="Adult weekends">
                <div className="flex flex-wrap items-center gap-1.5">
                  {rows.map((entry) => {
                    const isActive = entry.session_cm_id === row.session_cm_id
                    return (
                      <Link
                        key={entry.session_cm_id}
                        to={{ search: `?${SESSION_PARAM}=${String(entry.session_cm_id)}` }}
                        aria-current={isActive ? 'page' : undefined}
                        className={isActive ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
                      >
                        {/* An Adult Reg tab reads short ("FC4 Adults"); the form card below
                            keeps CampMinder's full name as its heading. */}
                        {isFamilyAdultSessionType(entry.session_type)
                          ? sessionName(entry.session_name, entry.session_type, 'tiny')
                          : entry.session_name}
                      </Link>
                    )
                  })}
                </div>
              </nav>

              {/* Keyed by year too: CampMinder reuses a weekend's session id
                  across years, and the card's unsaved edits must not follow a
                  year switch. */}
              <JotformFormCard
                key={`${String(currentYear)}-${String(row.session_cm_id)}`}
                row={row}
                year={currentYear}
              />
              {isFamilyAdultSessionType(row.session_type) ? (
                // No board to link to: the live queue (scenario '') sits here.
                <Suspense
                  fallback={<p className="text-muted-foreground text-sm">Loading filings…</p>}
                >
                  <JotformQueue year={currentYear} sessionCmId={row.session_cm_id} scenario="" />
                </Suspense>
              ) : (
                <RequestsLink
                  sessionCmId={row.session_cm_id}
                  needsAGuest={
                    (queue.data?.unmatched ?? []).filter(
                      (item) => item.session_cm_id === row.session_cm_id
                    ).length
                  }
                />
              )}
            </div>
          )
        }}
      </QueryGuard>
    </div>
  )
}
