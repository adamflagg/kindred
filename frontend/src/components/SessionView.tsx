import { useState, useEffect, useCallback, Activity } from 'react';
import { useParams, useNavigate } from 'react-router';
import { toast } from 'react-hot-toast';
import type { Camper } from '../types/app-types';
import { socialGraphService } from '../services/socialGraph';
import { useAuth } from '../contexts/AuthContext';
import { useYear } from '../hooks/useCurrentYear';
import { useScenario } from '../hooks/useScenario';
import { graphCacheService } from '../services/GraphCacheService';
import { useApiWithAuth } from '../hooks/useApiWithAuth';
import {
  useSessionHierarchy,
  useSolverOperations,
  useCamperMovement,
  useSessionBunks,
  useSessionCampers,
  useBunkRequestsCount,
} from '../hooks/session';
import SolverProgressModal, { useSolverProgress } from './SolverProgressModal';
import { isValidTab, type ValidTab, sessionNameToUrl } from '../utils/sessionUtils';
import BunkingBoardByArea from './BunkingBoardByArea';
import RequestReviewPanel from './RequestReviewPanel';
import CampersView from './CampersView';
import FriendGroupsView from './FriendGroupsView';
import NewScenarioModal from './NewScenarioModal';
import ScenarioManagementModal from './ScenarioManagementModal';
import ProductionSaveConfirmDialog from './ProductionSaveConfirmDialog';
import { SessionHeader, AreaFilterBar, SessionTabs, ClearAssignmentsDialog, type BunkArea } from './session';
import { useSolverConfigValue } from '../hooks/useSolverConfig';
import { BunkRequestProvider } from '../providers/BunkRequestProvider';
import { CamperHistoryProvider } from '../providers/CamperHistoryProvider';
import { useLockGroupContext } from '../contexts/LockGroupContext';

