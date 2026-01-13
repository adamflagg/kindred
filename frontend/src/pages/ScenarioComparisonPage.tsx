import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  GitCompare,
  ArrowLeftRight,
  Users,
  UserCheck,
  Home,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  LayoutGrid,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Percent,
  Table2,
} from 'lucide-react';
import clsx from 'clsx';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import { pb } from '../lib/pocketbase';
import type { SavedScenariosResponse, BunkAssignmentsDraftResponse, BunkAssignmentsResponse, PersonsResponse, BunksResponse, BunkPlansResponse, CampSessionsResponse } from '../types/pocketbase-types';
import { useYear } from '../hooks/useCurrentYear';
import { useAuth } from '../contexts/AuthContext';
import { useApiWithAuth } from '../hooks/useApiWithAuth';
import { queryKeys, userDataOptions, syncDataOptions } from '../utils/queryKeys';
import { formatGradeOrdinal } from '../utils/gradeUtils';
import { findSessionByUrlSegment } from '../utils/sessionUtils';
import { solverService } from '../services/solver';
import type { Session } from '../types/app-types';

// Types for comparison
interface CamperAssignment {
  personId: string;
  personCmId: number;
  name: string;
  grade: number;
  gender: string;
  bunkId: string;
  bunkName: string;
  bunkPlanId: string;
}

interface ComparisonResult {
  moved: Array<{
    camper: CamperAssignment;
    fromBunk: { id: string; name: string };
    toBunk: { id: string; name: string };
  }>;
  newlyAssigned: Array<{
    camper: CamperAssignment;
    toBunk: { id: string; name: string };
  }>;
  newlyUnassigned: Array<{
    camper: CamperAssignment;
    fromBunk: { id: string; name: string };
  }>;
  unchanged: CamperAssignment[];
  metrics: {
    totalCampers: { left: number; right: number };
    movedCount: number;
    newlyAssignedCount: number;
    newlyUnassignedCount: number;
    unchangedCount: number;
    changePercentage: number;
  };
}

interface BunkComparison {
  bunkId: string;
  bunkName: string;
  leftCampers: CamperAssignment[];
  rightCampers: CamperAssignment[];
  movedIn: Array<{ camper: CamperAssignment; fromBunk: string }>;
  movedOut: Array<{ camper: CamperAssignment; toBunk: string }>;
  unchanged: CamperAssignment[];
}

// Validation score types
interface ValidationStatistics {
  total_requests: number;
  satisfied_requests: number;
  request_satisfaction_rate: number;
  explicit_csv_requests: number;
  satisfied_explicit_csv_requests: number;
  explicit_csv_request_satisfaction_rate: number;
  negative_request_violations: number;
  assigned_campers: number;
  unassigned_campers: number;
  isolation_risks: number;
}

interface ValidationResult {
  statistics: ValidationStatistics;
  issues: Array<{ severity: string; type: string; message: string }>;
}

type ViewMode = 'split' | 'changes';
type ChangeFilter = 'all' | 'moved' | 'newly-assigned' | 'newly-unassigned';

