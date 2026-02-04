import { useState, useMemo } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Play,
  Loader2,
  Zap,
  RefreshCw,
  Settings2,
  X,
  Clock,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useYear } from '../../hooks/useCurrentYear';
import { type SyncStatus, type QueuedSyncItem } from '../../hooks/useSyncStatusAPI';
import { useSyncCompletionToasts } from '../../hooks/useSyncCompletionToasts';
import { useRunIndividualSync } from '../../hooks/useRunIndividualSync';
import { useRunOnDemandSync } from '../../hooks/useRunOnDemandSync';
import { useUnifiedSync } from '../../hooks/useUnifiedSync';
import { useProcessRequests } from '../../hooks/useProcessRequests';
import { useCamperHistorySync } from '../../hooks/useCamperHistorySync';
import { useFamilyCampDerivedSync } from '../../hooks/useFamilyCampDerivedSync';
import { useStaffSkillsSync } from '../../hooks/useStaffSkillsSync';
import { useFinancialAidApplicationsSync } from '../../hooks/useFinancialAidApplicationsSync';
import { useHouseholdDemographicsSync } from '../../hooks/useHouseholdDemographicsSync';
import { useCamperDietarySync } from '../../hooks/useCamperDietarySync';
import { useCamperTransportationSync } from '../../hooks/useCamperTransportationSync';
import { useQuestRegistrationsSync } from '../../hooks/useQuestRegistrationsSync';
import { useStaffApplicationsSync } from '../../hooks/useStaffApplicationsSync';
import { useStaffVehicleInfoSync } from '../../hooks/useStaffVehicleInfoSync';
import { useCancelQueuedSync } from '../../hooks/useCancelQueuedSync';
import { useCancelRunningSync } from '../../hooks/useCancelRunningSync';
import { useRunPhaseSync } from '../../hooks/useRunPhaseSync';
import { StatusIcon, formatDuration } from './ConfigInputs';
import { clearCache } from '../../utils/queryClient';
import ProcessRequestOptions, { type ProcessRequestOptionsState } from './ProcessRequestOptions';
import { GLOBAL_SYNC_TYPES, getYearSyncTypes, Globe, SYNC_PHASES, getSyncTypesByPhase, type SyncPhase } from './syncTypes';
import clsx from 'clsx';