export default function SessionView() {
  const { sessionId, '*': tabPath } = useParams<{ sessionId: string; '*': string }>(); // sessionId can be friendly URL or numeric
  const navigate = useNavigate();
  const currentYear = useYear();
  const { isLoading: authLoading } = useAuth();
  const { fetchWithAuth } = useApiWithAuth();
  const {
    currentScenario,
    isProductionMode,
    scenarios,
    loadScenarios,
    selectScenario,
    loading: scenarioLoading
  } = useScenario();
  const { setSessionPbId: setLockGroupSessionPbId } = useLockGroupContext();

  // Extract tab from URL path
  const activeTab = (isValidTab(tabPath || '') ? tabPath : 'bunks') as ValidTab;

  // Session hierarchy hook - handles session lookups, sub-sessions, AG sessions
  const {
    session,
    allSessionsForLookup,
    subSessions,
    agSessions,
    showAgArea,
    selectedSession,
  } = useSessionHierarchy({ sessionId, tabPath: tabPath ?? '' });

  // UI state
  const [showNewScenarioModal, setShowNewScenarioModal] = useState(false);
  const [showScenarioManagementModal, setShowScenarioManagementModal] = useState(false);
  const [showProductionSaveDialog, setShowProductionSaveDialog] = useState(false);
  const [pendingMove, setPendingMove] = useState<{ camperId: string; bunkId: string | null } | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [selectedBunkArea, setSelectedBunkArea] = useState<BunkArea>('all');

  // Fetch solver config values
  const autoApplyEnabled = useSolverConfigValue('solver.auto_apply_enabled', true) as boolean;
  const autoApplyTimeout = useSolverConfigValue('solver.auto_apply_timeout', 0) as number;
  const defaultBunkCapacity = useSolverConfigValue('constraint.cabin_capacity.standard', 12) as number;

  // Solver progress modal
  const solverProgress = useSolverProgress();

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
  });

  // Wrapped handleRunSolver that coordinates with progress modal
  const handleRunSolver = useCallback(async (timeLimit: number = 60) => {
    // Start progress modal
    solverProgress.start(timeLimit, currentScenario?.name);

    // Run the solver (this handles its own toasts internally)
    const result = await runSolverInternal(timeLimit);

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
      });
    } else {
      // Show error in modal
      solverProgress.fail(result.errorMessage || 'Optimization failed');
    }
  }, [solverProgress, runSolverInternal, currentScenario?.name]);

  // Reset selected area if All-Gender is selected but no longer available
  useEffect(() => {
    if (selectedBunkArea === 'all-gender' && !showAgArea) {
      setSelectedBunkArea('all');
    }
  }, [selectedBunkArea, showAgArea]);

  // Load scenarios when session changes
  useEffect(() => {
    if (session?.cm_id) {
      loadScenarios(session.cm_id);
    }
  }, [session?.cm_id, loadScenarios]);

  // Set lock group session PB ID when session changes
  useEffect(() => {
    if (session?.id) {
      setLockGroupSessionPbId(session.id);
    }
  }, [session?.id, setLockGroupSessionPbId]);

  // Data fetching hooks (extracted from SessionView)
  const { data: bunks = [] } = useSessionBunks({
    selectedSession,
    sessionCmId: session?.cm_id,
    agSessions,
    currentYear,
  });

  const { data: campers = [] } = useSessionCampers({
    selectedSession,
    agSessions,
    currentYear,
    scenarioId: currentScenario?.id,
  });

  const { data: bunkRequestsCount = 0 } = useBunkRequestsCount({
    selectedSession,
    sessionCmId: session?.cm_id,
    currentYear,
    subSessions,
    agSessions,
  });
  

  // Camper movement hook
  const { moveCamper } = useCamperMovement({
    selectedSession: selectedSession || '',
    currentYear,
    currentScenario,
    fetchWithAuth,
    onPendingMoveCleared: () => setPendingMove(null),
  });



  // Pre-warm graph cache on session load (only if session has bunk requests)
  useEffect(() => {
    // Wait for auth to complete before fetching (prevents race condition)
    if (authLoading) return;
    if (!selectedSession || bunkRequestsCount === 0) return;

    const sessionCmId = parseInt(selectedSession, 10);
    if (!isNaN(sessionCmId)) {
      // Pre-fetch the session graph in the background
      graphCacheService.getSessionGraph(sessionCmId, async () => {
        return socialGraphService.getSessionSocialGraph(sessionCmId, currentYear, fetchWithAuth);
      }).catch(error => {
        // Only log actual errors, not empty graphs
        if (!error.message?.includes('no social graph data')) {
          console.error('Failed to pre-warm graph cache:', error);
        }
      });
    }
  }, [authLoading, selectedSession, currentYear, bunkRequestsCount, fetchWithAuth]);

  // Handle clear dialog close after successful clear
  const onClearAssignments = async () => {
    await handleClearAssignments();
    setShowClearDialog(false);
  };

  if (!sessionId) {
    return <div>Invalid session URL</div>;
  }
  
  if (allSessionsForLookup.length === 0) {
    return <div>Loading sessions...</div>;
  }
  
  if (!session) {
    return <div>Session not found</div>;
  }

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
          const selectedSess = allSessionsForLookup.find(s => s.cm_id.toString() === sessionCmId);
          if (selectedSess) {
            navigate(`/summer/session/${sessionNameToUrl(selectedSess.name)}`);
          }
        }}
        onRunSolver={handleRunSolver}
        onShowClearDialog={() => setShowClearDialog(true)}
        onShowNewScenarioModal={() => setShowNewScenarioModal(true)}
        onShowScenarioManagement={() => setShowScenarioManagementModal(true)}
        onSelectScenario={selectScenario}
      />

      {/* Unified Navigation Region - Tabs + Area Filter */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
        <SessionTabs
          sessionId={sessionId}
          activeTab={activeTab}
          camperCount={campers.length}
          requestCount={bunkRequestsCount}
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
            agSessionCmIds={agSessions.map(s => s.cm_id)}
          />
        )}
      </div>

      {/* Content - Using Activity to preserve state across tab switches */}
      <div className="pt-4">
        {/* Bunks Tab - preserves drag state and complex board state */}
        <Activity mode={activeTab === 'bunks' ? 'visible' : 'hidden'}>
          <BunkRequestProvider sessionCmId={session?.cm_id || 0}>
            <CamperHistoryProvider
              sessionCmId={session?.cm_id || 0}
              camperPersonIds={campers.map(c => c.person_cm_id)}
            >
              <BunkingBoardByArea
                sessionId={sessionId || ''}
                sessionCmId={session?.cm_id || 0}
                bunks={bunks}
                campers={campers}
                selectedArea={selectedBunkArea}
                onAreaChange={setSelectedBunkArea}
                onCamperMove={async (camperId, bunkId) => {
                  if (isProductionMode) {
                    setPendingMove({ camperId, bunkId });
                    setShowProductionSaveDialog(true);
                  } else {
                    await moveCamper(camperId, bunkId);
                  }
                }}
                isProductionMode={isProductionMode}
                defaultCapacity={defaultBunkCapacity}
              />
            </CamperHistoryProvider>
          </BunkRequestProvider>
        </Activity>

        {/* Campers Tab - preserves filter/sort state */}
        <Activity mode={activeTab === 'campers' ? 'visible' : 'hidden'}>
          <CampersView
            sessionId={selectedSession}
            session={session}
            campers={campers as Camper[]}
            bunks={bunks}
          />
        </Activity>

        {/* Requests Tab - preserves selection/review state */}
        <Activity mode={activeTab === 'requests' ? 'visible' : 'hidden'}>
          {selectedSession && !isNaN(parseInt(selectedSession, 10)) ? (
            <RequestReviewPanel
              sessionId={parseInt(selectedSession, 10)}
              relatedSessionIds={
                selectedSession === session?.cm_id.toString()
                  ? [
                      ...subSessions.map(s => s.cm_id),
                      ...agSessions.map(s => s.cm_id)
                    ]
                  : []
              }
              year={currentYear}
            />
          ) : (
            <div className="text-center text-muted-foreground">Loading session data...</div>
          )}
        </Activity>

        {/* Friends Tab - preserves group selection state */}
        <Activity mode={activeTab === 'friends' ? 'visible' : 'hidden'}>
          {selectedSession && !isNaN(parseInt(selectedSession, 10)) ? (
            <FriendGroupsView
              sessionCmId={parseInt(selectedSession, 10)}
            />
          ) : (
            <div className="text-center text-muted-foreground">Loading session data...</div>
          )}
        </Activity>
      </div>

      {/* New Scenario Modal */}
      {showNewScenarioModal && session && (
        <NewScenarioModal
          sessionId={session.cm_id}
          onClose={() => setShowNewScenarioModal(false)}
          onScenarioCreated={(scenario) => {
            setShowNewScenarioModal(false);
            toast.success(`Created scenario: ${scenario.name}`);
          }}
        />
      )}
      
      {/* Scenario Management Modal */}
      {showScenarioManagementModal && session && (
        <ScenarioManagementModal
          sessionId={session.cm_id}
          onClose={() => setShowScenarioManagementModal(false)}
        />
      )}
      
      {/* Production Save Confirmation Dialog */}
      <ProductionSaveConfirmDialog
        isOpen={showProductionSaveDialog}
        onClose={() => {
          setShowProductionSaveDialog(false);
          setPendingMove(null);
        }}
        onConfirm={async () => {
          if (pendingMove) {
            await moveCamper(pendingMove.camperId, pendingMove.bunkId);
          }
          setShowProductionSaveDialog(false);
        }}
        onCreateScenario={() => {
          setShowNewScenarioModal(true);
        }}
      />
      
      {/* Clear Assignments Confirmation Dialog */}
      <ClearAssignmentsDialog
        isOpen={showClearDialog}
        onClose={() => setShowClearDialog(false)}
        onConfirm={onClearAssignments}
      />

      {/* Solver Progress Modal */}
      <SolverProgressModal
        state={solverProgress.state}
        onClose={solverProgress.close}
      />
    </div>
  );
}