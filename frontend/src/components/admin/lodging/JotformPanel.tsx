/**
 * Adult-weekend Jotform setup (kindred#2759). One TAB per active-season adult
 * weekend — built from camp_sessions by the API, never a hardcoded list — each
 * holding that weekend's form card. The queue of filings lives on the weekend
 * itself, in its Requests tab (kindred#2828 ruling 2026-09-25); each tab here
 * links there with the count that needs a guest. The selected
 * tab lives in the URL (`?session=<cm_id>`), so it is linkable and survives a
 * reload (CLAUDE.md "Family Camp Models Summer"); it defaults to the first.
 *
 * Each card's Save & pull (kindred#2828) runs the `jotform_submissions` sync
 * job, which pulls EVERY enabled form, not only the open tab's, and refreshes
 * this tab when that run finishes (`useJotformPull`).
 */
import { Link, useSearchParams } from 'react-router'

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useJotformForms, useJotformQueue } from '../../../hooks/useJotformAdmin'
import { QueryGuard } from '../../QueryGuard'
import { JotformFormCard } from './JotformFormCard'
import { TAB_NAV, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from './lodgingStyles'

const SESSION_PARAM = 'session'

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
        One Jotform per adult weekend this season. Paste the form&apos;s builder link and click Save
        &amp; pull: Kindred reads the form, maps its questions and matches the submissions. Check
        any question marked in amber. Bunking requests then appear on the adult board for staff with
        bunking access.
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
              <p className="text-muted-foreground text-sm">No adult weekends in {currentYear}.</p>
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
                        {entry.session_name}
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
              <RequestsLink
                sessionCmId={row.session_cm_id}
                needsAGuest={
                  (queue.data?.unmatched ?? []).filter(
                    (item) => item.session_cm_id === row.session_cm_id
                  ).length
                }
              />
            </div>
          )
        }}
      </QueryGuard>
    </div>
  )
}
