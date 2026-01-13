/**
 * SolverProgressModal - Beautiful solver progress and results display
 *
 * Design: "Campfire Meditation" - warm, calming progress visualization
 * that shows meaningful feedback during the optimization process.
 */

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Flame,
  CheckCircle2,
  XCircle,
  TreePine,
  Users,
  ArrowRight,
  Sparkles,
  Clock,
  Target,
  AlertTriangle,
  X,
  Minimize2,
} from 'lucide-react';

// Solver progress phases
export type SolverPhase =
  | 'starting'
  | 'loading'
  | 'searching'
  | 'optimizing'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'applying';

// Stats from solver results
export interface SolverResultStats {
  satisfied_request_count?: number | undefined;
  satisfied_constraints?: number | undefined;
  total_requests?: number | undefined;
  total_constraints?: number | undefined;
  assignments_changed?: number | undefined;
  new_assignments?: number | undefined;
  duration_seconds?: number | undefined;
  request_validation?: {
    impossible_requests: number;
    affected_campers: number;
  } | undefined;
}

export interface SolverProgressState {
  isOpen: boolean;
  phase: SolverPhase;
  elapsedSeconds: number;
  timeLimit: number;
  scenarioName?: string | undefined;
  stats?: SolverResultStats | undefined;
  errorMessage?: string | undefined;
}

interface SolverProgressModalProps {
  state: SolverProgressState;
  onClose: () => void;
  onMinimize?: () => void;
}

// Phase configurations with visual styling
const phaseConfig: Record<
  SolverPhase,
  {
    label: string;
    sublabel: string;
    icon: React.ElementType;
    color: string;
    bgGlow: string;
  }
> = {
  starting: {
    label: 'Starting Up',
    sublabel: 'Preparing optimization engine...',
    icon: Sparkles,
    color: 'text-amber-500',
    bgGlow: 'from-amber-500/10',
  },
  loading: {
    label: 'Loading Data',
    sublabel: 'Gathering camper information...',
    icon: Users,
    color: 'text-blue-500',
    bgGlow: 'from-blue-500/10',
  },
  searching: {
    label: 'Searching',
    sublabel: 'Finding valid bunk arrangements...',
    icon: Target,
    color: 'text-amber-500',
    bgGlow: 'from-amber-500/15',
  },
  optimizing: {
    label: 'Optimizing',
    sublabel: 'Maximizing request satisfaction...',
    icon: Flame,
    color: 'text-orange-500',
    bgGlow: 'from-orange-500/20',
  },
  finalizing: {
    label: 'Finalizing',
    sublabel: 'Polishing the solution...',
    icon: TreePine,
    color: 'text-green-500',
    bgGlow: 'from-green-500/15',
  },
  completed: {
    label: 'Complete',
    sublabel: 'Optimization finished!',
    icon: CheckCircle2,
    color: 'text-green-500',
    bgGlow: 'from-green-500/20',
  },
  failed: {
    label: 'Failed',
    sublabel: 'Unable to find a solution',
    icon: XCircle,
    color: 'text-red-500',
    bgGlow: 'from-red-500/15',
  },
  applying: {
    label: 'Applying',
    sublabel: 'Saving assignments...',
    icon: ArrowRight,
    color: 'text-blue-500',
    bgGlow: 'from-blue-500/15',
  },
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatPercentage(value: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

// Animated ember particles for the background
function EmberParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-amber-400/60 animate-float"
          style={{
            left: `${15 + i * 15}%`,
            animationDelay: `${i * 0.5}s`,
            animationDuration: `${3 + (i % 3)}s`,
          }}
        />
      ))}
    </div>
  );
}

// Animated progress ring
function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 8,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/30"
      />
      {/* Progress ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="url(#progressGradient)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-500 ease-out"
      />
      {/* Gradient definition */}
      <defs>
        <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgb(251 191 36)" /> {/* amber-400 */}
          <stop offset="50%" stopColor="rgb(249 115 22)" /> {/* orange-500 */}
          <stop offset="100%" stopColor="rgb(34 197 94)" /> {/* green-500 */}
        </linearGradient>
      </defs>
    </svg>
  );
}

