/**
 * Adult-weekend Jotform setup (kindred#2759). One TAB per active-season adult
 * weekend — built from camp_sessions by the API, never a hardcoded list — each
 * holding that weekend's form card and its slice of the queue. The selected
 * tab lives in the URL (`?session=<cm_id>`), so it is linkable and survives a
 * reload (CLAUDE.md "Family Camp Models Summer"); it defaults to the first.
 *
 * "Pull now" runs the `jotform_submissions` sync job, which pulls EVERY enabled
 * form, not only the open tab's; a completed pull refreshes this tab through
 * SYNC_DEPENDENT_PREFIXES.
 */
import { RefreshCw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useJotformForms } from '../../../hooks/useJotformAdmin'
import { useRunIndividualSync } from '../../../hooks/useRunIndividualSync'
import { QueryGuard } from '../../QueryGuard'
import { JotformFormCard } from './JotformFormCard'
import { JotformQueue } from './JotformQueue'
import { BUTTON_SECONDARY, TAB_NAV, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from './lodgingStyles'

export const JOTFORM_SYNC_ID = 'jotform_submissions'
const SESSION_PARAM = 'session'

export function JotformPanel() {
  const { currentYear } = useCurrentYear()
  const yearReady = currentYear > 0
  const forms = useJotformForms(currentYear)
  const runSync = useRunIndividualSync()
  const [searchParams] = useSearchParams()
  const requested = Number(searchParams.get(SESSION_PARAM))

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground max-w-2xl text-sm">
        One Jotform per adult weekend this season. Paste the form&apos;s builder link, confirm which
        question is which, and pull. Bunking requests then appear on the adult board for staff with
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

              <div className="flex flex-wrap items-center justify-end gap-3">
                <span className="text-muted-foreground text-xs">
                  Pulls every enabled weekend&apos;s form, not only this one.
                </span>
                <button
                  type="button"
                  className={BUTTON_SECONDARY}
                  disabled={runSync.isPending}
                  onClick={() => {
                    runSync.mutate(JOTFORM_SYNC_ID)
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                  Pull now
                </button>
              </div>

              {/* Keyed by year too: CampMinder reuses a weekend's session id
                  across years, and the card's unsaved edits must not follow a
                  year switch. */}
              <JotformFormCard
                key={`${String(currentYear)}-${String(row.session_cm_id)}`}
                row={row}
                year={currentYear}
              />
              <JotformQueue year={currentYear} sessionCmId={row.session_cm_id} />
            </div>
          )
        }}
      </QueryGuard>
    </div>
  )
}
