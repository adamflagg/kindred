/**
 * Adult-weekend Jotform setup (kindred#2759). One card per ACTIVE-SEASON adult
 * weekend — built from camp_sessions by the API, never a hardcoded list — then
 * the unmatched queue. "Pull now" runs the `jotform_submissions` sync job,
 * which pulls every enabled form; a completed pull refreshes this tab through
 * SYNC_DEPENDENT_PREFIXES.
 */
import { RefreshCw } from 'lucide-react'

import { useCurrentYear } from '../../../hooks/useCurrentYear'
import { useJotformForms } from '../../../hooks/useJotformAdmin'
import { useRunIndividualSync } from '../../../hooks/useRunIndividualSync'
import { QueryGuard } from '../../QueryGuard'
import { JotformFormCard } from './JotformFormCard'
import { JotformQueue } from './JotformQueue'
import { BUTTON_SECONDARY } from './lodgingStyles'

export const JOTFORM_SYNC_ID = 'jotform_submissions'

export function JotformPanel() {
  const { currentYear } = useCurrentYear()
  const yearReady = currentYear > 0
  const forms = useJotformForms(currentYear)
  const runSync = useRunIndividualSync()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-muted-foreground max-w-2xl text-sm">
          One Jotform per adult weekend this season. Paste the form&apos;s builder link, confirm
          which question is which, and pull. Bunking requests then appear on the adult board for
          staff with bunking access.
        </p>
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

      <QueryGuard
        isLoading={forms.isLoading || !yearReady}
        error={forms.error}
        data={forms.data}
        label="Jotform forms"
      >
        {(data) =>
          (data.rows ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">No adult weekends in {currentYear}.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {(data.rows ?? []).map((row) => (
                // Keyed by year too: CampMinder reuses a weekend's session id
                // across years, and the card's unsaved edits must not follow
                // a year switch.
                <JotformFormCard
                  key={`${String(currentYear)}-${String(row.session_cm_id)}`}
                  row={row}
                  year={currentYear}
                />
              ))}
            </div>
          )
        }
      </QueryGuard>

      <JotformQueue year={currentYear} />
    </div>
  )
}
