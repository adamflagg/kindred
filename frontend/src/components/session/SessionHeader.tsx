/**
 * SessionHeader component - Compact single-line design
 * Optimized for quick session/scenario switching with minimal vertical space
 */

import { Link } from 'react-router'
import { Tent, Trash2, GitCompare, Settings, ChevronDown } from 'lucide-react'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import type { Session } from '../../types/app-types'
import { getFormattedSessionName } from '../../utils/sessionDisplay'
import {
  sessionNameToUrl,
  sortSessionsByDate,
  filterSelectableSessions,
} from '../../utils/sessionUtils'
import PreValidateRequestsButton from '../PreValidateRequestsButton'
import ValidateBunkingButton from '../ValidateBunkingButton'
import { BunkingLegendButton } from '../BunkingLegend'
import ModeBadge from '../ModeBadge'
import OptimizeBunksButton from '../OptimizeBunksButton'

export interface SessionHeaderProps {
  /** Current session data */
  session: Session
  /** All sessions for the dropdown selector */
  allSessions: Session[]
  /** Current year for validation endpoints */
  currentYear: number
  /** Whether currently in production mode (no scenario selected) */
  isProductionMode: boolean
  /** Currently selected scenario (null if production mode) */
  currentScenario: { id: string; name: string } | null
  /** Available scenarios for the selector */
  scenarios: Array<{ id: string; name: string }>
  /** Whether scenarios are loading */
  scenarioLoading: boolean
  /** Whether solver is currently running */
  isSolving: boolean
  /** Whether solver results are being applied */
  isApplyingResults: boolean
  /** Captured scenario ID during solver operation (for pulse indicator) */
  capturedScenarioId: string | null
  /** Navigate to a different session */
  onSessionChange: (sessionCmId: string) => void
  /** Run the solver with optional time limit and respectLocks flag */
  onRunSolver: (timeLimit?: number, respectLocks?: boolean) => void
  /** Whether to respect locked bunk assignments */
  respectLocks: boolean
  /** Callback when respectLocks toggle changes */
  onRespectLocksChange: (value: boolean) => void
  /** Show clear assignments dialog */
  onShowClearDialog: () => void
  /** Show new scenario modal */
  onShowNewScenarioModal: () => void
  /** Show scenario management modal */
  onShowScenarioManagement: () => void
  /** Select a scenario (null for production) */
  onSelectScenario: (scenarioId: string | null) => void
  /** Whether the user has bunking.manage permission (hides management controls when false) */
  canManage?: boolean
}

