/**
 * Centralized query keys for consistent caching
 *
 * Always use these factory functions for query keys to ensure:
 * 1. Type-safe cache invalidation
 * 2. Consistent key structure across components
 * 3. Proper cache sharing between related queries
 */
export interface SolverRunsFilters {
  sessionId?: number
  sourceKind?: 'production' | 'scenario' | 'all'
  sweepId?: string
  /** When true, restrict to runs not associated with any sweep. */
  manualOnly?: boolean
  hideFailed?: boolean
  since?: string
  /**
   * Scopes runs to a specific year via the `year` column on `solver_runs`.
   * Omit for no year scoping (used in tests and non-year-scoped views).
   */
  year?: number
}

export const queryKeys = {
  // Sessions (Tier 1 - sync data)
  sessions: (year: number) => ['sessions', year] as const,
  allSessions: (year: number) => ['all-sessions', year] as const,
  allSessionsList: (year: number) => ['sessions', 'list', year] as const,
  session: (id: string) => ['session', id] as const,
  sessionGroups: (year: number) => ['session-groups', year] as const,
  sessionPrograms: (year: number) => ['session-programs', year] as const,

  // Campers (Tier 1 - sync data)
  allCampers: () => ['all-campers'] as const,
  camper: (id: string) => ['camper', id] as const,
  campersForSession: (sessionId: string, agSessions: string[], year?: number) =>
    year
      ? (['campers', sessionId, agSessions.sort(), year] as const)
      : (['campers', sessionId, agSessions.sort()] as const),

  // Bunks (Tier 1 - sync data)
  bunksForSession: (sessionId: string, agSessions: string[]) =>
    ['bunks', sessionId, agSessions.sort()] as const,

  // Invalidation prefixes for the two roots the summer board reads through.
  // `useSessionBunks` / `useSessionCampers` (hooks/session/useSessionData.ts)
  // build their keys INLINE rather than from the factories above, with a
  // different arity again — so a writer that knows only "the bunking data
  // moved" has to invalidate by root or it matches nothing that is cached.
  // See `invalidateBunkingQueries` (utils/queryInvalidation.ts).
  bunksPrefix: () => ['bunks'] as const,
  campersPrefix: () => ['campers'] as const,
  // `useBunkNames` (hooks/useBunkNames.ts) — the social graph's bunk picker and
  // its label fallback. Inline key again, and it reads `bunk_plans` and `bunks`.
  bunkNamesPrefix: () => ['bunk-names'] as const,
  // Three more inline `bunk_plans` readers, none of which the two roots above
  // reach: a prefix matches from the FIRST element, so `['bunks']` does not
  // match `['session-bunks', …]`. All three sit behind the app default 30
  // minute staleTime like everything else on this list.
  //   `AllCampersView`      — the camper table's bunk filter
  //   `BunkSocialGraphModal`— the graph's own bunk navigation
  //   `useSessionHierarchy` — gates which child sessions are offered at all
  allBunksWithPlansPrefix: () => ['all-bunks-with-plans'] as const,
  sessionBunksPrefix: () => ['session-bunks'] as const,
  sessionBunkPlanCountsPrefix: () => ['session-bunk-plan-counts'] as const,

  // Enrollment (Tier 1 - sync data)
  enrolledCampers: (personCmId: number, year: number) =>
    ['enrolled-campers', personCmId, year] as const,
  // The invalidation prefix: the camper details panel reads the CURRENT year's
  // `bunk_assignments` through this, and a sync-completion handler knows no
  // person. See `invalidateBunkingQueries`.
  enrolledCampersPrefix: () => ['enrolled-campers'] as const,
  // Enrolled attendee cm_ids for a whole session — used to exclude staff from
  // scenario-comparison counts (staff hold assignments but no attendee row, #1791).
  enrolledAttendeeCmIds: (sessionCmId: number, year: number) =>
    ['enrolled-attendee-cmids', sessionCmId, year] as const,

  // Historical data (Tier 1 - sync data)
  historicalBunking: (personCmId: number, year: number) =>
    ['historical-bunking', personCmId, year] as const,
  camperHistory: (personId: string, year: number) => ['camper-history', personId, year] as const,

  // Statistics (Tier 1 - sync data)
  sessionStats: (sessionId: string) => ['session-stats', sessionId] as const,

  // Scenarios (Tier 2 - user data)
  savedScenarios: (sessionCmId: number, year?: number) =>
    year
      ? (['saved-scenarios', sessionCmId, year] as const)
      : (['saved-scenarios', sessionCmId] as const),
  scenario: (id: string) => ['scenario', id] as const,

  // Session Campers (Tier 1 - sync data, shared by CreateRequestModal + EditableRequestTarget)
  sessionCampers: (sessionId: number, year: number) =>
    ['session-campers', sessionId, year] as const,

  // Bunk Requests (Tier 2 - user data)
  bunkRequests: (sessionId: string, year: number) => ['bunk-requests', sessionId, year] as const,
  // Count uses same 'bunk-requests' prefix so invalidateQueries({ queryKey: ['bunk-requests'] })
  // automatically invalidates the tab-badge count without additional call sites.
  bunkRequestsCount: (selectedSession: string, year: number, ...rest: unknown[]) =>
    ['bunk-requests', 'count', selectedSession, year, ...rest] as const,
  // Solver/movement status derived from bunk requests (no parameters — global flag).
  bunkRequestStatus: () => ['bunk-request-status'] as const,

  // Scenario Validation (Tier 2 - user data, computed from solver)
  scenarioValidation: (scenarioId: string, sessionCmId: number, year: number) =>
    ['scenario-validation', scenarioId, sessionCmId, year] as const,

  // Locked Groups (Tier 2 - user data)
  lockedGroups: (scenarioId: string, sessionId: string, year: number) =>
    ['locked-groups', scenarioId, sessionId, year] as const,

  // Sync Status (Tier 2 - frequently updated)
  syncStatus: () => ['sync-status'] as const,
  syncStatusForService: (service: string) => ['sync-status', service] as const,
  csvPipelineStatus: () => ['csv-pipeline-status'] as const,
  lastUploadSummary: () => ['lastUploadSummary'] as const,
  // sessionCmIds is sorted so cache identity is stable regardless of the
  // caller's [sessionCmId, ...agSessionCmIds] order (matches cohortBunkAssignments).
  sessionUploadChanges: (runId: string, sessionCmIds: number[]) =>
    ['sessionUploadChanges', runId, sessionCmIds.toSorted((a, b) => a - b)] as const,

  // Users (Tier 2 - user data)
  users: () => ['users'] as const,

  // RBAC (Tier 2 - user data)
  roles: () => ['roles'] as const,
  userRoles: () => ['user-roles'] as const,
  userRolesForUser: (userId: string) => ['user-roles', userId] as const,

  // Admin/Config (Tier 2 - user data)
  adminSettings: () => ['admin-settings'] as const,
  adminSessions: (year: number) => ['admin-sessions', year] as const,
  solverConfig: () => ['solver-config'] as const,

  // Debug (Tier 2 - frequently updated during testing)
  parseAnalysis: (filters?: {
    sessionCmId?: number | undefined
    sourceField?: string | undefined
  }) =>
    filters
      ? (['parse-analysis', filters.sessionCmId, filters.sourceField] as const)
      : (['parse-analysis'] as const),
  parseAnalysisDetail: (id: string) => ['parse-analysis', id] as const,
  originalRequests: (
    year: number,
    filters?: {
      sessionCmId?: number | undefined
      sourceField?: string | undefined
    }
  ) =>
    filters
      ? (['original-requests', year, filters.sessionCmId, filters.sourceField] as const)
      : (['original-requests', year] as const),
  originalRequestsWithStatus: (
    year: number,
    filters?: {
      sessionCmId?: number | undefined
      sourceField?: string | undefined
    }
  ) =>
    filters
      ? (['original-requests-with-status', year, filters.sessionCmId, filters.sourceField] as const)
      : (['original-requests-with-status', year] as const),
  parseResultWithFallback: (originalRequestId: string) =>
    ['parse-result-with-fallback', originalRequestId] as const,

  // Prompts (Tier 2 - editable config files)
  prompts: () => ['prompts'] as const,
  prompt: (name: string) => ['prompts', name] as const,

  // Pipeline Debug (Tier 2 - frequently updated during testing)
  pipelineTracePrefix: ['pipeline-trace'] as const,
  pipelineSummaryPrefix: ['pipeline-summary'] as const,
  pipelineRuns: () => ['pipeline-runs'] as const,
  pipelineSummary: (runId: string, filters?: Record<string, unknown>) =>
    filters
      ? (['pipeline-summary', runId, filters] as const)
      : (['pipeline-summary', runId] as const),
  pipelineTrace: (traceId: string) => ['pipeline-trace', traceId] as const,
  pipelineTracesByCamper: (cmId: number) => ['pipeline-traces-camper', cmId] as const,
  searchPersons: (query: string, year: number) => ['search-persons', query, year] as const,
  originalRequestsByCamper: (cmId: number, year: number) =>
    ['original-requests-camper', cmId, year] as const,
  browseOriginalRequests: (
    year: number,
    filters?: { session_cm_id?: number; source_field?: string }
  ) =>
    filters
      ? (['browse-original-requests', year, filters.session_cm_id, filters.source_field] as const)
      : (['browse-original-requests', year] as const),

  // Metrics (Tier 1 - sync data, historical analysis)
  retention: (
    baseYear: number,
    compareYear: number,
    sessionTypes?: string,
    sessionCmId?: number,
    duration?: string,
    includeTeenPipeline?: boolean
  ) =>
    [
      'metrics',
      'retention',
      baseYear,
      compareYear,
      sessionTypes,
      sessionCmId,
      duration,
      includeTeenPipeline,
    ] as const,
  metricsSessions: (year: number) => ['metrics', 'sessions', year] as const,
  registration: (
    year: number,
    sessionTypes?: string,
    statuses?: string,
    sessionCmId?: number,
    duration?: string
  ) => ['metrics', 'registration', year, sessionTypes, statuses, sessionCmId, duration] as const,
  comparison: (
    yearA: number,
    yearB: number,
    sessionTypes?: string,
    sessionCmId?: number,
    duration?: string
  ) => ['metrics', 'comparison', yearA, yearB, sessionTypes, sessionCmId, duration] as const,
  historical: (years?: string, sessionTypes?: string, sessionCmId?: number, duration?: string) =>
    ['metrics', 'historical', years, sessionTypes, sessionCmId, duration] as const,
  retentionTrends: (
    currentYear: number,
    numYears?: number,
    sessionTypes?: string,
    sessionCmId?: number,
    duration?: string,
    includeTeenPipeline?: boolean
  ) =>
    [
      'metrics',
      'retention-trends',
      currentYear,
      numYears,
      sessionTypes,
      sessionCmId,
      duration,
      includeTeenPipeline,
    ] as const,
  waitlist: (year: number, sessionTypes?: string, sessionCmId?: number, duration?: string) =>
    ['metrics', 'waitlist', year, sessionTypes, sessionCmId, duration] as const,
  cancellations: (year: number, sessionTypes?: string, sessionCmId?: number, duration?: string) =>
    ['metrics', 'cancellations', year, sessionTypes, sessionCmId, duration] as const,
  drilldown: (
    year: number,
    breakdownType?: string,
    breakdownValue?: string,
    sessionCmId?: number,
    sessionTypes?: string,
    statusFilter?: string,
    compareYear?: number,
    duration?: string,
    includeTeenPipeline?: boolean
  ) =>
    [
      'metrics',
      'drilldown',
      year,
      breakdownType,
      breakdownValue,
      sessionCmId,
      sessionTypes,
      statusFilter,
      compareYear,
      duration,
      includeTeenPipeline,
    ] as const,

  // Registration Config (Tier 2 - user data)
  registrationDatesConfig: (year: number) => ['registration-dates-config', year] as const,
  gradeEligibilityConfig: (year: number) => ['grade-eligibility-config', year] as const,
  gradeEligibilityThreshold: (year: number) => ['grade-eligibility-threshold', year] as const,
  sessionAvailability: (
    year: number,
    sessionTypes?: string,
    sessionCmId?: number,
    duration?: string
  ) => ['session-availability', year, sessionTypes, sessionCmId, duration] as const,
  /** Root prefix for invalidating every session-availability query at once. */
  sessionAvailabilityRoot: () => ['session-availability'] as const,
  sessionBudgetConfig: (year: number) => ['session-budget-config', year] as const,

  // Forecast (Tier 1 - sync data)
  forecast: (
    year: number,
    sessionTypes?: string,
    sessionCmId?: number,
    dayOffset?: number,
    duration?: string
  ) => ['metrics', 'forecast', year, sessionTypes, sessionCmId, dayOffset, duration] as const,
  /** Root prefix for invalidating every forecast query at once. */
  forecastRoot: () => ['metrics', 'forecast'] as const,
  forecastWeekOptions: (year: number) => ['metrics', 'forecast', 'week-options', year] as const,

  // Camper Cohorts (Tier 1 - sync data, per-session school/congregation/city counts)
  camperCohorts: (personCmId: number | null, sessionCmId: number, year: number) =>
    ['camper-cohorts', personCmId, sessionCmId, year] as const,
  // Cohort Request Relations (Tier 2 - user-editable, drives modal badges)
  cohortRequestRelations: (personCmId: number | null, sessionCmId: number, year: number) =>
    ['cohort-request-relations', personCmId, sessionCmId, year] as const,
  // Cohort Bunk Assignments (Tier 2 — scenario or production assignments
  // shown inline next to each row). Keyed by scenarioId so production view
  // (null) and each scenario gets its own cache entry.
  cohortBunkAssignments: (
    scenarioId: string | null,
    sessionCmId: number,
    year: number,
    personCmIds: number[]
  ) => ['cohort-bunk-assignments', scenarioId, sessionCmId, year, personCmIds.toSorted()] as const,
  // The invalidation prefix: the real key carries a scenario, a session, a year
  // AND the exact cohort, none of which a sync-completion handler knows.
  cohortBunkAssignmentsPrefix: () => ['cohort-bunk-assignments'] as const,

  // Camper Request Summary (Tier 2 - user data, used in expanded row)
  camperRequestSummary: (requesterCmId: number, year: number) =>
    ['camper-request-summary', requesterCmId, year] as const,
  camperRequestSummaryPersons: (requesteeIds: number[], year: number) =>
    ['camper-request-summary-persons', requesteeIds, year] as const,

  // Social Graph (Tier 1 - sync data)
  socialGraph: (sessionCmId: number, year: number, scenarioId: string | null = null) =>
    ['social-graph', sessionCmId, year, scenarioId] as const,
  bunkSocialGraph: (
    bunkCmId: number,
    sessionCmId: number,
    year: number,
    scenarioId: string | null = null
  ) => ['bunk-social-graph', bunkCmId, sessionCmId, year, scenarioId] as const,
  /**
   * Scoped social graph keyed by useScopedGraphData (the hook actually used by
   * SocialNetworkGraph.tsx). Lives under the same `'social-graph'` root as the
   * unscoped variant so a single `socialGraphPrefix()` invalidation covers both
   * — see the prefix factory below for rationale.
   *
   * `unitsKey`/`bunksKey` are the comma-joined sorted filter signatures emitted
   * by useScopedGraphData; the caller is responsible for stable sorting.
   */
  scopedSocialGraph: (
    sessionCmId: number,
    year: number,
    scenarioId: string | null,
    unitsKey: string,
    bunksKey: string,
    cross: boolean
  ) =>
    ['social-graph', 'scoped', sessionCmId, year, scenarioId, unitsKey, bunksKey, cross] as const,
  // AG session linked to a main session (resolved via parent_id + bunk_plans).
  linkedAgSession: (mainSessionCmId: number, year: number) =>
    ['linked-ag-session', mainSessionCmId, year] as const,
  // The invalidation prefix. This query answers "does the linked AG session have
  // bunk_plans yet", so a bunking refresh that CREATES them is exactly what has
  // to make the AG tab appear — see `invalidateBunkingQueries`.
  linkedAgSessionPrefix: () => ['linked-ag-session'] as const,

  // Staff (Tier 1 - sync data)
  bunkStaff: (year: number) => ['bunk-staff', year] as const,
  // Prefix for invalidation: the bunk names this maps staff onto come out of
  // the `bunks` table, which a bunking refresh rewrites.
  bunkStaffPrefix: () => ['bunk-staff'] as const,

  // Geo Management (Tier 2 - user data)
  geoGapsPrefix: (category: string, year: number) => ['geo', 'gaps', category, year] as const,
  geoGaps: (category: string, year: number, activeOnly?: boolean) =>
    ['geo', 'gaps', category, year, activeOnly] as const,
  geoCanonicals: (category: string, query: string, year: number) =>
    ['geo', 'canonicals', category, query, year] as const,
  geoAllCanonicals: (category: string, year: number, inUse = true) =>
    ['geo', 'all-canonicals', category, year, inUse] as const,
  geoSources: (category: string, canonicalName: string, year: number) =>
    ['geo', 'sources', category, canonicalName, year] as const,
  geoOverrides: (category: string, year: number) => ['geo', 'overrides', category, year] as const,
  geoOverrideCoords: (year: number) => ['geo', 'override-coords', year] as const,

  // Day 1 Registration (Tier 1 - sync data, historical analysis)
  day1: (year: number, sessionTypes?: string) => ['metrics', 'day1', year, sessionTypes] as const,

  // Velocity (Tier 1 - sync data, historical analysis)
  velocity: (
    year: number,
    sessionCmId?: number,
    compareYears?: string,
    sessionTypes?: string,
    splitByGender?: boolean,
    metric?: string,
    duration?: string
  ) =>
    [
      'metrics',
      'velocity',
      year,
      sessionCmId,
      compareYears,
      sessionTypes,
      splitByGender,
      metric,
      duration,
    ] as const,

  // Prefix factories for broad invalidation of bunk_request data.
  bunkRequestsPrefix: () => ['bunk-requests'] as const,
  allBunkRequestsPrefix: () => ['all-bunk-requests'] as const,
  personBunkRequestsPrefix: () => ['person-bunk-requests'] as const,
  personAllBunkRequestsPrefix: () => ['person-all-bunk-requests'] as const,
  bunkRequestsTooltipPrefix: () => ['bunk_requests_tooltip'] as const,
  requestSatisfactionPrefix: () => ['request-satisfaction'] as const,
  cohortRequestRelationsPrefix: () => ['cohort-request-relations'] as const,
  // Prefix factories for social-graph invalidation (Issue #1040).
  // Passing the bare prefix catches every keyed variant under each root:
  //   ['social-graph', sessionCmId, year, scenarioId]                — unscoped
  //   ['social-graph', 'scoped', sessionCmId, year, ...filterSig]    — scoped (live graph)
  //   ['bunk-social-graph', bunkCmId, sessionCmId, year, scenarioId] — bunk subgraph
  // The `'scoped'` variant lives under the same root so a single
  // `socialGraphPrefix()` invalidation refreshes both useSocialGraphData and
  // useScopedGraphData. SocialNetworkGraph.tsx renders from the latter.
  socialGraphPrefix: () => ['social-graph'] as const,
  bunkSocialGraphPrefix: () => ['bunk-social-graph'] as const,

  // Satisfaction (Tier 2 - computed from solver + bunk assignments)
  satisfaction: (sessionCmId: number, year: number, scenarioId: string | null = null) =>
    ['satisfaction', sessionCmId, year, scenarioId] as const,
  satisfactionPrefix: () => ['satisfaction'] as const,

  // Parameterized fetch-site factories (Issue #1023, #1084)
  allBunkRequests: (sessionCmId: number, year: number) =>
    ['all-bunk-requests', sessionCmId, year] as const,
  // All three factories below require the caller to gate with enabled: !!cmId.
  // Caller must gate the consuming query with `enabled: !!cmId`. Passing
  // `undefined` produces a key like `['person-bunk-requests', undefined, year]`
  // which is fine as long as the query never actually runs.
  personBunkRequests: (cmId: number | undefined, year: number) =>
    ['person-bunk-requests', cmId, year] as const,
  personAllBunkRequests: (cmId: number | undefined, year: number) =>
    ['person-all-bunk-requests', cmId, year] as const,
  bunkRequestsTooltip: (cmId: number | undefined, year: number) =>
    ['bunk_requests_tooltip', cmId, year] as const,
  /**
   * Cache key for client-derived satisfaction snapshots.
   *
   * `requestIdsKey` is the caller's responsibility to compute as a stable,
   * sort-stable stringification of the request IDs that feed the snapshot —
   * conventionally `[...ids].sort().join(',')`. Without sort stability the
   * cache slot churns across renders even when the inputs are the same.
   *
   * Caller should also gate the consuming query with `enabled: !!personCmId`
   * (or similar) to avoid running with undefined ids.
   */
  requestSatisfaction: (
    personCmId: number | undefined,
    assignedBunkCmId: number | undefined,
    sessionCmId: number | undefined,
    camperGrade: number | undefined,
    year: number,
    requestIdsKey: string
  ) =>
    [
      'request-satisfaction',
      personCmId,
      assignedBunkCmId,
      sessionCmId,
      camperGrade,
      year,
      requestIdsKey,
    ] as const,

  // Parameterized fetch-site factories for CamperDetailsPanel (Issue #1025)
  camperDetails: (camperId: string, year: number) => ['camper-details', camperId, year] as const,
  personForSiblings: (camperId: string, year: number) =>
    ['person-for-siblings', camperId, year] as const,
  camperSiblingsPanel: (householdId: number | undefined, camperId: string, year: number) =>
    ['camper-siblings-panel', householdId, camperId, year] as const,
  // Filter: `requester.cm_id = {cmId}`. Returns denormalized
  // OriginalBunkData[] (used by useOriginalBunkData). Caller must gate
  // with `enabled: !!cmId`.
  originalBunkRequestsByRequesterCmId: (cmId: number | undefined, year: number) =>
    ['original-bunk-requests-by-requester-cm-id', cmId, year] as const,
  // Source-link keys are auxiliary — only merge/split mutations rewrite
  // source linkages. Pass `includeSourceLinks: true` to invalidate these.
  sourceLinksPrefix: () => ['source-links'] as const,
  expandedSourceLinksPrefix: () => ['expanded-source-links'] as const,

  // Solver runs (debug view) — see frontend/src/hooks/useSolverRuns.ts
  solverRunsPrefix: () => ['solver-runs'] as const,
  solverRuns: (filters?: SolverRunsFilters) => ['solver-runs', filters ?? {}] as const,

  // Solver pre-validate (debug view) — see frontend/src/pages/summer/SolverDebugPage
  preCheck: (sessionCmId: number | null, year: number) => ['pre-check', sessionCmId, year] as const,

  // Solver post-check validation (popout) — see frontend/src/pages/PostCheckPopout.
  // Year-scoped (mirrors the satisfaction key): CampMinder reuses session ids
  // across years, so the key must include year or a season switch reuses the
  // same cache slot and serves stale prior-year validator data.
  postCheck: (sessionCmId: number | null, year: number, scenarioId: string | undefined) =>
    ['post-check', sessionCmId, year, scenarioId] as const,
  /** Root prefix for invalidating every post-check query at once (all sessions/scenarios/years). */
  postCheckPrefix: () => ['post-check'] as const,

  // Saved scenarios list (year-scoped) — see frontend/src/hooks/useScenarioList.ts
  scenariosList: (year: number) => ['scenarios', 'list', year] as const,

  // Weekend lodging (family camp + adult weekends)
  weekendSessions: (year: number) => ['weekend-sessions', year] as const,
  /** The lander's single batched read: every weekend in a year, with counts. */
  weekendSummary: (year: number) => ['weekend-summary', year] as const,
  /**
   * `scenario` is the empty string for the CampMinder mirror and a
   * `saved_scenarios` id for a draft. It is REQUIRED rather than defaulted:
   * a scenario replaces the mirror (kindred#1974), so a call site that
   * forgot it would read a populated board out of the mirror's cache slot
   * and never refetch — these queries inherit the app default 30 minute
   * staleTime. Making it required puts that mistake in front of tsc.
   */
  weekendRoster: (year: number, sessionCmId: number, scenario: string) =>
    ['weekend-roster', year, sessionCmId, scenario] as const,
  /**
   * The write-in push comparison (kindred#2477): a scenario's write-ins
   * against the live board, for one weekend. `scenario` is required for the
   * same reason `weekendRoster` requires it — there is no meaningful "push
   * preview" for the mirror itself, only for a draft compared against it.
   */
  pushPreview: (year: number, sessionCmId: number, scenario: string) =>
    ['push-preview', year, sessionCmId, scenario] as const,
  // The invalidation prefix. `invalidateLodgingRegistryQueries` knows neither
  // the weekend nor the scenario, and every writer that moves a write-in
  // already goes through it — see the note on this key in that helper.
  pushPreviewPrefix: () => ['push-preview'] as const,
  /**
   * The scenario-vs-CampMinder comparison (kindred#2478 §5): where one
   * family-camp weekend's scenario puts each enrolled family against where
   * the mirror does. `scenario` is required for the same reason
   * `weekendRoster` and `pushPreview` require it — the mirror cannot be
   * compared against itself, and a call site that forgot it would read one
   * scenario's comparison out of another's cache slot.
   */
  scenarioCompare: (year: number, sessionCmId: number, scenario: string) =>
    ['scenario-compare', year, sessionCmId, scenario] as const,
  // Prefixes for invalidation. The lodging admin panels edit registry rows
  // that feed the roster, but know neither the year nor the weekend, so they
  // cannot build a full key — see `invalidateLodgingRegistryQueries`.
  weekendSessionsPrefix: () => ['weekend-sessions'] as const,
  weekendSummaryPrefix: () => ['weekend-summary'] as const,
  weekendRosterPrefix: () => ['weekend-roster'] as const,
  /**
   * Staff-authored friend groups for one weekend (kindred#1913).
   *
   * NO `scenario`, unlike `weekendRoster` directly above, and the asymmetry is
   * the point: migration 1500000146 gives the table no scenario dimension
   * because a group records what households ASKED FOR, which is true of the
   * weekend in every plan for it. A scenario here would mint one cache entry
   * per plan for identical data, and make a group authored in one plan
   * invisible in another.
   */
  weekendFriendGroups: (year: number, sessionCmId: number) =>
    ['weekend-friend-groups', year, sessionCmId] as const,
  /**
   * A household's year-over-year family-camp record (kindred#2073).
   *
   * NO `year`, unlike every other weekend key above, and the asymmetry is the
   * contract rather than an oversight: the journey spans every year the
   * household has a trace in, so it is the SAME document whichever season the
   * board happens to be open on. Adding a year would mint one identical cache
   * entry per season and re-pay a multi-year sweep for nothing.
   */
  householdJourney: (householdCmId: number) => ['household-journey', householdCmId] as const,
  // The invalidation prefix, added by kindred#2332. `invalidateLodgingRegistryQueries`
  // knows no household at all, and the real key carries one.
  householdJourneyPrefix: () => ['household-journey'] as const,
  /** The medical narrative. Only ever fetched behind a `bunking.manage` check. */
  householdMedical: (year: number, householdCmId: number) =>
    ['household-medical', year, householdCmId] as const,

  // Lodging registry (Family Camp admin settings). Year-scoped since
  // migration 1500000141: a unit outlives any one season, but its ROW does
  // not — code is unique only per (code, year), so the cache key must carry
  // the year or a season switch would serve the previous season's rows out
  // of the same slot.
  lodgingAreas: (year: number) => ['lodging-areas', year] as const,
  lodgingUnits: (year: number) => ['lodging-units', year] as const,
  // Aliases are deliberately NOT year-scoped: `valid_from_year` /
  // `valid_to_year` express a rename history spanning seasons, not a
  // per-year row. See lodgingCrud.listLodgingAliases.
  lodgingAliases: () => ['lodging-aliases'] as const,
  /**
   * The ingest work queue is `lodging_ingest_issues`, NOT a separate
   * `lodging_unresolved_aliases` collection — the ingest is its sole producer
   * and carries `kind`, candidate sessions and a suggested session that a
   * narrower collection could not express.
   */
  lodgingIngestIssues: (year: number) => ['lodging-ingest-issues', year] as const,
  // Prefixes for invalidation, mirroring the weekend keys above: a registry
  // edit does not know which season's cache slot a stale reader is on, so
  // `invalidateLodgingRegistryQueries` invalidates every cached year at once
  // rather than threading `year` through every write-mutation call site.
  // The roll-forward preview is keyed on the PAIR of seasons it compares, not
  // on one year, because it answers "what would move from A to B" — two
  // different pairs are two different answers and must not share a slot.
  lodgingRollForwardPreview: (fromYear: number, toYear: number) =>
    ['lodging-roll-forward-preview', fromYear, toYear] as const,
  lodgingAreasPrefix: () => ['lodging-areas'] as const,
  lodgingUnitsPrefix: () => ['lodging-units'] as const,
  lodgingIngestIssuesPrefix: () => ['lodging-ingest-issues'] as const,
  lodgingRollForwardPreviewPrefix: () => ['lodging-roll-forward-preview'] as const,
  /**
   * The admin Sheets tab's workbook list. Not year-keyed: one query returns
   * every workbook and the tab groups them itself. Family Camp roster workbooks
   * are filtered out of it at the query — see `useSheetsWorkbooks`.
   */
  sheetsWorkbooks: () => ['sheets-workbooks'] as const,
  /**
   * The last roster export for one weekend (kindred#2433).
   *
   * A CACHE SLOT, not a fetch. The export is a POST that appends a tab to a
   * Google Sheet, so this key is never fetched and never invalidated — it is
   * written with `setQueryData` and read back through a disabled query.
   * Refetching it would mean exporting again, and every tab in that workbook is
   * hand-edited staff work.
   *
   * Keyed per weekend because each owns its own workbook: one weekend's link
   * shown on another's roster opens the wrong families' contact details.
   */
  rosterExport: (year: number, sessionCmId: number) =>
    ['roster-export', year, sessionCmId] as const,
}

