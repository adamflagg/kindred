import { useState, useMemo } from 'react'
import { format } from 'date-fns'
import {
  Play,
  Loader2,
  Zap,
  RefreshCw,
  Settings2,
  X,
  ChevronRight,
  ChevronDown,
  Cog,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useYear } from '../../hooks/useCurrentYear'
import { EARLIEST_AVAILABLE_YEAR } from '../../contexts/CurrentYearContext'
import { totalRejected, type SyncStatus, type QueuedSyncItem } from '../../hooks/useSyncStatusAPI'
import { useSyncCompletionToasts } from '../../hooks/useSyncCompletionToasts'
import { useRunIndividualSync } from '../../hooks/useRunIndividualSync'
import { useRunOnDemandSync } from '../../hooks/useRunOnDemandSync'
import { useUnifiedSync } from '../../hooks/useUnifiedSync'
import { useProcessRequests } from '../../hooks/useProcessRequests'
import { useCamperHistorySync } from '../../hooks/useCamperHistorySync'
import { useFamilyCampDerivedSync } from '../../hooks/useFamilyCampDerivedSync'
import { useLodgingAssignmentsSync } from '../../hooks/useLodgingAssignmentsSync'
import { useStaffSkillsSync } from '../../hooks/useStaffSkillsSync'
import { useFinancialAidApplicationsSync } from '../../hooks/useFinancialAidApplicationsSync'
import { useHouseholdDemographicsSync } from '../../hooks/useHouseholdDemographicsSync'
import { useCamperDietarySync } from '../../hooks/useCamperDietarySync'
import { useCamperTransportationSync } from '../../hooks/useCamperTransportationSync'
import { useQuestRegistrationsSync } from '../../hooks/useQuestRegistrationsSync'
import { useStaffApplicationsSync } from '../../hooks/useStaffApplicationsSync'
import { useStaffVehicleInfoSync } from '../../hooks/useStaffVehicleInfoSync'
import { useCancelQueuedSync } from '../../hooks/useCancelQueuedSync'
import { useCancelRunningSync } from '../../hooks/useCancelRunningSync'
import { useRunPhaseSync } from '../../hooks/useRunPhaseSync'
import { StatusIcon, formatDuration } from './ConfigInputs'
import { clearCache } from '../../utils/queryClient'
import ProcessRequestOptions, { type ProcessRequestOptionsState } from './ProcessRequestOptions'
import {
  GLOBAL_SYNC_TYPES,
  CURRENT_YEAR_SYNC_TYPES,
  getYearSyncTypes,
  Globe,
  SYNC_PHASES,
  getSyncTypesByPhase,
  type SyncPhase,
} from './syncTypes'
import clsx from 'clsx'

const ALL_SYNC_TYPES = [...CURRENT_YEAR_SYNC_TYPES, ...GLOBAL_SYNC_TYPES]

/** Gradient arrow connecting pipeline stages */
function PipelineConnector({ gradient }: { gradient: string }) {
  return (
    <div className="text-bark-400 dark:text-bark-600 flex flex-shrink-0 items-center gap-1 px-1">
      <div className={`h-px w-6 bg-gradient-to-r ${gradient}`} />
      <ChevronRight className="h-3 w-3" />
    </div>
  )
}

