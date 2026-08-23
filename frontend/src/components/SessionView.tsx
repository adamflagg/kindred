import { useState, useEffect, useCallback, useMemo, Activity } from 'react'
import { useParams, useNavigate } from 'react-router'
import { toast } from 'react-hot-toast'
import { socialGraphService } from '../services/socialGraph'
import { useAuth } from '../contexts/AuthContext'
import { useYear } from '../hooks/useCurrentYear'
import { useScenario } from '../hooks/useScenario'
import { graphCacheService } from '../services/GraphCacheService'
import { useApiWithAuth } from '../hooks/useApiWithAuth'
import { usePermissions } from '../hooks/usePermissions'
import { Permission } from '../constants/permissions'
import {
  useSessionHierarchy,
  useSolverOperations,
  useCamperMovement,
  useSessionBunks,
  useSessionCampers,
  useBunkRequestsCount,
  useLockedBunks,
  useResetPartialResolveOnSessionChange,
} from '../hooks/session'
import { scopeLockedToBunks } from '../hooks/session/scopeLockedToBunks'
import SolverProgressModal, { useSolverProgress } from './SolverProgressModal'
import SolverDiagnosticsModal from './SolverDiagnosticsModal'
import type { SolverDiagnostics } from '../services/solver'
import { resolveYields, hasReviewableDiagnostics } from '../utils/solverDiagnostics'
import { useRetainedDialog } from '../hooks/useRetainedDialog'
import { isValidTab, type ValidTab, sessionNameToUrl } from '../utils/sessionUtils'
import BunkingBoardByArea from './BunkingBoardByArea'
import RequestReviewPanel from './RequestReviewPanel'
import CampersView from './CampersView'
import FriendGroupsView from './FriendGroupsView'
import NewScenarioModal from './NewScenarioModal'
import ScenarioManagementModal from './ScenarioManagementModal'
import {
  SessionHeader,
  AreaFilterBar,
  SessionTabs,
  ClearAssignmentsDialog,
  type BunkArea,
} from './session'
import { useSolverConfigValue } from '../hooks/useSolverConfig'
import { DEFAULT_BUNK_CAPACITY } from '../utils/capacityConstants'
import { BunkRequestProvider } from '../providers/BunkRequestProvider'
import { CamperHistoryProvider } from '../providers/CamperHistoryProvider'
import { useLockGroupContext } from '../contexts/LockGroupContext'

