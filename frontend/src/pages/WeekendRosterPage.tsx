/**
 * /weekend — the per-weekend lodging roster.
 *
 * Read-only in this slice: assignments come from CampMinder and are shown,
 * not edited. The registry behind it IS editable, at Admin -> Family Camp
 * Lodging, because a seed nobody can correct is worthless (spec §3.8).
 *
 * Everything rendered here is READ from ingest-derived columns. If a share
 * preference, proximity mode or request text looks wrong, the fix belongs in
 * the Go ingest so every surface sees the correction at once.
 */
import { ArrowLeft, Settings } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { QueryGuard } from '../components/QueryGuard'
import {
  formatSessionDates,
  HouseholdRosterTable,
  partyBeds,
  RosterHealthBanner,
  UnitInventoryPanel,
  WeekendSessionPicker,
} from '../components/weekend'
import { useProgram } from '../contexts/ProgramContext'
import { useCurrentYear } from '../hooks/useCurrentYear'
import { useWeekendRoster, useWeekendSessions } from '../hooks/useWeekendRoster'

export default function WeekendRosterPage() {
  const { clearProgram } = useProgram()
  const { currentYear } = useCurrentYear()
  const [selectedCmId, setSelectedCmId] = useState<number | null>(null)

  const sessionsQuery = useWeekendSessions(currentYear)
  const rosterQuery = useWeekendRoster(currentYear, selectedCmId)

  const selectedSession = sessionsQuery.data?.sessions?.find(
    (session) => session.session_cm_id === selectedCmId
  )
  const selectedDates = selectedSession
    ? formatSessionDates(selectedSession.start_date, selectedSession.end_date)
    : ''

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/"
          onClick={() => {
            clearProgram()
          }}
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-2 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to program selection
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-foreground text-3xl font-bold">Weekend Housing</h1>
            {/* The picker below already names the weekend; repeating it here
                would say the same thing twice. The dates are what the header
                can add. */}
            <p className="text-muted-foreground text-sm">
              {selectedDates.length > 0
                ? selectedDates
                : `Family camps and adult weekends, ${String(currentYear)}`}
            </p>
          </div>
          <Link
            to="/admin/lodging"
            className="border-border hover:bg-muted/50 text-foreground inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium"
          >
            <Settings className="h-4 w-4" />
            Lodging settings
          </Link>
        </div>
      </header>

      <QueryGuard
        isLoading={sessionsQuery.isLoading}
        error={sessionsQuery.error}
        data={sessionsQuery.data}
        label="weekend sessions"
        emptyMessage="No family or adult sessions found for this year."
      >
        {(sessions) => (
          <WeekendSessionPicker
            sessions={sessions.sessions ?? []}
            selectedCmId={selectedCmId}
            onSelect={setSelectedCmId}
          />
        )}
      </QueryGuard>

      {selectedCmId === null ? (
        <p className="text-muted-foreground text-sm">Choose a weekend to see its roster.</p>
      ) : (
        <QueryGuard
          isLoading={rosterQuery.isLoading}
          error={rosterQuery.error}
          data={rosterQuery.data}
          label="weekend roster"
          emptyMessage="No roster data for this weekend."
        >
          {(roster) => (
            <div className="flex flex-col gap-6">
              <RosterHealthBanner
                counts={roster.counts ?? {}}
                bedsNeeded={(roster.parties ?? []).reduce((sum, p) => sum + partyBeds(p), 0)}
              />
              <HouseholdRosterTable parties={roster.parties ?? []} year={currentYear} />
              <UnitInventoryPanel units={roster.units ?? []} />
            </div>
          )}
        </QueryGuard>
      )}
    </div>
  )
}
