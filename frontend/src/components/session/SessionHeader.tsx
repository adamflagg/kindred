/**
 * SessionHeader component - Compact single-line design
 * Optimized for quick session/scenario switching with minimal vertical space
 */

import { Link } from 'react-router';
import { Tent, Trash2, GitCompare, Settings, ChevronDown } from 'lucide-react';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import type { Session } from '../../types/app-types';
import { getFormattedSessionName } from '../../utils/sessionDisplay';
import {
  sessionNameToUrl,
  sortSessionsByDate,
  filterSelectableSessions,
} from '../../utils/sessionUtils';
import PreValidateRequestsButton from '../PreValidateRequestsButton';
import ValidateBunkingButton from '../ValidateBunkingButton';
import { BunkingLegendButton } from '../BunkingLegend';
import ModeBadge from '../ModeBadge';
import OptimizeBunksButton from '../OptimizeBunksButton';

export interface SessionHeaderProps {
  /** Current session data */
  session: Session;
  /** All sessions for the dropdown selector */
  allSessions: Session[];
  /** Current year for validation endpoints */
  currentYear: number;
  /** Whether currently in production mode (no scenario selected) */
  isProductionMode: boolean;
  /** Currently selected scenario (null if production mode) */
  currentScenario: { id: string; name: string } | null;
  /** Available scenarios for the selector */
  scenarios: Array<{ id: string; name: string }>;
  /** Whether scenarios are loading */
  scenarioLoading: boolean;
  /** Whether solver is currently running */
  isSolving: boolean;
  /** Whether solver results are being applied */
  isApplyingResults: boolean;
  /** Captured scenario ID during solver operation (for pulse indicator) */
  capturedScenarioId: string | null;
  /** Navigate to a different session */
  onSessionChange: (sessionCmId: string) => void;
  /** Run the solver with optional time limit */
  onRunSolver: (timeLimit?: number) => void;
  /** Show clear assignments dialog */
  onShowClearDialog: () => void;
  /** Show new scenario modal */
  onShowNewScenarioModal: () => void;
  /** Show scenario management modal */
  onShowScenarioManagement: () => void;
  /** Select a scenario (null for production) */
  onSelectScenario: (scenarioId: string | null) => void;
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
  onShowClearDialog,
  onShowNewScenarioModal,
  onShowScenarioManagement,
  onSelectScenario,
}: SessionHeaderProps) {
  const selectableSessions = sortSessionsByDate(filterSelectableSessions(allSessions));
  const showPulse = (isSolving || isApplyingResults) && capturedScenarioId !== null;

  // Handle scenario dropdown change - includes "new" option
  const handleScenarioChange = (value: string) => {
    if (value === 'new') {
      onShowNewScenarioModal();
    } else {
      onSelectScenario(value === 'production' ? null : value);
    }
  };

  return (
    <div className="mb-4">
      <div className="card-lodge p-3 sm:p-4">
        {/* Single row: session + mode/scenario on left, action buttons pushed right */}
        <div className="flex items-center gap-3">
          {/* Session selector */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Tent className="h-5 w-5 sm:h-6 sm:w-6 text-primary flex-shrink-0" />
            <Listbox
              value={session.cm_id.toString()}
              onChange={(value) => onSessionChange(value)}
            >
              <div className="relative">
                <ListboxButton className="flex items-center gap-1 text-xl sm:text-2xl font-display font-bold bg-transparent cursor-pointer hover:text-primary transition-colors focus:outline-none">
                  {getFormattedSessionName(session, allSessions)}
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
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

          {/* Mode + Scenario controls */}
          <ModeBadge
            isProductionMode={isProductionMode}
            scenarioName={currentScenario?.name}
          />

          <div className="relative">
            <Listbox
              value={currentScenario?.id || 'production'}
              onChange={handleScenarioChange}
              disabled={scenarioLoading || isSolving || isApplyingResults}
            >
              <ListboxButton className="listbox-button-compact min-w-[130px]">
                <span className="flex-1 text-left truncate">
                  {currentScenario?.name || 'CampMinder'}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
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
                  className="listbox-option py-1.5 text-primary font-medium border-t border-border mt-1 pt-2"
                >
                  + New Scenario
                </ListboxOption>
              </ListboxOptions>
            </Listbox>
            {showPulse && (
              <div className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 bg-primary rounded-full animate-pulse" />
            )}
          </div>

          <button
            onClick={onShowScenarioManagement}
            className="btn-ghost p-1.5 text-muted-foreground hover:text-foreground"
            title="Manage Scenarios"
          >
            <Settings className="h-4 w-4" />
          </button>

          {scenarios.length > 0 && (
            <Link
              to={`/summer/session/${sessionNameToUrl(session.name)}/compare`}
              className="btn-ghost p-1.5 text-muted-foreground hover:text-foreground"
              title="Compare scenarios"
            >
              <GitCompare className="w-4 h-4" />
            </Link>
          )}

          {/* Right: Action buttons - ml-auto pushes to far right */}
          <div className="flex items-center gap-2 ml-auto">
            {!isProductionMode && session && (
              <PreValidateRequestsButton
                sessionCmId={session.cm_id}
                year={currentYear}
                className="px-3 py-2 text-sm"
              />
            )}
            {!isProductionMode && (
              <OptimizeBunksButton
                isSolving={isSolving}
                isApplyingResults={isApplyingResults}
                onRunSolver={onRunSolver}
              />
            )}
            {session && (
              <ValidateBunkingButton
                sessionCmId={session.cm_id}
                year={currentYear}
                className="px-3 py-2 text-sm"
              />
            )}
            {!isProductionMode && currentScenario && (
              <button
                onClick={onShowClearDialog}
                className="btn-secondary px-3 py-2 text-sm flex items-center gap-1.5"
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
  );
}