/**
 * Invalidate every React Query key consumed by request-derived UI
 * (alerts, badges, satisfaction marks, graph borders). Call from any
 * mutation handler that changes a `bunk_requests` row.
 *
 * The full inventory of keys is pinned by
 * `frontend/src/hooks/session/__tests__/alert-invalidation.test.ts`, except the
 * post-check key (added in #1607/#1608) which is pinned by its sibling
 * `post-check-invalidation.test.ts`. Adding a new key requires updating this
 * helper and the matching contract test.
 *
 * Pass `includeSourceLinks: true` from merge/split handlers, which
 * additionally rewrite source linkages between rows.
 */
export interface InvalidateRequestQueriesOptions {
  includeSourceLinks?: boolean
}

export function invalidateRequestQueries(
  queryClient: { invalidateQueries: (args: { queryKey: readonly unknown[] }) => unknown },
  options: InvalidateRequestQueriesOptions = {}
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.bunkRequestsPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.allBunkRequestsPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.personBunkRequestsPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.personAllBunkRequestsPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.bunkRequestsTooltipPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.requestSatisfactionPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.cohortRequestRelationsPrefix() })
  // Issue #1040 — social-graph node borders reflect request satisfaction; invalidate
  // so approve/decline/merge/split immediately update the graph's node colours.
  void queryClient.invalidateQueries({ queryKey: queryKeys.socialGraphPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.bunkSocialGraphPrefix() })
  // #1041 — satisfaction endpoint is authoritative; request mutations must refresh it.
  void queryClient.invalidateQueries({ queryKey: queryKeys.satisfactionPrefix() })
  // #1607 / #1608 — post-check report must refresh after any request disposition change.
  void queryClient.invalidateQueries({ queryKey: queryKeys.postCheckPrefix() })
  if (options.includeSourceLinks) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sourceLinksPrefix() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.expandedSourceLinksPrefix() })
  }
}