export default function ScenarioComparisonPage() {
  const { sessionId: sessionUrlSegment } = useParams<{ sessionId: string }>();
  const currentYear = useYear();
  const { user, isLoading: authLoading } = useAuth();
  const { fetchWithAuth } = useApiWithAuth();

  // State for scenario selection
  const [leftScenarioId, setLeftScenarioId] = useState<string>('production');
  const [rightScenarioId, setRightScenarioId] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>('all');
  const [selectedBunkArea, setSelectedBunkArea] = useState<'all' | 'boys' | 'girls' | 'ag'>('all');

  // Fetch all sessions for the current year to resolve the URL segment
  const { data: allSessions = [] } = useQuery({
    queryKey: queryKeys.sessions(currentYear),
    queryFn: async () => {
      const result = await pb
        .collection('camp_sessions')
        .getFullList<CampSessionsResponse>({
          filter: `year = ${currentYear} && (session_type = "main" || session_type = "embedded")`,
          sort: 'name',
        });
      // Convert to Session type
      return result.map(s => ({
        id: s.id,
        cm_id: s.cm_id,
        name: s.name,
        session_type: s.session_type,
        start_date: s.start_date,
        end_date: s.end_date,
        year: s.year,
        parent_id: s.parent_id,
      })) as Session[];
    },
    ...syncDataOptions,
    enabled: !!user,
  });

  // Resolve session from URL segment
  const session = useMemo(() => {
    if (!sessionUrlSegment || allSessions.length === 0) return null;
    return findSessionByUrlSegment(allSessions, sessionUrlSegment);
  }, [sessionUrlSegment, allSessions]);

  // Get session CM ID for queries
  const sessionCmId = session?.cm_id ?? 0;

  // Fetch saved scenarios for this session
  const { data: scenarios = [] } = useQuery({
    queryKey: queryKeys.savedScenarios(sessionCmId, currentYear),
    queryFn: async () => {
      const result = await pb
        .collection('saved_scenarios')
        .getFullList<SavedScenariosResponse>({
          filter: `session.cm_id = ${sessionCmId} && year = ${currentYear}`,
          sort: '-created',
          expand: 'session',
        });
      return result;
    },
    ...userDataOptions,
    enabled: !!user && sessionCmId > 0,
  });

  // Fetch production assignments (bunk_assignments)
  const { data: productionAssignments = [] } = useQuery({
    queryKey: ['production-assignments', sessionCmId, currentYear],
    queryFn: async () => {
      const result = await pb
        .collection('bunk_assignments')
        .getFullList<BunkAssignmentsResponse<{
          person: PersonsResponse;
          bunk: BunksResponse;
          bunk_plan: BunkPlansResponse;
        }>>({
          filter: `session.cm_id = ${sessionCmId} && year = ${currentYear}`,
          expand: 'person,bunk,bunk_plan',
        });
      return result;
    },
    ...syncDataOptions,
    enabled: !!user && sessionCmId > 0,
  });

  // Fetch draft assignments for selected scenario
  const { data: leftDraftAssignments = [] } = useQuery({
    queryKey: ['draft-assignments', leftScenarioId, sessionCmId, currentYear],
    queryFn: async () => {
      if (leftScenarioId === 'production') return [];
      const result = await pb
        .collection('bunk_assignments_draft')
        .getFullList<BunkAssignmentsDraftResponse<{
          person: PersonsResponse;
          bunk: BunksResponse;
          bunk_plan: BunkPlansResponse;
        }>>({
          filter: `scenario = "${leftScenarioId}" && year = ${currentYear}`,
          expand: 'person,bunk,bunk_plan',
        });
      return result;
    },
    ...userDataOptions,
    enabled: !!user && leftScenarioId !== 'production' && leftScenarioId !== '',
  });

  const { data: rightDraftAssignments = [] } = useQuery({
    queryKey: ['draft-assignments', rightScenarioId, sessionCmId, currentYear],
    queryFn: async () => {
      if (rightScenarioId === 'production') return [];
      const result = await pb
        .collection('bunk_assignments_draft')
        .getFullList<BunkAssignmentsDraftResponse<{
          person: PersonsResponse;
          bunk: BunksResponse;
          bunk_plan: BunkPlansResponse;
        }>>({
          filter: `scenario = "${rightScenarioId}" && year = ${currentYear}`,
          expand: 'person,bunk,bunk_plan',
        });
      return result;
    },
    ...userDataOptions,
    enabled: !!user && rightScenarioId !== 'production' && rightScenarioId !== '',
  });

  // Fetch validation scores for both scenarios
  const isReady = Boolean(leftScenarioId) && Boolean(rightScenarioId) && leftScenarioId !== rightScenarioId;

  const { data: leftValidation } = useQuery<ValidationResult | null>({
    queryKey: ['validation', leftScenarioId, sessionCmId, currentYear],
    queryFn: async (): Promise<ValidationResult | null> => {
      try {
        const scenarioId = leftScenarioId === 'production' ? undefined : leftScenarioId;
        const result = await solverService.validateBunking(
          sessionCmId.toString(),
          currentYear,
          scenarioId,
          fetchWithAuth
        );
        return result as unknown as ValidationResult;
      } catch {
        return null;
      }
    },
    ...userDataOptions,
    enabled: Boolean(user) && sessionCmId > 0 && isReady,
  });

  const { data: rightValidation } = useQuery<ValidationResult | null>({
    queryKey: ['validation', rightScenarioId, sessionCmId, currentYear],
    queryFn: async (): Promise<ValidationResult | null> => {
      try {
        const scenarioId = rightScenarioId === 'production' ? undefined : rightScenarioId;
        const result = await solverService.validateBunking(
          sessionCmId.toString(),
          currentYear,
          scenarioId,
          fetchWithAuth
        );
        return result as unknown as ValidationResult;
      } catch {
        return null;
      }
    },
    ...userDataOptions,
    enabled: Boolean(user) && sessionCmId > 0 && isReady,
  });

  // Type for expanded assignment
  interface ExpandedAssignment {
    expand?: {
      person?: PersonsResponse;
      bunk?: BunksResponse;
      bunk_plan?: BunkPlansResponse;
    };
    bunk_plan?: string;
  }

  // Transform assignments to unified format (stable callback since it's a pure function)
  const normalizeAssignments = useCallback((
    assignments: ExpandedAssignment[]
  ): CamperAssignment[] => {
    return assignments
      .filter(a => a.expand?.person && a.expand?.bunk)
      .map(a => {
        const person = a.expand?.person;
        const bunk = a.expand?.bunk;
        if (!person || !bunk) {
          // This should never happen due to the filter above, but TypeScript needs the guard
          throw new Error('Missing expand data');
        }
        return {
          personId: person.id,
          personCmId: person.cm_id,
          name: `${person.preferred_name ?? person.first_name} ${person.last_name}`,
          grade: person.grade ?? 0,
          gender: person.gender ?? '',
          bunkId: bunk.id,
          bunkName: bunk.name,
          bunkPlanId: a.bunk_plan ?? '',
        };
      });
  }, []);

  // Get left and right assignments
  const leftAssignments = useMemo(() => {
    if (leftScenarioId === 'production') {
      return normalizeAssignments(productionAssignments as ExpandedAssignment[]);
    }
    return normalizeAssignments(leftDraftAssignments as ExpandedAssignment[]);
  }, [leftScenarioId, productionAssignments, leftDraftAssignments, normalizeAssignments]);

  const rightAssignments = useMemo(() => {
    if (rightScenarioId === 'production') {
      return normalizeAssignments(productionAssignments as ExpandedAssignment[]);
    }
    return normalizeAssignments(rightDraftAssignments as ExpandedAssignment[]);
  }, [rightScenarioId, productionAssignments, rightDraftAssignments, normalizeAssignments]);

  // Compute comparison result
  const comparison = useMemo((): ComparisonResult => {
    const leftByPerson = new Map(leftAssignments.map(a => [a.personCmId, a]));
    const rightByPerson = new Map(rightAssignments.map(a => [a.personCmId, a]));

    const moved: ComparisonResult['moved'] = [];
    const newlyAssigned: ComparisonResult['newlyAssigned'] = [];
    const newlyUnassigned: ComparisonResult['newlyUnassigned'] = [];
    const unchanged: CamperAssignment[] = [];

    // Check all campers in left scenario
    for (const [personCmId, leftCamper] of leftByPerson) {
      const rightCamper = rightByPerson.get(personCmId);

      if (!rightCamper) {
        // Camper was assigned in left but not in right (became unassigned)
        newlyUnassigned.push({
          camper: leftCamper,
          fromBunk: { id: leftCamper.bunkId, name: leftCamper.bunkName },
        });
      } else if (leftCamper.bunkId !== rightCamper.bunkId) {
        // Camper moved to different bunk
        moved.push({
          camper: rightCamper,
          fromBunk: { id: leftCamper.bunkId, name: leftCamper.bunkName },
          toBunk: { id: rightCamper.bunkId, name: rightCamper.bunkName },
        });
      } else {
        // Camper unchanged
        unchanged.push(leftCamper);
      }
    }

    // Check for newly assigned campers in right scenario
    for (const [personCmId, rightCamper] of rightByPerson) {
      if (!leftByPerson.has(personCmId)) {
        newlyAssigned.push({
          camper: rightCamper,
          toBunk: { id: rightCamper.bunkId, name: rightCamper.bunkName },
        });
      }
    }

    const totalChanges = moved.length + newlyAssigned.length + newlyUnassigned.length;
    const totalInvolved = Math.max(leftAssignments.length, rightAssignments.length);

    return {
      moved,
      newlyAssigned,
      newlyUnassigned,
      unchanged,
      metrics: {
        totalCampers: { left: leftAssignments.length, right: rightAssignments.length },
        movedCount: moved.length,
        newlyAssignedCount: newlyAssigned.length,
        newlyUnassignedCount: newlyUnassigned.length,
        unchangedCount: unchanged.length,
        changePercentage: totalInvolved > 0 ? Math.round((totalChanges / totalInvolved) * 100) : 0,
      },
    };
  }, [leftAssignments, rightAssignments]);

  // Get all unique bunks for split view
  const allBunks = useMemo(() => {
    const bunkMap = new Map<string, { id: string; name: string; gender: string }>();

    [...leftAssignments, ...rightAssignments].forEach(a => {
      if (!bunkMap.has(a.bunkId)) {
        const gender = a.bunkName.startsWith('B-') ? 'M' :
                      a.bunkName.startsWith('G-') ? 'F' :
                      a.bunkName.startsWith('AG-') ? 'Mixed' : 'Unknown';
        bunkMap.set(a.bunkId, { id: a.bunkId, name: a.bunkName, gender });
      }
    });

    return Array.from(bunkMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [leftAssignments, rightAssignments]);

  // Filter bunks by selected area
  const filteredBunks = useMemo(() => {
    return allBunks.filter(bunk => {
      if (selectedBunkArea === 'all') return true;
      if (selectedBunkArea === 'boys') return bunk.gender === 'M';
      if (selectedBunkArea === 'girls') return bunk.gender === 'F';
      if (selectedBunkArea === 'ag') return bunk.gender === 'Mixed';
      return true;
    });
  }, [allBunks, selectedBunkArea]);

  // Create bunk comparison data with movement tracking
  const bunkComparisons = useMemo((): BunkComparison[] => {
    // Build lookup maps for movement tracking
    const leftByPerson = new Map(leftAssignments.map(a => [a.personCmId, a]));
    const rightByPerson = new Map(rightAssignments.map(a => [a.personCmId, a]));

    return filteredBunks.map(bunk => {
      const leftCampers = leftAssignments.filter(a => a.bunkId === bunk.id);
      const rightCampers = rightAssignments.filter(a => a.bunkId === bunk.id);

      const leftPersonIds = new Set(leftCampers.map(c => c.personCmId));
      const rightPersonIds = new Set(rightCampers.map(c => c.personCmId));

      // Track moved in with their origin
      const movedIn = rightCampers
        .filter(c => !leftPersonIds.has(c.personCmId))
        .map(c => {
          const prevAssignment = leftByPerson.get(c.personCmId);
          return {
            camper: c,
            fromBunk: prevAssignment?.bunkName || '(Unassigned)',
          };
        });

      // Track moved out with their destination
      const movedOut = leftCampers
        .filter(c => !rightPersonIds.has(c.personCmId))
        .map(c => {
          const nextAssignment = rightByPerson.get(c.personCmId);
          return {
            camper: c,
            toBunk: nextAssignment?.bunkName || '(Unassigned)',
          };
        });

      return {
        bunkId: bunk.id,
        bunkName: bunk.name,
        leftCampers,
        rightCampers,
        movedIn,
        movedOut,
        unchanged: rightCampers.filter(c => leftPersonIds.has(c.personCmId)),
      };
    });
  }, [filteredBunks, leftAssignments, rightAssignments]);

  // Filter changes based on selected filter
  const filteredChanges = useMemo(() => {
    switch (changeFilter) {
      case 'moved':
        return { moved: comparison.moved, newlyAssigned: [], newlyUnassigned: [] };
      case 'newly-assigned':
        return { moved: [], newlyAssigned: comparison.newlyAssigned, newlyUnassigned: [] };
      case 'newly-unassigned':
        return { moved: [], newlyAssigned: [], newlyUnassigned: comparison.newlyUnassigned };
      default:
        return { moved: comparison.moved, newlyAssigned: comparison.newlyAssigned, newlyUnassigned: comparison.newlyUnassigned };
    }
  }, [comparison, changeFilter]);

  const leftScenarioName = leftScenarioId === 'production'
    ? 'CampMinder (Production)'
    : scenarios.find(s => s.id === leftScenarioId)?.name || 'Select scenario';

  const rightScenarioName = rightScenarioId === 'production'
    ? 'CampMinder (Production)'
    : scenarios.find(s => s.id === rightScenarioId)?.name || 'Select scenario';

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner-lodge w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header - matches card-lodge style with rounded corners, dark mode aware */}
      <header className="sticky top-0 z-20 mx-4 mt-4 bg-forest-800 dark:bg-forest-900 text-white shadow-lodge-lg rounded-2xl">
        <div className="px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            {/* Back button and title */}
            <div className="flex items-center gap-4">
              <Link
                to={`/summer/session/${sessionUrlSegment}/bunks`}
                className="btn-ghost text-white/70 hover:text-white hover:bg-white/10 p-2 rounded-xl"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-display font-bold flex items-center gap-3">
                  <GitCompare className="w-6 h-6 text-amber-400" />
                  Scenario Comparison
                </h1>
                <p className="text-sm text-white/60">
                  Compare bunk assignments between scenarios
                </p>
              </div>
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-2 bg-white/10 rounded-xl p-1">
              {[
                { mode: 'split' as ViewMode, icon: LayoutGrid, label: 'Split View' },
                { mode: 'changes' as ViewMode, icon: Table2, label: 'Changes Table' },
              ].map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                    viewMode === mode
                      ? 'bg-white text-forest-800'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  )}
                  title={label}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Scenario Selectors */}
      <div className="bg-background border-b border-border sticky top-0 z-10 mt-4">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col lg:flex-row items-center gap-4 lg:gap-8">
            {/* Left Scenario */}
            <div className="flex-1 w-full">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
                Compare From (Before)
              </label>
              <Listbox value={leftScenarioId} onChange={setLeftScenarioId}>
                <div className="relative">
                  <ListboxButton className="listbox-button font-medium">
                    <span className="truncate">
                      {leftScenarioId === 'production'
                        ? 'CampMinder (Production)'
                        : scenarios.find(s => s.id === leftScenarioId)?.name || 'Select...'}
                    </span>
                    <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </ListboxButton>
                  <ListboxOptions className="listbox-options w-full">
                    <ListboxOption value="production" className="listbox-option">
                      CampMinder (Production)
                    </ListboxOption>
                    {scenarios.length > 0 && (
                      <div className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-t border-border mt-1">
                        Draft Scenarios
                      </div>
                    )}
                    {scenarios.map(s => (
                      <ListboxOption
                        key={s.id}
                        value={s.id}
                        disabled={s.id === rightScenarioId}
                        className="listbox-option"
                      >
                        {s.name}
                      </ListboxOption>
                    ))}
                  </ListboxOptions>
                </div>
              </Listbox>
            </div>

            {/* Arrow indicator */}
            <div className="flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <ArrowRight className="w-6 h-6 text-amber-600" />
              </div>
            </div>

            {/* Right Scenario */}
            <div className="flex-1 w-full">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
                Compare To (After)
              </label>
              <Listbox value={rightScenarioId} onChange={setRightScenarioId}>
                <div className="relative">
                  <ListboxButton className="listbox-button font-medium">
                    <span className={clsx('truncate', !rightScenarioId && 'text-muted-foreground')}>
                      {!rightScenarioId
                        ? 'Select a scenario...'
                        : rightScenarioId === 'production'
                          ? 'CampMinder (Production)'
                          : scenarios.find(s => s.id === rightScenarioId)?.name || 'Select...'}
                    </span>
                    <ChevronDown className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  </ListboxButton>
                  <ListboxOptions className="listbox-options w-full">
                    <ListboxOption
                      value="production"
                      disabled={leftScenarioId === 'production'}
                      className="listbox-option"
                    >
                      CampMinder (Production)
                    </ListboxOption>
                    {scenarios.length > 0 && (
                      <div className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-t border-border mt-1">
                        Draft Scenarios
                      </div>
                    )}
                    {scenarios.map(s => (
                      <ListboxOption
                        key={s.id}
                        value={s.id}
                        disabled={s.id === leftScenarioId}
                        className="listbox-option"
                      >
                        {s.name}
                      </ListboxOption>
                    ))}
                  </ListboxOptions>
                </div>
              </Listbox>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {!isReady ? (
          /* Empty state */
          <div className="card-lodge p-12 text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-forest-100 dark:bg-forest-900/30 flex items-center justify-center">
              <GitCompare className="w-10 h-10 text-forest-500" />
            </div>
            <h2 className="text-2xl font-display font-bold text-foreground mb-3">
              Select Two Scenarios to Compare
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Choose a "before" and "after" scenario above to see what changed.
              You can compare production data with any draft scenario.
            </p>
          </div>
        ) : (
          <>
            {/* Validation Score Comparison - Detailed breakdown */}
            {(leftValidation || rightValidation) && (
              <div className="card-lodge p-4 mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 className="w-5 h-5 text-forest-600" />
                  <h3 className="font-semibold">Validation Details</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left Scenario Score */}
                  <ValidationScoreCard
                    label={leftScenarioName}
                    validation={leftValidation}
                    side="left"
                  />
                  {/* Right Scenario Score */}
                  <ValidationScoreCard
                    label={rightScenarioName}
                    validation={rightValidation}
                    side="right"
                  />
                </div>
              </div>
            )}

            {/* Metrics Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <MetricCard
                label="Total Campers"
                value={comparison.metrics.totalCampers.right}
                sublabel={`${comparison.metrics.totalCampers.left} before`}
                icon={Users}
                color="forest"
              />
              <MetricCard
                label="Moved"
                value={comparison.metrics.movedCount}
                icon={ArrowLeftRight}
                color="amber"
                trend={comparison.metrics.movedCount > 0 ? 'neutral' : undefined}
              />
              <MetricCard
                label="Change Rate"
                value={`${comparison.metrics.changePercentage}%`}
                sublabel={`${comparison.metrics.unchangedCount} unchanged`}
                icon={UserCheck}
                color="bark"
              />
              <MetricCard
                label="New Assignments"
                value={comparison.metrics.newlyAssignedCount}
                sublabel={comparison.metrics.newlyUnassignedCount > 0 ? `${comparison.metrics.newlyUnassignedCount} unassigned` : undefined}
                icon={Percent}
                color="green"
              />
            </div>

            {/* Area Filter (for split view) */}
            {viewMode === 'split' && (
              <div className="flex items-center gap-2 mb-4">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground mr-2">Area:</span>
                {['all', 'boys', 'girls', 'ag'].map(area => (
                  <button
                    key={area}
                    onClick={() => setSelectedBunkArea(area as typeof selectedBunkArea)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                      selectedBunkArea === area
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {area === 'all' ? 'All' : area === 'boys' ? 'Boys' : area === 'girls' ? 'Girls' : 'AG'}
                  </button>
                ))}
              </div>
            )}

            {/* Change Filter (for changes view) */}
            {viewMode === 'changes' && (
              <div className="flex items-center gap-2 mb-4">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground mr-2">Show:</span>
                {[
                  { id: 'all' as ChangeFilter, label: 'All Changes' },
                  { id: 'moved' as ChangeFilter, label: `Moved (${comparison.metrics.movedCount})` },
                  { id: 'newly-assigned' as ChangeFilter, label: `New (${comparison.metrics.newlyAssignedCount})` },
                  { id: 'newly-unassigned' as ChangeFilter, label: `Gone (${comparison.metrics.newlyUnassignedCount})` },
                ].map(filter => (
                  <button
                    key={filter.id}
                    onClick={() => setChangeFilter(filter.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                      changeFilter === filter.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            )}

            {/* Split View */}
            {viewMode === 'split' && (
              <div className="space-y-4">
                {bunkComparisons.map(bunkComp => (
                  <BunkComparisonCard
                    key={bunkComp.bunkId}
                    comparison={bunkComp}
                    leftLabel={leftScenarioName}
                    rightLabel={rightScenarioName}
                  />
                ))}
              </div>
            )}

            {/* Changes Table View */}
            {viewMode === 'changes' && (
              <div className="card-lodge overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Camper
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Grade
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Change
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        From
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        To
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredChanges.moved.map(change => (
                      <tr key={`moved-${change.camper.personCmId}`} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{change.camper.name}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatGradeOrdinal(change.camper.grade)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-medium">
                            <ArrowLeftRight className="w-3 h-3" />
                            Moved
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{change.fromBunk.name}</td>
                        <td className="px-4 py-3 text-sm">{change.toBunk.name}</td>
                      </tr>
                    ))}
                    {filteredChanges.newlyAssigned.map(change => (
                      <tr key={`assigned-${change.camper.personCmId}`} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{change.camper.name}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatGradeOrdinal(change.camper.grade)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-forest-100 dark:bg-forest-900/30 text-forest-700 dark:text-forest-400 text-xs font-medium">
                            <CheckCircle2 className="w-3 h-3" />
                            Assigned
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">—</td>
                        <td className="px-4 py-3 text-sm">{change.toBunk.name}</td>
                      </tr>
                    ))}
                    {filteredChanges.newlyUnassigned.map(change => (
                      <tr key={`unassigned-${change.camper.personCmId}`} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{change.camper.name}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatGradeOrdinal(change.camper.grade)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bark-100 dark:bg-bark-800/30 text-bark-700 dark:text-bark-400 text-xs font-medium">
                            <AlertTriangle className="w-3 h-3" />
                            Unassigned
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{change.fromBunk.name}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredChanges.moved.length === 0 &&
                 filteredChanges.newlyAssigned.length === 0 &&
                 filteredChanges.newlyUnassigned.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground">
                    No changes to display
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Validation Score Card Component - detailed validation stats
interface ValidationScoreCardProps {
  label: string;
  validation: ValidationResult | null | undefined;
  side: 'left' | 'right';
}

function ValidationScoreCard({ label, validation, side }: ValidationScoreCardProps) {
  if (!validation) {
    return (
      <div className={clsx(
        'p-4 rounded-xl border-2 border-dashed',
        side === 'left' ? 'border-muted' : 'border-muted'
      )}>
        <div className="text-sm font-medium text-muted-foreground mb-2 truncate">{label}</div>
        <div className="text-sm text-muted-foreground/60">Loading validation...</div>
      </div>
    );
  }

  const stats = validation.statistics;
  const satisfactionPct = Math.round(stats.request_satisfaction_rate * 100);
  const explicitPct = Math.round(stats.explicit_csv_request_satisfaction_rate * 100);

  return (
    <div className={clsx(
      'p-4 rounded-xl border-2',
      side === 'left' ? 'border-bark-200 dark:border-bark-700' : 'border-forest-200 dark:border-forest-700'
    )}>
      <div className="text-sm font-semibold mb-3 truncate">{label}</div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {/* Request Satisfaction */}
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wider">All Requests</div>
          <div className="flex items-baseline gap-1">
            <span className={clsx(
              'text-xl font-bold',
              satisfactionPct >= 80 ? 'text-forest-600' :
              satisfactionPct >= 60 ? 'text-amber-600' : 'text-red-600'
            )}>
              {satisfactionPct}%
            </span>
            <span className="text-muted-foreground text-xs">
              ({stats.satisfied_requests}/{stats.total_requests})
            </span>
          </div>
        </div>
        {/* Explicit Field Satisfaction */}
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wider">Parent Requests</div>
          <div className="flex items-baseline gap-1">
            <span className={clsx(
              'text-xl font-bold',
              explicitPct >= 80 ? 'text-forest-600' :
              explicitPct >= 60 ? 'text-amber-600' : 'text-red-600'
            )}>
              {explicitPct}%
            </span>
            <span className="text-muted-foreground text-xs">
              ({stats.satisfied_explicit_csv_requests}/{stats.explicit_csv_requests})
            </span>
          </div>
        </div>
        {/* Violations & Risks */}
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wider">Violations</div>
          <div className={clsx(
            'text-xl font-bold',
            stats.negative_request_violations > 0 ? 'text-red-600' : 'text-forest-600'
          )}>
            {stats.negative_request_violations}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wider">Isolation Risks</div>
          <div className={clsx(
            'text-xl font-bold',
            stats.isolation_risks > 0 ? 'text-amber-600' : 'text-forest-600'
          )}>
            {stats.isolation_risks}
          </div>
        </div>
      </div>
    </div>
  );
}

// Metric Card Component
interface MetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string | undefined;
  icon: React.ElementType;
  color: 'forest' | 'amber' | 'green' | 'red' | 'bark';
  trend?: 'up' | 'down' | 'neutral' | undefined;
}

function MetricCard({ label, value, sublabel, icon: Icon, color, trend }: MetricCardProps) {
  const colorClasses = {
    forest: 'bg-forest-100 dark:bg-forest-900/30 text-forest-600 dark:text-forest-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    green: 'bg-forest-100 dark:bg-forest-900/30 text-forest-600 dark:text-forest-400',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    bark: 'bg-bark-100 dark:bg-bark-800/30 text-bark-600 dark:text-bark-400',
  };

  return (
    <div className="card-lodge p-4">
      <div className="flex items-start justify-between mb-2">
        <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', colorClasses[color])}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <div className={clsx(
            'flex items-center gap-1 text-xs font-medium',
            trend === 'up' && 'text-forest-600',
            trend === 'down' && 'text-red-600',
            trend === 'neutral' && 'text-amber-600'
          )}>
            {trend === 'up' && <TrendingUp className="w-3 h-3" />}
            {trend === 'down' && <TrendingDown className="w-3 h-3" />}
            {trend === 'neutral' && <Minus className="w-3 h-3" />}
          </div>
        )}
      </div>
      <div className="stat-card-value text-2xl">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
      {sublabel && (
        <div className="text-xs text-muted-foreground/70 mt-0.5">{sublabel}</div>
      )}
    </div>
  );
}

// Bunk Comparison Card (Split View)
interface BunkComparisonCardProps {
  comparison: BunkComparison;
  leftLabel: string;
  rightLabel: string;
}

function BunkComparisonCard({ comparison, leftLabel, rightLabel }: BunkComparisonCardProps) {
  const hasChanges = comparison.movedIn.length > 0 || comparison.movedOut.length > 0;
  const movedInIds = new Set(comparison.movedIn.map(c => c.camper.personCmId));
  const movedOutIds = new Set(comparison.movedOut.map(c => c.camper.personCmId));

  // Build lookup for movement destinations
  const movedOutDestinations = new Map(comparison.movedOut.map(c => [c.camper.personCmId, c.toBunk]));
  const movedInOrigins = new Map(comparison.movedIn.map(c => [c.camper.personCmId, c.fromBunk]));

  return (
    <div className={clsx(
      'card-lodge overflow-hidden transition-all',
      hasChanges && 'ring-2 ring-amber-400/50'
    )}>
      {/* Bunk Header */}
      <div className={clsx(
        'px-4 py-3 border-b border-border flex items-center justify-between',
        hasChanges ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-muted/30'
      )}>
        <div className="flex items-center gap-3">
          <Home className="w-5 h-5 text-muted-foreground" />
          <h3 className="font-semibold text-lg">{comparison.bunkName}</h3>
          {hasChanges && (
            <span className="px-2 py-0.5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 text-xs font-medium">
              Changed
            </span>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          {comparison.leftCampers.length} → {comparison.rightCampers.length} campers
        </div>
      </div>

      {/* Split Content */}
      <div className="grid grid-cols-2 divide-x divide-border">
        {/* Left Side (Before) */}
        <div className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {leftLabel}
          </div>
          <div className="space-y-1.5">
            {comparison.leftCampers.length === 0 ? (
              <div className="text-sm text-muted-foreground italic py-2">Empty</div>
            ) : (
              comparison.leftCampers.map(camper => (
                <CamperPill
                  key={camper.personCmId}
                  camper={camper}
                  status={movedOutIds.has(camper.personCmId) ? 'moved-out' : 'unchanged'}
                  destination={movedOutDestinations.get(camper.personCmId)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right Side (After) */}
        <div className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {rightLabel}
          </div>
          <div className="space-y-1.5">
            {comparison.rightCampers.length === 0 ? (
              <div className="text-sm text-muted-foreground italic py-2">Empty</div>
            ) : (
              comparison.rightCampers.map(camper => (
                <CamperPill
                  key={camper.personCmId}
                  camper={camper}
                  status={movedInIds.has(camper.personCmId) ? 'moved-in' : 'unchanged'}
                  origin={movedInOrigins.get(camper.personCmId)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Camper Pill Component with origin/destination info
interface CamperPillProps {
  camper: CamperAssignment;
  status: 'unchanged' | 'moved-in' | 'moved-out';
  origin?: string | undefined;  // Where they came from (for moved-in)
  destination?: string | undefined;  // Where they went (for moved-out)
}

function CamperPill({ camper, status, origin, destination }: CamperPillProps) {
  return (
    <div className={clsx(
      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all',
      status === 'unchanged' && 'bg-muted/50',
      status === 'moved-in' && 'bg-forest-100 dark:bg-forest-900/30 ring-1 ring-forest-300 dark:ring-forest-700',
      status === 'moved-out' && 'bg-red-50 dark:bg-red-900/20 ring-1 ring-red-200 dark:ring-red-800 opacity-75'
    )}>
      <span className={clsx('font-medium', status === 'moved-out' && 'line-through')}>{camper.name}</span>
      <span className="text-muted-foreground text-xs">
        {formatGradeOrdinal(camper.grade)}
      </span>
      {/* Show origin for moved-in campers */}
      {status === 'moved-in' && origin && (
        <span className="ml-auto flex items-center gap-1 text-xs text-forest-600 dark:text-forest-400">
          <ArrowLeft className="w-3 h-3" />
          <span className="opacity-80">{origin}</span>
        </span>
      )}
      {/* Show destination for moved-out campers */}
      {status === 'moved-out' && destination && (
        <span className="ml-auto flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <ArrowRight className="w-3 h-3" />
          <span className="opacity-80">{destination}</span>
        </span>
      )}
    </div>
  );
}