export function SyncTab() {
  const currentYear = useYear()
  // Unified sync state (replaces separate daily/historical)
  const [syncYear, setSyncYear] = useState(currentYear)
  const [syncService, setSyncService] = useState('all')
  const [includeCustomValues, setIncludeCustomValues] = useState(false)
  const [syncDebug, setSyncDebug] = useState(false)
  const [showProcessOptions, setShowProcessOptions] = useState(false)
  // Phase-based sync mode
  const [syncMode, setSyncMode] = useState<'full' | 'phase'>('full')
  const [selectedPhase, setSelectedPhase] = useState<SyncPhase>('source')
  // Collapsible sections
  const [globalsExpanded, setGlobalsExpanded] = useState(false)
  const [collapsedPhases, setCollapsedPhases] = useState<Set<SyncPhase>>(new Set())

  // Use the completion toasts hook - it wraps useSyncStatusAPI and fires toasts on completion
  const syncStatus = useSyncCompletionToasts()
  const isLoading = !syncStatus
  const runIndividualSync = useRunIndividualSync()
  const runOnDemandSync = useRunOnDemandSync()
  const unifiedSync = useUnifiedSync()
  const processRequests = useProcessRequests()
  const camperHistorySync = useCamperHistorySync()
  const familyCampDerivedSync = useFamilyCampDerivedSync()
  const lodgingAssignmentsSync = useLodgingAssignmentsSync()
  const staffSkillsSync = useStaffSkillsSync()
  const faApplicationsSync = useFinancialAidApplicationsSync()
  const householdDemographicsSync = useHouseholdDemographicsSync()
  const camperDietarySync = useCamperDietarySync()
  const camperTransportationSync = useCamperTransportationSync()
  const questRegistrationsSync = useQuestRegistrationsSync()
  const staffApplicationsSync = useStaffApplicationsSync()
  const staffVehicleInfoSync = useStaffVehicleInfoSync()
  const cancelQueuedSync = useCancelQueuedSync()
  const cancelRunningSync = useCancelRunningSync()
  const runPhaseSync = useRunPhaseSync()

  // One derived "is this card's own type-specific mutation pending" lookup, keyed by
  // syncType.id, instead of a hand-maintained list of `.isPending` references in the disabled
  // condition below. None of these eleven hooks had ever been wired into that condition
  // (#1881), so a double-click on one of their cards could submit a second request before
  // status polling flipped that card to "running". Keying by id means a newly-added per-type
  // mutation hook just needs one entry here, not a new clause at every disabled= call site.
  const typeSyncPendingById: Record<string, boolean> = {
    camper_history: camperHistorySync.isPending,
    family_camp_derived: familyCampDerivedSync.isPending,
    lodging_assignments: lodgingAssignmentsSync.isPending,
    staff_skills: staffSkillsSync.isPending,
    financial_aid_applications: faApplicationsSync.isPending,
    household_demographics: householdDemographicsSync.isPending,
    camper_dietary: camperDietarySync.isPending,
    camper_transportation: camperTransportationSync.isPending,
    quest_registrations: questRegistrationsSync.isPending,
    staff_applications: staffApplicationsSync.isPending,
    staff_vehicle_info: staffVehicleInfoSync.isPending,
  }

  // Get queue from status
  const queue: QueuedSyncItem[] = syncStatus?._queue ?? []
  const hasQueuedItems = queue.length > 0
  const remainingJobs = syncStatus?._current_run?.remaining_jobs ?? []

  // Find the currently running job(s) with their status (includes year)
  const runningJobs = useMemo(() => {
    if (!syncStatus) return []
    const allSyncTypes = ALL_SYNC_TYPES
    return allSyncTypes
      .map((syncType) => {
        const statusValue = syncStatus[syncType.id as keyof typeof syncStatus]
        if (statusValue && typeof statusValue === 'object' && 'status' in statusValue) {
          const status = statusValue
          if (status.status === 'running') {
            return { ...syncType, year: status.year ?? currentYear }
          }
        }
        return null
      })
      .filter((job): job is (typeof allSyncTypes)[number] & { year: number } => job !== null)
  }, [syncStatus, currentYear])

  // Compute available sync types based on year (excludes currentYearOnly types for historical years)
  const availableSyncTypes = useMemo(
    () => getYearSyncTypes(syncYear, currentYear),
    [syncYear, currentYear]
  )

  // Handle year change - reset service if it becomes unavailable
  const handleYearChange = (year: number) => {
    setSyncYear(year)
    // Reset service if it's a current-year-only type and we're switching to historical
    if (
      year !== currentYear &&
      (syncService === 'bunk_requests' || syncService === 'process_requests')
    ) {
      setSyncService('all')
    }
  }

  // Helper to get display name for queue item
  const getQueueItemDisplay = (item: QueuedSyncItem) => {
    if (item.type === 'phase') {
      const phase = SYNC_PHASES.find((p) => p.id === item.service)
      return phase ? `${phase.name} Phase` : item.service
    }
    // Look up friendly name from sync types
    if (item.service === 'all') {
      return 'All Services'
    }
    const allSyncTypes = ALL_SYNC_TYPES
    const syncType = allSyncTypes.find((t) => t.id === item.service)
    return (
      syncType?.name ?? item.service.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner-lodge" />
      </div>
    )
  }

  // Render a sync card for a given sync type
  const renderSyncCard = (syncType: (typeof availableSyncTypes)[number]) => {
    const statusValue = syncStatus[syncType.id as keyof typeof syncStatus]
    const status =
      statusValue && typeof statusValue === 'object' && 'status' in statusValue
        ? statusValue
        : ({ status: 'idle' } satisfies SyncStatus)
    const Icon = syncType.icon
    const isRunning = status.status === 'running'
    const isPending = status.status === 'pending'
    const isTypeSyncPending = typeSyncPendingById[syncType.id] ?? false
    const rejected = totalRejected(status.summary)

    // Determine which hook to use based on sync type
    const handleRun = () => {
      switch (syncType.id) {
        case 'process_requests':
          runIndividualSync.mutate(syncType.id)
          break
        case 'camper_history':
          camperHistorySync.mutate(syncYear)
          break
        case 'family_camp_derived':
          familyCampDerivedSync.mutate(syncYear)
          break
        case 'lodging_assignments':
          lodgingAssignmentsSync.mutate(syncYear)
          break
        case 'staff_skills':
          staffSkillsSync.mutate(syncYear)
          break
        case 'financial_aid_applications':
          faApplicationsSync.mutate(syncYear)
          break
        case 'household_demographics':
          householdDemographicsSync.mutate(syncYear)
          break
        case 'camper_dietary':
          camperDietarySync.mutate(syncYear)
          break
        case 'camper_transportation':
          camperTransportationSync.mutate(syncYear)
          break
        case 'quest_registrations':
          questRegistrationsSync.mutate(syncYear)
          break
        case 'staff_applications':
          staffApplicationsSync.mutate(syncYear)
          break
        case 'staff_vehicle_info':
          staffVehicleInfoSync.mutate(syncYear)
          break
        case 'person_custom_values':
        case 'household_custom_values':
          runOnDemandSync.mutate({
            syncType: syncType.id,
            session: 'all',
            debug: false,
          })
          break
        default:
          runIndividualSync.mutate(syncType.id)
      }
    }

    return (
      <div
        key={syncType.id}
        className="bg-card border-border hover:border-primary/30 flex flex-col rounded-xl border p-4 transition-colors sm:p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className={`h-5 w-5 flex-shrink-0 ${syncType.color}`} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold sm:text-base">{syncType.name}</div>
              {'description' in syncType && (
                <div className="text-muted-foreground truncate text-xs">{syncType.description}</div>
              )}
            </div>
          </div>
          <StatusIcon status={status.status} />
        </div>

        {/* Status info */}
        <div className="min-h-[3rem] flex-1">
          {status.summary && status.status !== 'idle' ? (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs sm:text-sm">
                {status.summary.created > 0 && (
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {status.summary.created} new
                  </span>
                )}
                {status.summary.updated > 0 && (
                  <span className="font-medium text-sky-600 dark:text-sky-400">
                    {status.summary.updated} upd
                  </span>
                )}
                {(status.summary.already_processed ?? 0) > 0 && (
                  <span className="text-muted-foreground">
                    {status.summary.already_processed} skip
                  </span>
                )}
                {(status.summary.skipped || 0) > 0 && (
                  <span className="text-muted-foreground">{status.summary.skipped} skip</span>
                )}
                {status.summary.errors > 0 && (
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {status.summary.errors} err
                  </span>
                )}
                {rejected > 0 && (
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {rejected} rejected
                  </span>
                )}
                {(status.summary.prod_audit_warnings ?? 0) > 0 && (
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {status.summary.prod_audit_warnings} prod⚠
                  </span>
                )}
                {(status.summary.lodging_prod_audit_warnings ?? 0) > 0 && (
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {status.summary.lodging_prod_audit_warnings} lodging⚠
                  </span>
                )}
              </div>
              <div className="text-muted-foreground truncate text-xs sm:text-sm">
                {status.summary.duration !== undefined && formatDuration(status.summary.duration)}
                {status.summary.duration !== undefined && status.end_time && ' · '}
                {status.end_time && format(new Date(status.end_time), 'MMM d, h:mm a')}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-xs sm:text-sm">Not run yet</div>
          )}
        </div>

        {/* Run button - special handling for process_requests */}
        {syncType.id === 'process_requests' ? (
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleRun}
              disabled={isRunning || isPending || runIndividualSync.isPending}
              className="bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors disabled:opacity-50 sm:text-sm"
            >
              {isRunning || isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Play className="h-4 w-4" /> Run
                </>
              )}
            </button>
            <button
              onClick={() => setShowProcessOptions(true)}
              disabled={isRunning || isPending}
              className="flex items-center justify-center rounded-lg bg-teal-100 px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-200 disabled:opacity-50 sm:text-sm dark:bg-teal-900/40 dark:text-teal-300 dark:hover:bg-teal-900/60"
              title="Advanced options"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleRun}
            disabled={
              isRunning ||
              isPending ||
              runIndividualSync.isPending ||
              runOnDemandSync.isPending ||
              isTypeSyncPending
            }
            className="bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors disabled:opacity-50 sm:text-sm"
          >
            {isRunning || isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Play className="h-4 w-4" /> Run
              </>
            )}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Unified Sync Panel */}
      <div className="space-y-2">
        {/* Main Toolbar */}
        <div className="bg-card border-border shadow-lodge-sm overflow-hidden rounded-xl border">
          {/* Controls Row */}
          <div className="flex flex-col gap-4 p-3 sm:p-4 lg:flex-row lg:items-center">
            {/* Selection Group */}
            <div className="bg-muted/50 dark:bg-muted/30 border-border/50 flex items-center gap-2 rounded-xl border p-1.5">
              {/* Mode Toggle */}
              <div className="bg-background flex rounded-lg p-0.5">
                <button
                  onClick={() => setSyncMode('full')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    syncMode === 'full'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  disabled={unifiedSync.isPending || runPhaseSync.isPending}
                >
                  Full
                </button>
                <button
                  onClick={() => setSyncMode('phase')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    syncMode === 'phase'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  disabled={unifiedSync.isPending || runPhaseSync.isPending}
                >
                  Phase
                </button>
              </div>

              <div className="bg-border/50 h-6 w-px" />

              <select
                value={syncYear}
                onChange={(e) => handleYearChange(parseInt(e.target.value))}
                className="bg-background focus:ring-primary/20 min-w-[100px] cursor-pointer rounded-lg border-none px-3 py-2 text-sm font-medium focus:ring-2 focus:outline-none"
                disabled={unifiedSync.isPending || runPhaseSync.isPending}
              >
                <option value={currentYear}>{currentYear}</option>
                {Array.from(
                  { length: currentYear - EARLIEST_AVAILABLE_YEAR },
                  (_, i) => currentYear - 1 - i
                ).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>

              <div className="bg-border/50 h-6 w-px" />

              {syncMode === 'full' ? (
                <select
                  value={syncService}
                  onChange={(e) => {
                    setSyncService(e.target.value)
                    if (e.target.value !== 'all' && e.target.value !== 'persons') {
                      setIncludeCustomValues(false)
                    }
                  }}
                  className="bg-background focus:ring-primary/20 min-w-[140px] cursor-pointer rounded-lg border-none px-3 py-2 text-sm font-medium focus:ring-2 focus:outline-none"
                  disabled={unifiedSync.isPending}
                >
                  <option value="all">All Services</option>
                  {availableSyncTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={selectedPhase}
                  onChange={(e) => setSelectedPhase(e.target.value as SyncPhase)}
                  className="bg-background focus:ring-primary/20 min-w-[140px] cursor-pointer rounded-lg border-none px-3 py-2 text-sm font-medium focus:ring-2 focus:outline-none"
                  disabled={runPhaseSync.isPending}
                >
                  {SYNC_PHASES.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Options Group */}
            <div className="lg:border-border/50 flex items-center gap-4 lg:border-l lg:pl-4">
              {/* Include custom values - only for full mode with all/persons */}
              {syncMode === 'full' && (syncService === 'all' || syncService === 'persons') && (
                <label className="hover:text-foreground flex cursor-pointer items-center gap-2 text-sm transition-colors">
                  <input
                    type="checkbox"
                    checked={includeCustomValues}
                    onChange={(e) => setIncludeCustomValues(e.target.checked)}
                    className="rounded border-gray-300"
                    disabled={unifiedSync.isPending}
                  />
                  <span className="text-muted-foreground">Include CV</span>
                </label>
              )}

              {/* Phase description - only in phase mode */}
              {syncMode === 'phase' && (
                <span className="text-muted-foreground text-sm">
                  {SYNC_PHASES.find((p) => p.id === selectedPhase)?.description}
                </span>
              )}

              {/* Debug - always available */}
              <label className="hover:text-foreground flex cursor-pointer items-center gap-2 text-sm transition-colors">
                <input
                  type="checkbox"
                  checked={syncDebug}
                  onChange={(e) => setSyncDebug(e.target.checked)}
                  className="rounded border-gray-300"
                  disabled={unifiedSync.isPending || runPhaseSync.isPending}
                />
                <span className="text-muted-foreground">Debug</span>
              </label>
            </div>

            {/* Action Group */}
            <div className="flex gap-2 lg:ml-auto">
              {(syncStatus._daily_sync_running ?? syncStatus._historical_sync_running) && (
                <button
                  onClick={() => cancelRunningSync.mutate()}
                  disabled={cancelRunningSync.isPending}
                  className="btn-secondary w-full lg:w-auto"
                  title="Cancel the currently running sync"
                >
                  {cancelRunningSync.isPending ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </>
                  ) : (
                    <>
                      <X className="h-5 w-5" /> Cancel
                    </>
                  )}
                </button>
              )}
              {syncMode === 'full' ? (
                <button
                  onClick={() => {
                    const shouldIncludeCustomValues =
                      includeCustomValues && (syncService === 'all' || syncService === 'persons')
                    unifiedSync.mutate({
                      year: syncYear,
                      service: syncService,
                      includeCustomValues: shouldIncludeCustomValues,
                      debug: syncDebug,
                    })
                  }}
                  disabled={unifiedSync.isPending}
                  className="btn-primary w-full min-w-[130px] lg:w-auto"
                >
                  {unifiedSync.isPending ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" /> Starting...
                    </>
                  ) : (
                    <>
                      <Zap className="h-5 w-5" /> Run Sync
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => {
                    runPhaseSync.mutate({
                      year: syncYear,
                      phase: selectedPhase,
                      debug: syncDebug,
                    })
                  }}
                  disabled={runPhaseSync.isPending}
                  className="btn-primary w-full min-w-[130px] lg:w-auto"
                >
                  {runPhaseSync.isPending ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" /> Starting...
                    </>
                  ) : (
                    <>
                      <Zap className="h-5 w-5" /> Run Phase
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Unified Sync Pipeline - combines queue + currently processing */}
        <div className="flex items-center gap-3">
          {(hasQueuedItems || runningJobs.length > 0) && (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1">
              {/* Currently Processing - forest green theme */}
              {runningJobs.length > 0 && (
                <>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    <Cog className="text-forest-600 dark:text-forest-400 h-4 w-4 animate-[spin_3s_linear_infinite]" />
                    <span className="text-forest-600 dark:text-forest-400 text-xs font-semibold tracking-wide uppercase">
                      Running
                    </span>
                  </div>

                  {/* Running job chips */}
                  {runningJobs.map((job) => {
                    const Icon = job.icon
                    return (
                      <div
                        key={job.id}
                        className={clsx(
                          'flex flex-shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5',
                          'from-forest-100 to-forest-50 dark:from-forest-800/50 dark:to-forest-900/30 bg-gradient-to-r',
                          'border-forest-300 dark:border-forest-700',
                          'shadow-sm'
                        )}
                      >
                        <Loader2 className="text-forest-600 dark:text-forest-400 h-3.5 w-3.5 animate-spin" />
                        <span className="text-forest-800 dark:text-forest-200 text-sm font-medium whitespace-nowrap">
                          <span className="text-forest-600 dark:text-forest-400">{job.year}</span>
                          <span className="text-forest-400 dark:text-forest-600 mx-1.5">·</span>
                          {job.name}
                        </span>
                        <Icon className={`h-3.5 w-3.5 ${job.color}`} />
                      </div>
                    )
                  })}

                  {/* Connector to remaining jobs or queue */}
                  {remainingJobs.length > 0 ? (
                    <PipelineConnector gradient="from-forest-300 to-teal-300 dark:from-forest-700 dark:to-teal-700" />
                  ) : (
                    hasQueuedItems && (
                      <PipelineConnector gradient="from-forest-300 to-amber-300 dark:from-forest-700 dark:to-amber-700" />
                    )
                  )}
                </>
              )}

              {/* Remaining Jobs in Current Sequence - teal theme */}
              {remainingJobs.length > 0 && (
                <>
                  {/* Remaining label with count */}
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-teal-400 dark:bg-teal-500" />
                    <span className="text-xs font-semibold tracking-wide text-teal-600 uppercase dark:text-teal-400">
                      Next ({remainingJobs.length})
                    </span>
                  </div>

                  {/* Job chips - show first 4, then "+N more" */}
                  {remainingJobs.slice(0, 4).map((jobId) => {
                    const syncType = ALL_SYNC_TYPES.find((t) => t.id === jobId)
                    return (
                      <div
                        key={jobId}
                        className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-teal-700 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-300"
                      >
                        <span className="text-xs font-medium">
                          {syncType?.name ?? jobId.replace(/_/g, ' ')}
                        </span>
                      </div>
                    )
                  })}
                  {remainingJobs.length > 4 && (
                    <span className="text-xs font-medium text-teal-600 dark:text-teal-400">
                      +{remainingJobs.length - 4} more
                    </span>
                  )}

                  {/* Connector to external queue if items exist */}
                  {hasQueuedItems && (
                    <PipelineConnector gradient="from-teal-300 to-amber-300 dark:from-teal-700 dark:to-amber-700" />
                  )}
                </>
              )}

              {/* Queued Items - amber theme */}
              {hasQueuedItems && (
                <>
                  {/* Queue label - only show if nothing running */}
                  {runningJobs.length === 0 && (
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400 dark:bg-amber-500" />
                      <span className="text-xs font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                        Queued
                      </span>
                    </div>
                  )}

                  {/* Queue items */}
                  {queue.map((item, index) => (
                    <div key={item.id} className="flex flex-shrink-0 items-center gap-1">
                      <div
                        className={clsx(
                          'group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-all',
                          'bg-gradient-to-r from-amber-50 to-amber-100/50 dark:from-amber-900/30 dark:to-amber-900/10',
                          'border-amber-200 hover:border-amber-300 dark:border-amber-800 dark:hover:border-amber-700'
                        )}
                      >
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-800 tabular-nums dark:bg-amber-800 dark:text-amber-200">
                          {item.position}
                        </span>
                        <span className="text-sm font-medium whitespace-nowrap text-amber-900 dark:text-amber-100">
                          <span className="text-amber-600 dark:text-amber-400">{item.year}</span>
                          <span className="mx-1 text-amber-400 dark:text-amber-600">·</span>
                          {getQueueItemDisplay(item)}
                          {item.include_custom_values && (
                            <span className="ml-1 text-xs text-amber-500 dark:text-amber-500">
                              +CV
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => cancelQueuedSync.mutate(item.id)}
                          disabled={cancelQueuedSync.isPending}
                          className="rounded p-0.5 text-amber-600 opacity-0 transition-all group-hover:opacity-100 hover:bg-amber-200 dark:text-amber-400 dark:hover:bg-amber-800"
                          title="Cancel"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      {index < queue.length - 1 && (
                        <ChevronRight className="h-3 w-3 flex-shrink-0 text-amber-400 dark:text-amber-600" />
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Refresh Cache - right-aligned */}
          <div className="ml-auto flex-shrink-0">
            <button
              onClick={() => {
                clearCache()
                toast.success('Cache cleared - data will refresh', {
                  duration: 3000,
                })
              }}
              className="btn-ghost text-sm"
              title="Clear cached data and force refresh from server"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Cache
            </button>
          </div>
        </div>
      </div>

      {/* Phase-based Sync Types Sections */}
      {SYNC_PHASES.map((phase) => {
        const types = getSyncTypesByPhase(phase.id, syncYear, currentYear)
        if (types.length === 0) return null

        const PhaseIcon = phase.icon
        const isCollapsed = collapsedPhases.has(phase.id)

        const togglePhase = () => {
          setCollapsedPhases((prev) => {
            const next = new Set(prev)
            if (next.has(phase.id)) {
              next.delete(phase.id)
            } else {
              next.add(phase.id)
            }
            return next
          })
        }

        return (
          <div key={phase.id} className="space-y-3">
            {/* Phase header with collapse toggle and "Run Phase" button */}
            <div className="flex items-center justify-between">
              <button
                onClick={togglePhase}
                className="text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
              >
                <ChevronDown
                  className={clsx('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')}
                />
                <PhaseIcon className="h-4 w-4" />
                <span className="text-sm font-medium">{phase.name}</span>
                <span className="text-muted-foreground/70 text-xs">({types.length} jobs)</span>
              </button>
              <button
                onClick={() =>
                  runPhaseSync.mutate({
                    year: syncYear,
                    phase: phase.id,
                    debug: syncDebug,
                  })
                }
                disabled={runPhaseSync.isPending}
                className="bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors"
              >
                {runPhaseSync.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run Phase
              </button>
            </div>

            {/* Consistent grid across all phases - collapsible */}
            {!isCollapsed && (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5">
                {types.map((syncType) => renderSyncCard(syncType))}
              </div>
            )}
          </div>
        )
      })}

      {/* Global Sync Types Section - Collapsible */}
      <div className="border-border/50 mt-6 border-t pt-4">
        <button
          onClick={() => setGlobalsExpanded(!globalsExpanded)}
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 transition-colors"
        >
          <Globe className="h-4 w-4" />
          <span className="text-sm font-medium">Global Definitions</span>
          <span className="text-muted-foreground/70 text-xs">(auto-synced if missing)</span>
          <ChevronDown
            className={clsx(
              'ml-auto h-4 w-4 transition-transform',
              globalsExpanded && 'rotate-180'
            )}
          />
        </button>

        {globalsExpanded && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5">
            {GLOBAL_SYNC_TYPES.map((syncType) => {
              const statusValue = syncStatus[syncType.id as keyof typeof syncStatus]
              const status =
                statusValue && typeof statusValue === 'object' && 'status' in statusValue
                  ? statusValue
                  : ({ status: 'idle' } satisfies SyncStatus)
              const Icon = syncType.icon
              const isRunning = status.status === 'running'
              const isPending = status.status === 'pending'
              const rejected = totalRejected(status.summary)

              return (
                <div
                  key={syncType.id}
                  className="bg-card border-border hover:border-primary/30 flex flex-col rounded-xl border p-4 transition-colors sm:p-5"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className={`h-5 w-5 flex-shrink-0 ${syncType.color}`} />
                      <span className="truncate text-sm font-semibold sm:text-base">
                        {syncType.name}
                      </span>
                    </div>
                    <StatusIcon status={status.status} />
                  </div>

                  {/* Status info */}
                  <div className="min-h-[3rem] flex-1">
                    {status.summary && status.status !== 'idle' ? (
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs sm:text-sm">
                          {status.summary.created > 0 && (
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">
                              {status.summary.created} new
                            </span>
                          )}
                          {status.summary.updated > 0 && (
                            <span className="font-medium text-sky-600 dark:text-sky-400">
                              {status.summary.updated} upd
                            </span>
                          )}
                          {(status.summary.skipped || 0) > 0 && (
                            <span className="text-muted-foreground">
                              {status.summary.skipped} skip
                            </span>
                          )}
                          {status.summary.errors > 0 && (
                            <span className="font-medium text-red-600 dark:text-red-400">
                              {status.summary.errors} err
                            </span>
                          )}
                          {rejected > 0 && (
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                              {rejected} rejected
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground truncate text-xs sm:text-sm">
                          {status.summary.duration !== undefined &&
                            formatDuration(status.summary.duration)}
                          {status.summary.duration !== undefined && status.end_time && ' · '}
                          {status.end_time && format(new Date(status.end_time), 'MMM d, h:mm a')}
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-xs sm:text-sm">Not run yet</div>
                    )}
                  </div>

                  {/* Run button */}
                  <button
                    onClick={() => runIndividualSync.mutate(syncType.id)}
                    disabled={isRunning || isPending || runIndividualSync.isPending}
                    className="bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors disabled:opacity-50 sm:text-sm"
                  >
                    {isRunning || isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Play className="h-4 w-4" /> Run
                      </>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Process Requests Options Modal */}
      <ProcessRequestOptions
        isOpen={showProcessOptions}
        onClose={() => setShowProcessOptions(false)}
        onSubmit={(options: ProcessRequestOptionsState) => {
          processRequests.mutate(options)
          setShowProcessOptions(false)
        }}
        isProcessing={processRequests.isPending}
      />
    </div>
  )
}
