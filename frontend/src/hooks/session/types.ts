/**
 * Session hooks shared types
 */

import type { Session } from '../../types/app-types';

/**
 * Session hierarchy result - contains main session with related sub/AG sessions
 */
export interface SessionHierarchy {
  /** The main session currently being viewed */
  session: Session | null;
  /** All sessions for the current year (for lookups) */
  allSessions: Session[];
  /** Embedded sub-sessions (e.g., 2a, 2b, 3a) */
  subSessions: Session[];
  /** All-Gender sessions linked to this parent */
  agSessions: Session[];
  /** Whether currently viewing a main session (not embedded) */
  isViewingMainSession: boolean;
  /** Bunk plan counts per session (for filtering empty sessions) */
  bunkPlanCounts: Record<string, number>;
  /** Whether bunk plan counts have loaded */
  bunkPlanCountsLoaded: boolean;
}

/**
 * Solver operation result - contains solver run state and handlers
 */
export interface SolverOperations {
  /** Whether solver is currently running */
  isSolving: boolean;
  /** Whether solver results are being applied */
  isApplyingResults: boolean;
  /** Captured scenario ID during solver run */
  capturedScenarioId: string | null;
  /** Run the solver for the current session */
  handleRunSolver: () => Promise<void>;
  /** Clear all assignments in the current scenario */
  handleClearAssignments: () => Promise<void>;
}

/**
 * Camper movement result - contains drag-drop mutation and state
 */
export interface CamperMovement {
  /** Move camper to a new bunk (or null to unassign) */
  moveCamper: (camperId: string, bunkId: string | null) => Promise<void>;
  /** Whether a move is in progress */
  isMoving: boolean;
  /** Pending move awaiting production confirmation */
  pendingMove: { camperId: string; bunkId: string | null } | null;
  /** Set pending move (for production confirmation dialog) */
  setPendingMove: (move: { camperId: string; bunkId: string | null } | null) => void;
  /** Execute the pending move */
  executePendingMove: () => Promise<void>;
}