/**
 * Invalidate everything a lodging-registry edit can change — including the
 * weekend surfaces, which are NOT obvious.
 *
 * The registry is roster input. `_build_units`
 * (`api/services/lodging_roster_service.py:350-419`) projects `name`,
 * `area_name`, `sleeps`, `is_confirmed`, `is_active`, `inventory_class` and
 * `map_x`/`map_y` into the roster payload — every field these admin forms
 * edit. `WeekendRosterPage` links straight to `/manage/lodging/units`, so
 * edit-then-go-back is the designed round trip, not an edge case.
 *
 * This became load-bearing when the weekend queries moved from a 30 second
 * staleTime to the app default of 30 minutes. Previously the round trip
 * self-healed on remount; now nothing refreshes it, so confirming cabins and
 * returning would leave the "N of M cabins have unconfirmed amenities" banner
 * unchanged for half an hour on the screen whose whole purpose is confirmation.
 *
 * The weekend keys MUST be invalidated by prefix: the real keys are
 * `[key, year]` and `[key, year, sessionCmId]`, and an admin panel knows
 * neither, so an exact-key call would match nothing that is cached.
 */
export function invalidateLodgingRegistryQueries(queryClient: {
  invalidateQueries: (args: { queryKey: readonly unknown[] }) => unknown
}): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingUnitsPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingAreasPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingAliases() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingIngestIssuesPrefix() })
  // Every registry write changes what a roll-forward would carry: creating a
  // unit in the target season is precisely what moves a code from
  // units_to_create to skipped_codes. Invalidating here rather than at the
  // one call site is what stops the next writer from missing it.
  void queryClient.invalidateQueries({ queryKey: queryKeys.lodgingRollForwardPreviewPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.weekendRosterPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.weekendSummaryPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.weekendSessionsPrefix() })
  // kindred#2332 put the household journey on this list. It used to carry the
  // staff-written `cabin_assignment` free text, which no registry edit could
  // move; it now carries the unit's PRESENT-DAY `lodging_units.name`, so a
  // rename in the admin panel changes it. `useHouseholdJourney` inherits the
  // 30 minute app default and has no other writer to invalidate against, so
  // without this line the history modal would keep showing the old name while
  // the board behind it shows the new one — the disagreement the issue exists
  // to remove, re-created by the fix for it.
  void queryClient.invalidateQueries({ queryKey: queryKeys.householdJourneyPrefix() })
  // The board's "Push write-ins" badge reads the push preview (owner ruling
  // 2026-08-28: it counts what a push would actually write, which only the
  // server can know — inside a scenario the client never sees the live
  // board's write-ins). That observer stays mounted for as long as the board
  // is open and inherits the app's 30 minute staleTime, so without this line
  // the badge would sit on a number that every write-in edit, merge or unit
  // rename has already moved. `PushWriteInsModal` calls this helper after a
  // push and after an unpush for exactly that reason — it names the pushed
  // occupants from a snapshot taken at push time, not from this query, so
  // refetching under it is safe.
  void queryClient.invalidateQueries({ queryKey: queryKeys.pushPreviewPrefix() })
}