export default function SessionHeader({
  session,
  allSessions,
  currentYear,
  isProductionMode,
  currentScenario,
  scenarios,
  scenarioLoading,
  isSolving,
  isApplyingResults,
  capturedScenarioId,
  onSessionChange,
  onRunSolver,
  respectLocks,
  onRespectLocksChange,
  onShowClearDialog,
  onShowNewScenarioModal,
  onShowScenarioManagement,
  onSelectScenario,
  canManage = true,
}: SessionHeaderProps) {
  const selectableSessions = sortSessionsByDate(filterSelectableSessions(allSessions))
  const showPulse = (isSolving || isApplyingResults) && capturedScenarioId !== null

  // Handle scenario dropdown change - includes "new" option
  const handleScenarioChange = (value: string) => {
    if (value === 'new') {
      onShowNewScenarioModal()
    } else {
      onSelectScenario(value === 'production' ? null : value)
    }
  }

  return (
    <div className="mb-4">
      <div className="card-lodge p-3 sm:p-4">
        {/* Single row: session + mode/scenario on left, action buttons pushed right */}
        <div className="flex items-center gap-3">
          {/* Session selector */}
          <div className="flex flex-shrink-0 items-center gap-2">
            <Tent className="text-primary h-5 w-5 flex-shrink-0 sm:h-6 sm:w-6" />
            <Listbox value={session.cm_id.toString()} onChange={(value) => onSessionChange(value)}>
              <div className="relative">
                <ListboxButton className="font-display hover:text-primary flex cursor-pointer items-center gap-1 bg-transparent text-xl font-bold transition-colors focus:outline-none sm:text-2xl">
                  {getFormattedSessionName(session, allSessions)}
                  <ChevronDown className="text-muted-foreground h-4 w-4" />
                </ListboxButton>
                <ListboxOptions className="listbox-options w-auto min-w-[160px]">
                  {selectableSessions.map((s) => (
                    <ListboxOption
                      key={s.id}
                      value={s.cm_id.toString()}
                      className="listbox-option py-1.5"
                    >
                      {getFormattedSessionName(s, allSessions)}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            </Listbox>
          </div>

          {/* Mode + Scenario controls (manage permission required) */}
          <ModeBadge isProductionMode={isProductionMode} scenarioName={currentScenario?.name} />

          {canManage && (
            <>
              <div className="relative">
                <Listbox
                  value={currentScenario?.id ?? 'production'}
                  onChange={handleScenarioChange}
                  disabled={scenarioLoading || isSolving || isApplyingResults}
                >
                  <ListboxButton
                    className="listbox-button-compact max-w-[130px] min-w-[130px]"
                    title={currentScenario?.name ?? 'CampMinder'}
                  >
                    <span className="flex-1 truncate text-left">
                      {currentScenario?.name ?? 'CampMinder'}
                    </span>
                    <ChevronDown className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                  </ListboxButton>
                  <ListboxOptions className="listbox-options w-auto min-w-[160px]">
                    <ListboxOption value="production" className="listbox-option py-1.5">
                      CampMinder
                    </ListboxOption>
                    {scenarios.map((scenario) => (
                      <ListboxOption
                        key={scenario.id}
                        value={scenario.id}
                        className="listbox-option py-1.5"
                      >
                        {scenario.name}
                      </ListboxOption>
                    ))}
                    <ListboxOption
                      value="new"
                      className="listbox-option text-primary border-border mt-1 border-t py-1.5 pt-2 font-medium"
                    >
                      + New Scenario
                    </ListboxOption>
                  </ListboxOptions>
                </Listbox>
                {showPulse && (
                  <div className="bg-primary absolute -top-1.5 -right-1.5 h-2.5 w-2.5 animate-pulse rounded-full" />
                )}
              </div>

              <button
                onClick={onShowScenarioManagement}
                className="btn-ghost text-muted-foreground hover:text-foreground p-1.5"
                title="Manage Scenarios"
              >
                <Settings className="h-4 w-4" />
              </button>

              {scenarios.length > 0 && (
                <Link
                  to={`/summer/session/${sessionNameToUrl(session.name)}/compare`}
                  className="btn-ghost text-muted-foreground hover:text-foreground p-1.5"
                  title="Compare scenarios"
                >
                  <GitCompare className="h-4 w-4" />
                </Link>
              )}
            </>
          )}

          {/* Right: Action buttons - ml-auto pushes to far right */}
          <div className="ml-auto flex items-center gap-2">
            {canManage && (
              <PreValidateRequestsButton
                sessionCmId={session.cm_id}
                year={currentYear}
                className="px-3 py-2 text-sm"
              />
            )}
            {canManage && !isProductionMode && (
              <OptimizeBunksButton
                isSolving={isSolving}
                isApplyingResults={isApplyingResults}
                onRunSolver={onRunSolver}
                respectLocks={respectLocks}
                onRespectLocksChange={onRespectLocksChange}
              />
            )}
            <ValidateBunkingButton
              sessionCmId={session.cm_id}
              year={currentYear}
              className="px-3 py-2 text-sm"
            />
            {canManage && !isProductionMode && currentScenario && (
              <button
                onClick={onShowClearDialog}
                className="btn-secondary flex items-center gap-1.5 px-3 py-2 text-sm"
                title="Clear all bunk assignments"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )}
            <BunkingLegendButton />
          </div>
        </div>
      </div>
    </div>
  )
}