export default function SessionView() {
  const { sessionId, '*': tabPath } = useParams<{
    sessionId: string
    '*': string
  }>() // sessionId can be friendly URL or numeric
  const navigate = useNavigate()
  const currentYear = useYear()
  const { isLoading: authLoading } = useAuth()
  const { fetchWithAuth } = useApiWithAuth()
  const {
    currentScenario,
    isProductionMode,
    scenarios,
    loadScenarios,
    selectScenario,
    isLoading: scenarioIsLoading,
    isMutating: scenarioIsMutating,
  } = useScenario()
  const scenarioLoading = scenarioIsLoading || scenarioIsMutating
  const { setSessionPbId: setLockGroupSessionPbId } = useLockGroupContext()
  const { hasPermission } = usePermissions()
  const canManage = hasPermission(Permission.BUNKING_MANAGE)

  // Extract tab from URL path
  const activeTab = (isValidTab(tabPath ?? '') ? tabPath : 'bunks') as ValidTab

  // Redirect non-manage users away from the requests tab
  useEffect(() => {
    if (!canManage && activeTab === 'requests' && sessionId) {
      void navigate(`/summer/session/${sessionId}/bunks`, { replace: true })
    }
  }, [canManage, activeTab, sessionId, navigate])

  // Session hierarchy hook - handles session lookups, sub-sessions, AG sessions
  const { session, allSessionsForLookup, subSessions, agSessions, showAgArea, selectedSession } =
    useSessionHierarchy({ sessionId, tabPath: tabPath ?? '' })

  // UI state
  const [showNewScenarioModal, setShowNewScenarioModal] = useState(false)
  const [showScenarioManagementModal, setShowScenarioManagementModal] = useState(false)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [selectedBunkArea, setSelectedBunkArea] = useState<BunkArea>('all')

  // Fetch solver config values
  const autoApplyEnabled = useSolverConfigValue('solver.auto_apply_enabled', true) as boolean
  const autoApplyTimeout = useSolverConfigValue('solver.auto_apply_timeout', 0) as number
  // Hardcoded constant (Phase 2 cabin-capacity cleanup); previously read
  // `constraint.cabin_capacity.standard` from the config table.
  const defaultBunkCapacity = DEFAULT_BUNK_CAPACITY

  // #1638 — diagnostics modal state, on the shared retained-snapshot hook
  // (kindred#2541). The payload has to outlive the close for Modal's 150ms
  // exit fade to have anything to paint; `close()` cannot drop it and
  // `afterLeave` releases it once the fade completes. No `resetWhen`: the
  // payload is a solver RESULT, not a query the parent can lose.
  //
  // DESTRUCTURED, unlike the other three sites, because this one feeds a
  // `useCallback` dep list: the hook's returned container is a fresh object
  // each render, and `react-hooks/exhaustive-deps` demands the whole receiver
  // when a method is CALLED off it — so `diagnosticsDialog.open` in the deps
  // below would have had to become `diagnosticsDialog`, rebuilding `runSolver`
  // on every open and close. The members themselves are stable.
  const {
    data: diagnostics,
    isOpen: diagnosticsOpen,
    open: openDiagnostics,
    close: closeDiagnostics,
    afterLeave: releaseDiagnostics,
  } = useRetainedDialog<SolverDiagnostics>()

  // Solver progress modal
  const solverProgress = useSolverProgress()

  // Respect locks toggle (localStorage-backed)
  const [respectLocks, setRespectLocks] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('solver-respect-locks') !== 'false'
  })

  const handleRespectLocksChange = (value: boolean) => {
    setRespectLocks(value)
    localStorage.setItem('solver-respect-locks', String(value))
  }

  // Ephemeral cabin-lock state for partial re-solve (#1609).
  const { lockedBunkCmIds, toggleBunkLock, lockAll, unlockAll } = useLockedBunks()

  // Data fetching hooks — campers must be available before handleRunSolver
  // so camperNameById (which depends on campers) can be used in the callback.
  const { data: bunks = [] } = useSessionBunks({
    selectedSession,
    sessionCmId: session?.cm_id,
    agSessions,
    currentYear,
  })

  // Filtered locked set — only ids that exist in the current session's bunk
  // list. Stale ids from a previously-viewed session (no remount → raw set
  // survives) are silently dropped here so the solver always runs in full mode
  // when switching sessions (#1609 fix #2). Also ensures lock/unlock counts
  // match the visible bunk set under area filtering (#1609 fix #6).
  // NOTE: per-card lock UI (isLocked, badges) still reads the raw set so
  // individual card states are unaffected.
  const filteredLockedBunkCmIds = useMemo(
    () => scopeLockedToBunks(lockedBunkCmIds, bunks),
    [lockedBunkCmIds, bunks]
  )

  // Derived locked/unlocked counts + array for solver and header display.
  // All three are based on the filtered set so they stay consistent with each
  // other and with what the solver actually receives.
  const lockedBunkCmIdsArray = useMemo(
    () => Array.from(filteredLockedBunkCmIds),
    [filteredLockedBunkCmIds]
  )
  const lockedCount = filteredLockedBunkCmIds.size
  const unlockedCount = useMemo(
    () => bunks.filter((b) => !filteredLockedBunkCmIds.has(b.cm_id)).length,
    [bunks, filteredLockedBunkCmIds]
  )

  // Solver operations hook
  const {
    isSolving,
    isApplyingResults,
    capturedScenarioId,
    handleRunSolver: runSolverInternal,
    handleClearAssignments,
  } = useSolverOperations({
    selectedSession: selectedSession || '',
    currentYear,
    currentScenario,
    scenarios,
    autoApplyEnabled,
    autoApplyTimeout,
    fetchWithAuth,
    respectLocks,
    lockedBunkCmIds: lockedBunkCmIdsArray,
  })

  const { data: campers = [] } = useSessionCampers({
    selectedSession,
    agSessions,
    currentYear,
    scenarioId: currentScenario?.id,
  })

  // #1638 — name map for resolving staff-NBW yield cm_ids to display names.
  const camperNameById = useMemo(
    () =>
      new Map<number, string>(
        campers.map((c) => [c.person_cm_id, `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()])
      ),
    [campers]
  )

  // Wrapped handleRunSolver that coordinates with progress modal
  // respectLocks is already wired through useSolverOperations state, so
  // we accept (but don't use) it from the button to satisfy the type signature
  const handleRunSolver = useCallback(
    async (timeLimit: number = 60, _respectLocks?: boolean) => {
      // Start progress modal
      solverProgress.start(timeLimit, currentScenario?.name)

      // Run the solver (this handles its own toasts internally)
      const result = await runSolverInternal(timeLimit)

      if (result.success) {
        // Show stats in modal
        solverProgress.complete({
          satisfied_request_count: result.stats?.satisfied_request_count,
          satisfied_constraints: result.stats?.satisfied_constraints,
          total_requests: result.stats?.total_requests,
          total_constraints: result.stats?.total_constraints,
          assignments_changed: result.stats?.assignments_changed,
          new_assignments: result.stats?.new_assignments,
          request_validation: result.stats?.request_validation,
          // #1638 — resolve staff-separation yields to names for the advisory.
          staff_separation_yields: resolveYields(
            result.stats?.request_validation?.staff_nbw_yielded,
            camperNameById
          ),
          // #1638 Stream C — resolve parent-NBW yields to names for the rose advisory.
          parent_separation_yields: resolveYields(
            result.stats?.request_validation?.parent_nbw_yielded,
            camperNameById
          ),
        })
      } else if (result.diagnostics && hasReviewableDiagnostics(result.diagnostics)) {
        // #1638 — persistent review surface replaces the transient red box.
        solverProgress.close()
        openDiagnostics(result.diagnostics)
      } else {
        // Generic failure (no diagnostics, e.g. transport/PB error) — keep the
        // existing inline error box.
        solverProgress.fail(result.errorMessage ?? 'Optimization failed')
      }
    },
    [solverProgress, runSolverInternal, currentScenario?.name, camperNameById, openDiagnostics]
  )

  // Reset selected area if All-Gender is selected but no longer available (render-time check)
  if (selectedBunkArea === 'all-gender' && !showAgArea) {
    setSelectedBunkArea('all')
  }

  // Load scenarios when session changes
  useEffect(() => {
    if (session?.cm_id) {
      void loadScenarios(session.cm_id)
    }
  }, [session?.cm_id, loadScenarios])

  // Set lock group session PB ID when session changes
  useEffect(() => {
    if (session?.id) {
      setLockGroupSessionPbId(session.id)
    }
  }, [session?.id, setLockGroupSessionPbId])

  // Locks and overflow are per-session ephemeral state; clear both when the
  // session changes so they never leak into a different session's solve (#1609).
  useResetPartialResolveOnSessionChange(selectedSession, unlockAll)

  // When the user unlocks the last bunk in scope (lockedCount >0 → 0), reset
  // overflow so a partial-re-solve opt-in doesn't silently carry into the
  // next full solve. Toggling overflow at lockedCount=0 still sticks.

  // #1310 — feed in-session campers into RequestReviewPanel as the seed for
  // its personMap. The panel only needs cm_id + first/last name + grade for
  // display, but the prop is typed as PersonsResponse[] (full PB shape) for
  // homogeneity with the fetched persons. The cast bypasses the fact that
  // many PersonsResponse fields are unused by request rows.
  const requestSeedPersons = useMemo(
    () =>
      campers.map((c) => ({
        cm_id: c.person_cm_id,
        first_name: c.first_name ?? '',
        last_name: c.last_name ?? '',
        grade: c.grade,
        year: currentYear,
      })) as unknown as import('../types/pocketbase-types').PersonsResponse[],
    [campers, currentYear]
  )

  const { data: bunkRequestsCount = 0 } = useBunkRequestsCount({
    selectedSession,
    sessionCmId: session?.cm_id,
    currentYear,
    subSessions,
    agSessions,
  })

  // Camper movement hook
  const { moveCamper } = useCamperMovement({
    selectedSession: selectedSession || '',
    currentYear,
    currentScenario,
    fetchWithAuth,
  })

  // Pre-warm graph cache on session load (only if session has bunk requests)
  useEffect(() => {
    // Wait for auth to complete before fetching (prevents race condition)
    if (authLoading) return
    if (!selectedSession || bunkRequestsCount === 0) return

    const sessionCmId = parseInt(selectedSession, 10)
    if (!isNaN(sessionCmId)) {
      // Pre-fetch the session graph in the background
      graphCacheService
        .getSessionGraph(
          sessionCmId,
          async () => {
            return socialGraphService.getSessionSocialGraph(
              sessionCmId,
              currentYear,
              fetchWithAuth,
              currentScenario?.id ?? null
            )
          },
          currentYear,
          currentScenario?.id ?? null
        )
        .catch((error) => {
          // Only log actual errors, not empty graphs
          if (!error.message?.includes('no social graph data')) {
            console.error('Failed to pre-warm graph cache:', error)
          }
        })
    }
  }, [authLoading, selectedSession, currentYear, bunkRequestsCount, fetchWithAuth, currentScenario])

  // Handle clear dialog close after successful clear
  const onClearAssignments = async () => {
    await handleClearAssignments()
    setShowClearDialog(false)
  }

  if (!sessionId) {
    return <div>Invalid session URL</div>
  }

  if (allSessionsForLookup.length === 0) {
    return <div>Loading sessions...</div>
  }

  if (!session) {
    return <div>Session not found</div>
  }

  const selectedSessionCmId = parseInt(selectedSession ?? '', 10)

  return (
    <div>
      {/* Header */}
      <SessionHeader
        session={session}
        allSessions={allSessionsForLookup}
        currentYear={currentYear}
        isProductionMode={isProductionMode}
        currentScenario={currentScenario}
        scenarios={scenarios}
        scenarioLoading={scenarioLoading}
        isSolving={isSolving}
        isApplyingResults={isApplyingResults}
        capturedScenarioId={capturedScenarioId}
        onSessionChange={(sessionCmId) => {
          const selectedSess = allSessionsForLookup.find((s) => s.cm_id.toString() === sessionCmId)
          if (selectedSess) {
            // Preserve the current tab when switching sessions
            void navigate(`/summer/session/${sessionNameToUrl(selectedSess.name)}/${activeTab}`)
          }
        }}
        onRunSolver={handleRunSolver}
        respectLocks={respectLocks}
        onRespectLocksChange={handleRespectLocksChange}
        lockedCount={lockedCount}
        unlockedCount={unlockedCount}
        onShowClearDialog={() => setShowClearDialog(true)}
        onShowNewScenarioModal={() => setShowNewScenarioModal(true)}
        onShowScenarioManagement={() => setShowScenarioManagementModal(true)}
        onSelectScenario={selectScenario}
        canManage={canManage}
      />

      {/* Unified Navigation Region - Tabs + Area Filter */}
      <div className="bg-background/95 sticky top-0 z-10 backdrop-blur-sm">
        <SessionTabs
          sessionId={sessionId}
          activeTab={activeTab}
          camperCount={campers.length}
          requestCount={bunkRequestsCount}
          canManage={canManage}
          sessionCmId={session.cm_id ?? undefined}
          agSessionCmIds={agSessions.map((s) => s.cm_id)}
          sessionName={session.name}
        />

        {/* Contextual Bar - Area filter + Stats (Bunks tab only) */}
        {activeTab === 'bunks' && (
          <AreaFilterBar
            selectedArea={selectedBunkArea}
            onAreaChange={setSelectedBunkArea}
            showAgArea={showAgArea}
            bunks={bunks}
            campers={campers}
            defaultCapacity={defaultBunkCapacity}
            agSessionCmIds={agSessions.map((s) => s.cm_id)}
          />
        )}
      </div>

      {/* Content - Using Activity to preserve state across tab switches */}
      <div className="pt-4">
        {/* Bunks Tab - preserves drag state and complex board state */}
        <Activity mode={activeTab === 'bunks' ? 'visible' : 'hidden'}>
          <BunkRequestProvider sessionCmId={session.cm_id || 0}>
            <CamperHistoryProvider
              sessionCmId={session.cm_id || 0}
              camperPersonIds={campers.map((c) => c.person_cm_id)}
            >
              <BunkingBoardByArea
                sessionId={sessionId || ''}
                sessionCmId={session.cm_id || 0}
                bunks={bunks}
                campers={campers}
                selectedArea={selectedBunkArea}
                onAreaChange={setSelectedBunkArea}
                onCamperMove={async (camperId, bunkId, options) => {
                  await moveCamper(camperId, bunkId, options)
                }}
                isProductionMode={isProductionMode}
                defaultCapacity={defaultBunkCapacity}
                lockedBunkCmIds={lockedBunkCmIds}
                onToggleBunkLock={toggleBunkLock}
                onLockAll={lockAll}
                onUnlockAll={unlockAll}
              />
            </CamperHistoryProvider>
          </BunkRequestProvider>
        </Activity>

        {/* Campers Tab - preserves filter/sort state */}
        <Activity mode={activeTab === 'campers' ? 'visible' : 'hidden'}>
          <CampersView
            sessionId={selectedSession}
            session={session}
            campers={campers}
            bunks={bunks}
          />
        </Activity>

        {/* Requests Tab - only mounted for canManage users; non-manage users are redirected away */}
        {canManage && (
          <Activity mode={activeTab === 'requests' ? 'visible' : 'hidden'}>
            {selectedSession && !isNaN(selectedSessionCmId) ? (
              // #1092 — BunkRequestProvider required: CamperDetailsPanel calls
              // useBunkRequestContext() unconditionally. Use selectedSession (not
              // session.cm_id) to match whichever sub-session is active, same as
              // the Friends tab pattern.
              <BunkRequestProvider sessionCmId={selectedSessionCmId}>
                <RequestReviewPanel
                  sessionId={selectedSessionCmId}
                  // Only AG children bundle into the parent's request review.
                  // Embedded sub-sessions (Session 2a, Taste of Camp 2) are
                  // independent — they share the parent's start or end date
                  // (which is exactly why date-overlap classified them as
                  // embedded), but they're shorter programs with their own
                  // bunking, not full-duration sub-cabins. AG sessions ARE
                  // full-duration sub-cabins of the parent and stay bundled.
                  relatedSessionIds={
                    selectedSession === session.cm_id.toString()
                      ? agSessions.map((s) => s.cm_id)
                      : []
                  }
                  year={currentYear}
                  sessionName={
                    allSessionsForLookup.find((s) => s.cm_id === selectedSessionCmId)?.name
                  }
                  // #1310 — seed the panel's personMap with in-session campers
                  // we already have, so rows show names on first paint without
                  // a second round-trip. The persons fetch still fires for any
                  // requestee that points outside this session.
                  seedPersons={requestSeedPersons}
                />
              </BunkRequestProvider>
            ) : (
              <div className="text-muted-foreground text-center">Loading session data...</div>
            )}
          </Activity>
        )}

        {/* Friends Tab - preserves group selection state */}
        <Activity mode={activeTab === 'friends' ? 'visible' : 'hidden'}>
          {selectedSession && !isNaN(selectedSessionCmId) ? (
            <BunkRequestProvider sessionCmId={selectedSessionCmId}>
              <FriendGroupsView sessionCmId={selectedSessionCmId} />
            </BunkRequestProvider>
          ) : (
            <div className="text-muted-foreground text-center">Loading session data...</div>
          )}
        </Activity>
      </div>

      {/* New Scenario Modal (manage permission required) */}
      {canManage && showNewScenarioModal && (
        <NewScenarioModal
          sessionId={session.cm_id}
          onClose={() => setShowNewScenarioModal(false)}
          onScenarioCreated={(scenario) => {
            setShowNewScenarioModal(false)
            toast.success(`Created scenario: ${scenario.name}`)
          }}
        />
      )}

      {/* Scenario Management Modal (manage permission required) */}
      {canManage && showScenarioManagementModal && (
        <ScenarioManagementModal
          sessionId={session.cm_id}
          onClose={() => setShowScenarioManagementModal(false)}
        />
      )}

      {/* Clear Assignments Confirmation Dialog */}
      <ClearAssignmentsDialog
        isOpen={showClearDialog}
        onClose={() => setShowClearDialog(false)}
        onConfirm={onClearAssignments}
      />

      {/* Solver Progress Modal */}
      <SolverProgressModal state={solverProgress.state} onClose={solverProgress.close} />

      {/* #1638 — Solver Diagnostics Modal (infeasibility review). The
          `diagnostics &&` gate is the retained-snapshot latch
          (kindred#2529, now useRetainedDialog per kindred#2541): null until
          the first reviewable solve, then kept through the close so the
          mounted dialog can play Modal's 150ms exit fade — nulling the
          payload on close would blank and unmount it on the same frame the
          close fires, which is the bug the hook makes unrepresentable
          (`close()` touches the open flag only). `afterLeave` releases it
          once the fade has actually completed, so the panel does not keep
          re-rendering the full report on every render forever after, and
          re-arming the latch is safe: `open()` always sets a fresh payload.
          Pinned by SessionView.diagnostics.guard.test.ts. */}
      {diagnostics && (
        <SolverDiagnosticsModal
          isOpen={diagnosticsOpen}
          onClose={closeDiagnostics}
          afterLeave={releaseDiagnostics}
          diagnostics={diagnostics}
          sessionCmId={session.cm_id}
          year={currentYear}
        />
      )}
    </div>
  )
}