/**
 * 2-Tier Caching Model
 *
 * These two tiers are OPT-INS, not an exhaustive menu. Inheriting the client
 * defaults in `utils/queryClient.ts` is a third, legitimate choice and is what
 * the bunking board's primary read path (`hooks/session/useSessionData.ts`)
 * and the weekend lodging hooks do. Reach for a tier when its semantics fit,
 * not because the constant exists — and note that opting *down* to Tier 2 to
 * catch external edits is usually the wrong trade: invalidate on write instead.
 * See `frontend/CLAUDE.md` and `CLAUDE.md` §4.
 *
 * Tier 1: Sync data (read-only, long cache)
 * - Data synced from CampMinder that rarely changes during a session
 * - Safe to cache for extended periods
 * - Examples: sessions, campers, bunks, historical data
 *
 * Tier 2: User data (short cache, refetch on focus)
 * - Data that users actively edit or that changes frequently
 * - Must stay fresh to prevent stale reads
 * - Examples: bunk_requests, scenarios, locked_groups, sync_status
 */

/**
 * Tier 1: Sync data options - use for CampMinder-synced data
 *
 * Long cache because this data only changes via explicit sync operations.
 * No refetch on window focus to prevent unnecessary API calls.
 */
export const syncDataOptions = {
  staleTime: 60 * 60 * 1000, // 1 hour
  gcTime: 24 * 60 * 60 * 1000, // 24 hours
  refetchOnWindowFocus: false,
} as const

/**
 * Tier 2: User data options - use for user-editable data
 *
 * Short cache because users may edit in multiple tabs or
 * other systems may modify the data.
 * Refetch on window focus to catch external changes.
 */
export const userDataOptions = {
  staleTime: 30 * 1000, // 30 seconds
  gcTime: 5 * 60 * 1000, // 5 minutes
  refetchOnWindowFocus: true,
} as const

// Legacy aliases for backward compatibility
export const heavyQueryOptions = syncDataOptions
export const realtimeQueryOptions = userDataOptions