// Stats card for results display
function StatCard({
  icon: Icon,
  label,
  value,
  subvalue,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subvalue?: string | undefined;
  highlight?: boolean | undefined;
}) {
  return (
    <div
      className={`
      flex items-center gap-3 p-3 rounded-xl
      ${highlight ? 'bg-green-50 dark:bg-green-950/30 ring-1 ring-green-200 dark:ring-green-800' : 'bg-muted/50'}
    `}
    >
      <div
        className={`
        flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center
        ${highlight ? 'bg-green-100 dark:bg-green-900/50' : 'bg-background'}
      `}
      >
        <Icon
          className={`h-5 w-5 ${highlight ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-lg font-semibold ${highlight ? 'text-green-700 dark:text-green-300' : ''}`}>
          {value}
        </p>
        {subvalue && <p className="text-xs text-muted-foreground">{subvalue}</p>}
      </div>
    </div>
  );
}

export default function SolverProgressModal({ state, onClose, onMinimize }: SolverProgressModalProps) {
  const { isOpen, phase, elapsedSeconds, timeLimit, scenarioName, stats, errorMessage } = state;

  const config = phaseConfig[phase];
  const Icon = config.icon;
  const isInProgress = ['starting', 'loading', 'searching', 'optimizing', 'finalizing', 'applying'].includes(
    phase
  );
  const isComplete = phase === 'completed';
  const isFailed = phase === 'failed';

  // Calculate progress percentage based on elapsed time and phase
  const progressPercent = isInProgress
    ? Math.min(95, (elapsedSeconds / timeLimit) * 100)
    : isComplete
      ? 100
      : 0;

  // Calculate estimated time remaining
  const estimatedRemaining = Math.max(0, timeLimit - elapsedSeconds);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={isInProgress ? undefined : onClose}
      />

      {/* Modal */}
      <div
        className={`
        relative w-full max-w-md mx-4
        bg-card rounded-2xl shadow-2xl
        border-2 border-border
        overflow-hidden
        animate-in fade-in slide-in-from-bottom-4 duration-300
      `}
      >
        {/* Ambient glow background */}
        <div
          className={`
          absolute inset-0 bg-gradient-to-b ${config.bgGlow} to-transparent
          opacity-50 pointer-events-none
        `}
        />

        {/* Ember particles for in-progress states */}
        {isInProgress && <EmberParticles />}

        {/* Header */}
        <div className="relative px-6 pt-5 pb-4 flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">{config.label}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{config.sublabel}</p>
            {scenarioName && (
              <p className="text-xs text-primary font-medium mt-1">Scenario: {scenarioName}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onMinimize && isInProgress && (
              <button
                onClick={onMinimize}
                className="p-1.5 rounded-lg hover:bg-muted/80 transition-colors"
                aria-label="Minimize"
              >
                <Minimize2 className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
            {!isInProgress && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-muted/80 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="relative px-6 pb-6">
          {/* Progress visualization for in-progress states */}
          {isInProgress && (
            <div className="flex flex-col items-center py-6">
              {/* Progress ring with icon */}
              <div className="relative">
                <ProgressRing progress={progressPercent} size={140} strokeWidth={10} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className={`
                    w-16 h-16 rounded-full flex items-center justify-center
                    bg-gradient-to-br from-amber-100 to-orange-100
                    dark:from-amber-900/50 dark:to-orange-900/50
                    ${phase === 'optimizing' ? 'animate-pulse' : ''}
                  `}
                  >
                    <Icon className={`h-8 w-8 ${config.color}`} />
                  </div>
                </div>
              </div>

              {/* Time display */}
              <div className="mt-6 text-center">
                <div className="flex items-center justify-center gap-2 text-2xl font-mono font-bold">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <span>{formatTime(elapsedSeconds)}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {estimatedRemaining > 0
                    ? `up to ${formatTime(estimatedRemaining)} remaining`
                    : 'Wrapping up...'}
                </p>
              </div>

              {/* Phase indicator dots */}
              <div className="flex items-center gap-2 mt-6">
                {['loading', 'searching', 'optimizing', 'finalizing'].map((p, i) => {
                  const phases = ['loading', 'searching', 'optimizing', 'finalizing'];
                  const currentIndex = phases.indexOf(phase);
                  const isActive = i === currentIndex;
                  const isPast = i < currentIndex;

                  return (
                    <div
                      key={p}
                      className={`
                        h-2 rounded-full transition-all duration-300
                        ${isActive ? 'w-8 bg-amber-500' : 'w-2'}
                        ${isPast ? 'bg-green-500' : ''}
                        ${!isActive && !isPast ? 'bg-muted' : ''}
                      `}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Results display for completed state */}
          {isComplete && stats && (
            <div className="space-y-4 py-2">
              {/* Success header */}
              <div className="flex items-center justify-center gap-3 py-4">
                <div
                  className="
                  w-16 h-16 rounded-full flex items-center justify-center
                  bg-gradient-to-br from-green-100 to-emerald-100
                  dark:from-green-900/50 dark:to-emerald-900/50
                  ring-4 ring-green-200 dark:ring-green-800
                "
                >
                  <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  icon={Target}
                  label="Requests Satisfied"
                  value={`${stats.satisfied_request_count ?? stats.satisfied_constraints ?? 0}/${stats.total_requests ?? stats.total_constraints ?? 0}`}
                  subvalue={formatPercentage(
                    stats.satisfied_request_count ?? stats.satisfied_constraints ?? 0,
                    stats.total_requests ?? stats.total_constraints ?? 0
                  )}
                  highlight
                />
                <StatCard
                  icon={Clock}
                  label="Duration"
                  value={formatTime(stats.duration_seconds ?? elapsedSeconds)}
                />
                {stats.assignments_changed !== undefined && (
                  <StatCard
                    icon={ArrowRight}
                    label="Campers Moved"
                    value={stats.assignments_changed}
                    subvalue={stats.assignments_changed === 0 ? 'No changes needed' : undefined}
                  />
                )}
                {stats.new_assignments !== undefined && (
                  <StatCard icon={Users} label="New Assignments" value={stats.new_assignments} />
                )}
              </div>

              {/* Validation warnings */}
              {stats.request_validation && stats.request_validation.impossible_requests > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-800">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      {stats.request_validation.impossible_requests} requests skipped
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      Campers not enrolled in this session
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error display for failed state */}
          {isFailed && (
            <div className="py-4">
              <div className="flex items-center justify-center gap-3 py-4">
                <div
                  className="
                  w-16 h-16 rounded-full flex items-center justify-center
                  bg-gradient-to-br from-red-100 to-rose-100
                  dark:from-red-900/50 dark:to-rose-900/50
                  ring-4 ring-red-200 dark:ring-red-800
                "
                >
                  <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
              </div>

              <div className="mt-4 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 ring-1 ring-red-200 dark:ring-red-800">
                <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                  Try using &quot;Pre-Check&quot; to identify unsatisfiable constraints.
                </p>
              </div>
            </div>
          )}

          {/* Action button */}
          {!isInProgress && (
            <button
              onClick={onClose}
              className="
                w-full mt-4 py-3 px-4
                btn-primary
                font-semibold
              "
            >
              {isComplete ? 'Done' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Hook for managing solver progress state
export function useSolverProgress() {
  const [state, setState] = useState<SolverProgressState>({
    isOpen: false,
    phase: 'starting',
    elapsedSeconds: 0,
    timeLimit: 60,
  });

  const [startTime, setStartTime] = useState<number | null>(null);

  // Timer effect
  useEffect(() => {
    if (!startTime || !state.isOpen || state.phase === 'completed' || state.phase === 'failed') {
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setState((prev) => ({
        ...prev,
        elapsedSeconds: elapsed,
        // Auto-advance phases based on elapsed time
        phase:
          prev.phase === 'starting' && elapsed >= 1
            ? 'loading'
            : prev.phase === 'loading' && elapsed >= 3
              ? 'searching'
              : prev.phase === 'searching' && elapsed >= Math.max(5, prev.timeLimit * 0.2)
                ? 'optimizing'
                : prev.phase === 'optimizing' && elapsed >= prev.timeLimit * 0.9
                  ? 'finalizing'
                  : prev.phase,
      }));
    }, 100);

    return () => clearInterval(interval);
  }, [startTime, state.isOpen, state.phase]);

  const start = useCallback((timeLimit: number, scenarioName?: string) => {
    setStartTime(Date.now());
    setState({
      isOpen: true,
      phase: 'starting',
      elapsedSeconds: 0,
      timeLimit,
      scenarioName,
    });
  }, []);

  const setPhase = useCallback((phase: SolverPhase) => {
    setState((prev) => ({ ...prev, phase }));
  }, []);

  const complete = useCallback((stats: SolverResultStats) => {
    setState((prev) => ({
      ...prev,
      phase: 'completed',
      stats: {
        ...stats,
        duration_seconds: prev.elapsedSeconds,
      },
    }));
    setStartTime(null);
  }, []);

  const fail = useCallback((errorMessage: string) => {
    setState((prev) => ({
      ...prev,
      phase: 'failed',
      errorMessage,
    }));
    setStartTime(null);
  }, []);

  const startApplying = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'applying' }));
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
    setStartTime(null);
  }, []);

  return {
    state,
    start,
    setPhase,
    complete,
    fail,
    startApplying,
    close,
  };
}