export function SyncTab() {
  const currentYear = useYear();
  // Unified sync state (replaces separate daily/historical)
  const [syncYear, setSyncYear] = useState(currentYear);
  const [syncService, setSyncService] = useState('all');
  const [includeCustomValues, setIncludeCustomValues] = useState(false);
  const [syncDebug, setSyncDebug] = useState(false);
  const [showProcessOptions, setShowProcessOptions] = useState(false);
  // Phase-based sync mode
  const [syncMode, setSyncMode] = useState<'full' | 'phase'>('full');
  const [selectedPhase, setSelectedPhase] = useState<SyncPhase>('source');
  // Collapsible sections
  const [globalsExpanded, setGlobalsExpanded] = useState(false);
  const [collapsedPhases, setCollapsedPhases] = useState<Set<SyncPhase>>(new Set());

  // Use the completion toasts hook - it wraps useSyncStatusAPI and fires toasts on completion
  const syncStatus = useSyncCompletionToasts();
  const isLoading = !syncStatus;
  const runIndividualSync = useRunIndividualSync();
  const runOnDemandSync = useRunOnDemandSync();
  const unifiedSync = useUnifiedSync();
  const processRequests = useProcessRequests();
  const camperHistorySync = useCamperHistorySync();
  const familyCampDerivedSync = useFamilyCampDerivedSync();
  const staffSkillsSync = useStaffSkillsSync();
  const faApplicationsSync = useFinancialAidApplicationsSync();
  const householdDemographicsSync = useHouseholdDemographicsSync();
  const camperDietarySync = useCamperDietarySync();
  const camperTransportationSync = useCamperTransportationSync();
  const questRegistrationsSync = useQuestRegistrationsSync();
  const staffApplicationsSync = useStaffApplicationsSync();
  const staffVehicleInfoSync = useStaffVehicleInfoSync();
  const cancelQueuedSync = useCancelQueuedSync();
  const cancelRunningSync = useCancelRunningSync();
  const runPhaseSync = useRunPhaseSync();

  // Get queue from status
  const queue: QueuedSyncItem[] = syncStatus?._queue || [];
  const hasQueuedItems = queue.length > 0;

  // Compute available sync types based on year (excludes currentYearOnly types for historical years)
  const availableSyncTypes = useMemo(() =>
    getYearSyncTypes(syncYear, currentYear),
    [syncYear, currentYear]
  );

  // Handle year change - reset service if it becomes unavailable
  const handleYearChange = (year: number) => {
    setSyncYear(year);
    // Reset service if it's a current-year-only type and we're switching to historical
    if (year !== currentYear &&
        (syncService === 'bunk_requests' || syncService === 'process_requests')) {
      setSyncService('all');
    }
  };

  // Helper to get display name for queue item
  const getQueueItemDisplay = (item: QueuedSyncItem) => {
    if (item.type === 'phase') {
      const phase = SYNC_PHASES.find(p => p.id === item.service);
      return phase ? `${phase.name} Phase` : item.service;
    }
    if (item.type === 'individual') {
      return item.service.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    // unified
    return item.service === 'all' ? 'All Services' : item.service;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner-lodge" />
      </div>
    );
  }

  // Render a sync card for a given sync type
  const renderSyncCard = (syncType: typeof availableSyncTypes[number]) => {
    const statusValue = syncStatus?.[syncType.id as keyof typeof syncStatus];
    const status = (statusValue && typeof statusValue === 'object' && 'status' in statusValue)
      ? statusValue as SyncStatus
      : { status: 'idle' } as SyncStatus;
    const Icon = syncType.icon;
    const isRunning = status.status === 'running';
    const isPending = status.status === 'pending';

    // Determine which hook to use based on sync type
    const handleRun = () => {
      switch (syncType.id) {
        case 'process_requests':
          runIndividualSync.mutate(syncType.id);
          break;
        case 'camper_history':
          camperHistorySync.mutate(syncYear);
          break;
        case 'family_camp_derived':
          familyCampDerivedSync.mutate(syncYear);
          break;
        case 'staff_skills':
          staffSkillsSync.mutate(syncYear);
          break;
        case 'financial_aid_applications':
          faApplicationsSync.mutate(syncYear);
          break;
        case 'household_demographics':
          householdDemographicsSync.mutate(syncYear);
          break;
        case 'camper_dietary':
          camperDietarySync.mutate(syncYear);
          break;
        case 'camper_transportation':
          camperTransportationSync.mutate(syncYear);
          break;
        case 'quest_registrations':
          questRegistrationsSync.mutate(syncYear);
          break;
        case 'staff_applications':
          staffApplicationsSync.mutate(syncYear);
          break;
        case 'staff_vehicle_info':
          staffVehicleInfoSync.mutate(syncYear);
          break;
        case 'person_custom_values':
        case 'household_custom_values':
          runOnDemandSync.mutate({
            syncType: syncType.id,
            session: 'all',
            debug: false,
          });
          break;
        default:
          runIndividualSync.mutate(syncType.id);
      }
    };

    return (
      <div
        key={syncType.id}
        className="bg-card rounded-xl border border-border p-4 sm:p-5 hover:border-primary/30 transition-colors flex flex-col"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`w-5 h-5 flex-shrink-0 ${syncType.color}`} />
            <span className="font-semibold text-sm sm:text-base truncate">{syncType.name}</span>
          </div>
          <StatusIcon status={status.status} />
        </div>

        {/* Status info */}
        <div className="flex-1 min-h-[3rem]">
          {status.summary && status.status !== 'idle' ? (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs sm:text-sm">
                {status.summary.created > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">{status.summary.created} new</span>
                )}
                {status.summary.updated > 0 && (
                  <span className="text-sky-600 dark:text-sky-400 font-medium">{status.summary.updated} upd</span>
                )}
                {(status.summary.already_processed || 0) > 0 && (
                  <span className="text-muted-foreground">{status.summary.already_processed} done</span>
                )}
                {(status.summary.skipped || 0) > 0 && (
                  <span className="text-muted-foreground">{status.summary.skipped} skip</span>
                )}
                {status.summary.errors > 0 && (
                  <span className="text-red-600 dark:text-red-400 font-medium">{status.summary.errors} err</span>
                )}
              </div>
              <div className="text-muted-foreground text-xs sm:text-sm truncate">
                {status.summary.duration !== undefined && formatDuration(status.summary.duration)}
                {status.summary.duration !== undefined && status.end_time && ' · '}
                {status.end_time && format(new Date(status.end_time), 'MMM d, h:mm a')}
              </div>
            </div>
          ) : (
            <div className="text-xs sm:text-sm text-muted-foreground">Not run yet</div>
          )}
        </div>

        {/* Run button - special handling for process_requests */}
        {syncType.id === 'process_requests' ? (
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleRun}
              disabled={isRunning || isPending || runIndividualSync.isPending}
              className="flex-1 py-2 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
            >
              {isRunning || isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <><Play className="w-4 h-4" /> Run</>
              )}
            </button>
            <button
              onClick={() => setShowProcessOptions(true)}
              disabled={isRunning || isPending}
              className="px-3 py-2 text-xs sm:text-sm font-medium rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-900/60 disabled:opacity-50 flex items-center justify-center transition-colors"
              title="Advanced options"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleRun}
            disabled={isRunning || isPending || runIndividualSync.isPending || runOnDemandSync.isPending}
            className="w-full py-2 mt-3 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
          >
            {isRunning || isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <><Play className="w-4 h-4" /> Run</>
            )}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Unified Sync Panel */}
      <div className="space-y-2">
        {/* Main Toolbar */}
        <div className="bg-card rounded-xl border border-border shadow-lodge-sm overflow-hidden">
          {/* Controls Row */}
          <div className="p-3 sm:p-4 flex flex-col lg:flex-row gap-4 lg:items-center">

            {/* Selection Group */}
            <div className="flex items-center gap-2 bg-muted/50 dark:bg-muted/30 rounded-xl p-1.5 border border-border/50">
              {/* Mode Toggle */}
              <div className="flex rounded-lg bg-background p-0.5">
                <button
                  onClick={() => setSyncMode('full')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    syncMode === 'phase'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  disabled={unifiedSync.isPending || runPhaseSync.isPending}
                >
                  Phase
                </button>
              </div>

              <div className="w-px h-6 bg-border/50" />

              <select
                value={syncYear}
                onChange={(e) => handleYearChange(parseInt(e.target.value))}
                aria-label="Sync year"
                className="px-3 py-2 bg-background border-none rounded-lg text-sm font-medium min-w-[100px] focus:ring-2 focus:ring-primary/20 focus:outline-none cursor-pointer"
                disabled={unifiedSync.isPending || runPhaseSync.isPending}
              >
                <option value={currentYear}>{currentYear}</option>
                {Array.from({ length: currentYear - 2017 }, (_, i) => currentYear - 1 - i).map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>

              <div className="w-px h-6 bg-border/50" />

              {syncMode === 'full' ? (
                <select
                  value={syncService}
                  onChange={(e) => {
                    setSyncService(e.target.value);
                    if (e.target.value !== 'all' && e.target.value !== 'persons') {
                      setIncludeCustomValues(false);
                    }
                  }}
                  aria-label="Sync service"
                  className="px-3 py-2 bg-background border-none rounded-lg text-sm font-medium min-w-[140px] focus:ring-2 focus:ring-primary/20 focus:outline-none cursor-pointer"
                  disabled={unifiedSync.isPending}
                >
                  <option value="all">All Services</option>
                  {availableSyncTypes.map(type => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              ) : (
                <select
                  value={selectedPhase}
                  onChange={(e) => setSelectedPhase(e.target.value as SyncPhase)}
                  aria-label="Sync phase"
                  className="px-3 py-2 bg-background border-none rounded-lg text-sm font-medium min-w-[140px] focus:ring-2 focus:ring-primary/20 focus:outline-none cursor-pointer"
                  disabled={runPhaseSync.isPending}
                >
                  {SYNC_PHASES.map(phase => (
                    <option key={phase.id} value={phase.id}>{phase.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Options Group */}
            <div className="flex items-center gap-4 lg:border-l lg:border-border/50 lg:pl-4">
              {/* Include custom values - only for full mode with all/persons */}
              {syncMode === 'full' && (syncService === 'all' || syncService === 'persons') && (
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-foreground transition-colors">
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
                <span className="text-sm text-muted-foreground">
                  {SYNC_PHASES.find(p => p.id === selectedPhase)?.description}
                </span>
              )}

              {/* Debug - always available */}
              <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-foreground transition-colors">
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
            <div className="lg:ml-auto flex gap-2">
              {(syncStatus?._daily_sync_running || syncStatus?._historical_sync_running) && (
                <button
                  onClick={() => cancelRunningSync.mutate()}
                  disabled={cancelRunningSync.isPending}
                  className="btn-secondary w-full lg:w-auto"
                  title="Cancel the currently running sync"
                >
                  {cancelRunningSync.isPending ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /></>
                  ) : (
                    <><X className="w-5 h-5" /> Cancel</>
                  )}
                </button>
              )}
              {syncMode === 'full' ? (
                <button
                  onClick={() => {
                    const shouldIncludeCustomValues = includeCustomValues &&
                      (syncService === 'all' || syncService === 'persons');
                    unifiedSync.mutate({
                      year: syncYear,
                      service: syncService,
                      includeCustomValues: shouldIncludeCustomValues,
                      debug: syncDebug,
                    });
                  }}
                  disabled={unifiedSync.isPending}
                  className="btn-primary w-full lg:w-auto min-w-[130px]"
                >
                  {unifiedSync.isPending ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Starting...</>
                  ) : (
                    <><Zap className="w-5 h-5" /> Run Sync</>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => {
                    runPhaseSync.mutate({
                      year: syncYear,
                      phase: selectedPhase,
                      debug: syncDebug,
                    });
                  }}
                  disabled={runPhaseSync.isPending}
                  className="btn-primary w-full lg:w-auto min-w-[130px]"
                >
                  {runPhaseSync.isPending ? (
                    <><Loader2 className="w-5 h-5 animate-spin" /> Starting...</>
                  ) : (
                    <><Zap className="w-5 h-5" /> Run Phase</>
                  )}
                </button>
              )}
            </div>
          </div>

        </div>

        {/* Queue Pipeline + Refresh Cache Row */}
        <div className="flex items-center gap-4">
          {/* Assembly Line Queue - horizontal pipeline visualization */}
          {hasQueuedItems && (
            <div className="flex items-center gap-1 overflow-x-auto py-1 max-w-[calc(100%-140px)]">
              {/* Pipeline start indicator */}
              <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 flex-shrink-0">
                <div className="w-2 h-2 rounded-full bg-amber-400 dark:bg-amber-500 animate-pulse" />
                <span className="text-xs font-medium tracking-wide uppercase">Queue</span>
                <ChevronRight className="w-4 h-4 opacity-60" />
              </div>

              {/* Queue items as pipeline stages */}
              {queue.map((item, index) => (
                <div key={item.id} className="flex items-center gap-1 flex-shrink-0">
                  <div
                    className={clsx(
                      "group relative flex items-center gap-2 px-3 py-2 rounded-lg border transition-all",
                      "bg-gradient-to-r from-amber-50 to-amber-100/50 dark:from-amber-900/30 dark:to-amber-900/10",
                      "border-amber-200 dark:border-amber-800 hover:border-amber-300 dark:hover:border-amber-700",
                      "shadow-sm hover:shadow-md"
                    )}
                  >
                    {/* Position badge */}
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 text-xs font-bold tabular-nums">
                      {item.position}
                    </span>

                    {/* Item details */}
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-sm text-amber-900 dark:text-amber-100 whitespace-nowrap">
                        {item.year} · {getQueueItemDisplay(item)}
                        {item.include_custom_values && <span className="text-amber-600 dark:text-amber-400 ml-1">+CV</span>}
                      </span>
                      <span className="text-xs text-amber-600/70 dark:text-amber-400/70 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(item.queued_at), { addSuffix: true })}
                      </span>
                    </div>

                    {/* Cancel button - appears on hover */}
                    <button
                      onClick={() => cancelQueuedSync.mutate(item.id)}
                      disabled={cancelQueuedSync.isPending}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-800 transition-all"
                      title="Cancel queued sync"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Connector arrow between items */}
                  {index < queue.length - 1 && (
                    <ChevronRight className="w-4 h-4 text-amber-400 dark:text-amber-600 flex-shrink-0" />
                  )}
                </div>
              ))}

              {/* Pipeline end - processing indicator */}
              <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 flex-shrink-0 pl-1">
                <ChevronRight className="w-4 h-4 opacity-60" />
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            </div>
          )}

          {/* Refresh Cache - right-aligned */}
          <div className="ml-auto flex-shrink-0">
            <button
              onClick={() => {
                clearCache();
                toast.success('Cache cleared - data will refresh', { duration: 3000 });
              }}
              className="btn-ghost text-sm"
              title="Clear cached data and force refresh from server"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Cache
            </button>
          </div>
        </div>
      </div>

      {/* Phase-based Sync Types Sections */}
      {SYNC_PHASES.map((phase) => {
        const types = getSyncTypesByPhase(phase.id, syncYear, currentYear);
        if (types.length === 0) return null;

        const PhaseIcon = phase.icon;
        const isCollapsed = collapsedPhases.has(phase.id);

        const togglePhase = () => {
          setCollapsedPhases(prev => {
            const next = new Set(prev);
            if (next.has(phase.id)) {
              next.delete(phase.id);
            } else {
              next.add(phase.id);
            }
            return next;
          });
        };

        return (
          <div key={phase.id} className="space-y-3">
            {/* Phase header with collapse toggle and "Run Phase" button */}
            <div className="flex items-center justify-between">
              <button
                onClick={togglePhase}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className={clsx(
                  "w-4 h-4 transition-transform",
                  isCollapsed && "-rotate-90"
                )} />
                <PhaseIcon className="w-4 h-4" />
                <span className="text-sm font-medium">{phase.name}</span>
                <span className="text-xs text-muted-foreground/70">({types.length} jobs)</span>
              </button>
              <button
                onClick={() => runPhaseSync.mutate({ year: syncYear, phase: phase.id, debug: syncDebug })}
                disabled={runPhaseSync.isPending}
                className="text-sm px-4 py-2 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                {runPhaseSync.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Run Phase
              </button>
            </div>

            {/* Consistent grid across all phases - collapsible */}
            {!isCollapsed && (
              <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-4 xl:grid-cols-5">
                {types.map(syncType => renderSyncCard(syncType))}
              </div>
            )}
          </div>
        );
      })}

      {/* Global Sync Types Section - Collapsible */}
      <div className="mt-6 pt-4 border-t border-border/50">
        <button
          onClick={() => setGlobalsExpanded(!globalsExpanded)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <Globe className="w-4 h-4" />
          <span className="text-sm font-medium">Global Definitions</span>
          <span className="text-xs text-muted-foreground/70">(auto-synced if missing)</span>
          <ChevronDown className={clsx(
            "w-4 h-4 ml-auto transition-transform",
            globalsExpanded && "rotate-180"
          )} />
        </button>

        {globalsExpanded && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 mt-3">
            {GLOBAL_SYNC_TYPES.map((syncType) => {
              const statusValue = syncStatus?.[syncType.id as keyof typeof syncStatus];
              const status = (statusValue && typeof statusValue === 'object' && 'status' in statusValue)
                ? statusValue as SyncStatus
                : { status: 'idle' } as SyncStatus;
              const Icon = syncType.icon;
              const isRunning = status.status === 'running';
              const isPending = status.status === 'pending';

              return (
                <div
                  key={syncType.id}
                  className="bg-card rounded-xl border border-border p-4 sm:p-5 hover:border-primary/30 transition-colors flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className={`w-5 h-5 flex-shrink-0 ${syncType.color}`} />
                      <span className="font-semibold text-sm sm:text-base truncate">{syncType.name}</span>
                    </div>
                    <StatusIcon status={status.status} />
                  </div>

                  {/* Status info */}
                  <div className="flex-1 min-h-[3rem]">
                    {status.summary && status.status !== 'idle' ? (
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs sm:text-sm">
                          {status.summary.created > 0 && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{status.summary.created} new</span>
                          )}
                          {status.summary.updated > 0 && (
                            <span className="text-sky-600 dark:text-sky-400 font-medium">{status.summary.updated} upd</span>
                          )}
                          {(status.summary.skipped || 0) > 0 && (
                            <span className="text-muted-foreground">{status.summary.skipped} skip</span>
                          )}
                          {status.summary.errors > 0 && (
                            <span className="text-red-600 dark:text-red-400 font-medium">{status.summary.errors} err</span>
                          )}
                        </div>
                        <div className="text-muted-foreground text-xs sm:text-sm truncate">
                          {status.summary.duration !== undefined && formatDuration(status.summary.duration)}
                          {status.summary.duration !== undefined && status.end_time && ' · '}
                          {status.end_time && format(new Date(status.end_time), 'MMM d, h:mm a')}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs sm:text-sm text-muted-foreground">Not run yet</div>
                    )}
                  </div>

                  {/* Run button */}
                  <button
                    onClick={() => runIndividualSync.mutate(syncType.id)}
                    disabled={isRunning || isPending || runIndividualSync.isPending}
                    className="w-full py-2 mt-3 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {isRunning || isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <><Play className="w-4 h-4" /> Run</>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Process Requests Options Modal */}
      <ProcessRequestOptions
        isOpen={showProcessOptions}
        onClose={() => setShowProcessOptions(false)}
        onSubmit={(options: ProcessRequestOptionsState) => {
          processRequests.mutate(options);
          setShowProcessOptions(false);
        }}
        isProcessing={processRequests.isPending}
      />
    </div>
  );
}
