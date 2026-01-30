import { useState, useMemo } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Play,
  Loader2,
  Zap,
  RefreshCw,
  Settings2,
  Calendar,
  X,
  Clock,
  ListOrdered,
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
import { useCancelQueuedSync } from '../../hooks/useCancelQueuedSync';
import { useCancelRunningSync } from '../../hooks/useCancelRunningSync';
import { StatusIcon, formatDuration } from './ConfigInputs';
import { clearCache } from '../../utils/queryClient';
import ProcessRequestOptions, { type ProcessRequestOptionsState } from './ProcessRequestOptions';
import EntitySyncOptions, { type EntitySyncOptionsState } from './EntitySyncOptions';
import { GLOBAL_SYNC_TYPES, CURRENT_YEAR_SYNC_TYPES, getYearSyncTypes, Globe } from './syncTypes';

// Entity types that support custom field values sync option
// Note: "persons" is a combined sync that populates persons and households tables
// from a single API call (tags are stored as multi-select relation on persons)
const ENTITY_SYNC_TYPES = ['persons'] as const;
type EntitySyncType = typeof ENTITY_SYNC_TYPES[number];

export function SyncTab() {
  const currentYear = useYear();
  // Unified sync state (replaces separate daily/historical)
  const [syncYear, setSyncYear] = useState(currentYear);
  const [syncService, setSyncService] = useState('all');
  const [includeCustomValues, setIncludeCustomValues] = useState(false);
  const [syncDebug, setSyncDebug] = useState(false);
  const [showProcessOptions, setShowProcessOptions] = useState(false);
  const [entityModalSyncType, setEntityModalSyncType] = useState<EntitySyncType | null>(null);

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
  const cancelQueuedSync = useCancelQueuedSync();
  const cancelRunningSync = useCancelRunningSync();

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner-lodge" />
      </div>
    );
  }

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
              <select
                value={syncYear}
                onChange={(e) => handleYearChange(parseInt(e.target.value))}
                aria-label="Sync year"
                className="px-3 py-2 bg-background border-none rounded-lg text-sm font-medium min-w-[100px] focus:ring-2 focus:ring-primary/20 focus:outline-none cursor-pointer"
                disabled={unifiedSync.isPending}
              >
                <option value={currentYear}>{currentYear}</option>
                {Array.from({ length: currentYear - 2017 }, (_, i) => currentYear - 1 - i).map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>

              <div className="w-px h-6 bg-border/50" />

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
            </div>

            {/* Options Group (conditional) */}
            {(syncService === 'all' || syncService === 'persons') && (
              <div className="flex items-center gap-4 lg:border-l lg:border-border/50 lg:pl-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-foreground transition-colors">
                  <input
                    type="checkbox"
                    checked={includeCustomValues}
                    onChange={(e) => setIncludeCustomValues(e.target.checked)}
                    className="rounded border-gray-300"
                    disabled={unifiedSync.isPending}
                  />
                  <span className="text-muted-foreground">Include custom values</span>
                </label>

                {includeCustomValues && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-foreground transition-colors">
                    <input
                      type="checkbox"
                      checked={syncDebug}
                      onChange={(e) => setSyncDebug(e.target.checked)}
                      className="rounded border-gray-300"
                      disabled={unifiedSync.isPending}
                    />
                    <span className="text-muted-foreground">Debug</span>
                  </label>
                )}
              </div>
            )}

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
              <button
                onClick={() => {
                  const shouldIncludeCustomValues = includeCustomValues &&
                    (syncService === 'all' || syncService === 'persons');
                  unifiedSync.mutate({
                    year: syncYear,
                    service: syncService,
                    includeCustomValues: shouldIncludeCustomValues,
                    debug: shouldIncludeCustomValues && syncDebug,
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
            </div>
          </div>

        </div>

        {/* Queue Panel - shown when items are queued */}
        {hasQueuedItems && (
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ListOrdered className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-amber-800 dark:text-amber-200">
                Sync Queue ({queue.length})
              </span>
            </div>
            <div className="space-y-2">
              {queue.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border border-amber-100 dark:border-amber-900"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 text-xs font-medium">
                      {item.position}
                    </span>
                    <div>
                      <span className="font-medium text-sm">
                        {item.year} - {item.service === 'all' ? 'All Services' : item.service}
                        {item.include_custom_values && ' (+CV)'}
                      </span>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(item.queued_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => cancelQueuedSync.mutate(item.id)}
                    disabled={cancelQueuedSync.isPending}
                    className="p-1.5 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                    title="Cancel queued sync"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Secondary Action */}
        <div className="flex justify-end">
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

      {/* Current Year Sync Types Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span className="text-sm font-medium">Current Year</span>
          <span className="text-xs text-muted-foreground/70">({currentYear})</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {CURRENT_YEAR_SYNC_TYPES.map((syncType) => {
            const statusValue = syncStatus?.[syncType.id as keyof typeof syncStatus];
            const status = (statusValue && typeof statusValue === 'object' && 'status' in statusValue)
              ? statusValue as SyncStatus
              : { status: 'idle' } as SyncStatus;
            const Icon = syncType.icon;
            const isRunning = status.status === 'running';

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

                {/* Status info - grows to fill available space */}
                <div className="flex-1 min-h-[3rem]">
                  {status.summary && status.status !== 'idle' ? (
                    <div className="space-y-1.5">
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
                      {/* Sub-stats for combined syncs (e.g., persons + households) */}
                      {status.summary.sub_stats && Object.keys(status.summary.sub_stats).length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {Object.entries(status.summary.sub_stats).map(([name, subStats]) => (
                            <div key={name} className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                              <span className="capitalize font-medium">{name}:</span>
                              {subStats.created > 0 && <span className="text-emerald-600 dark:text-emerald-400">{subStats.created} new</span>}
                              {subStats.updated > 0 && <span className="text-sky-600 dark:text-sky-400">{subStats.updated} upd</span>}
                              {subStats.skipped > 0 && <span>{subStats.skipped} skip</span>}
                              {subStats.errors > 0 && <span className="text-red-600 dark:text-red-400">{subStats.errors} err</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs sm:text-sm text-muted-foreground">Not run yet</div>
                  )}
                </div>

                {/* Run button always at bottom - special handling for process_requests and entity syncs */}
                {syncType.id === 'process_requests' ? (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => runIndividualSync.mutate(syncType.id)}
                      disabled={isRunning || runIndividualSync.isPending}
                      className="flex-1 py-2 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      {isRunning ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <><Play className="w-4 h-4" /> Run</>
                      )}
                    </button>
                    <button
                      onClick={() => setShowProcessOptions(true)}
                      disabled={isRunning}
                      className="px-3 py-2 text-xs sm:text-sm font-medium rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-900/60 disabled:opacity-50 flex items-center justify-center transition-colors"
                      title="Advanced options"
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : syncType.id === 'camper_history' ? (
                  // Camper history requires year parameter - use selected year from dropdown
                  <button
                    onClick={() => camperHistorySync.mutate(syncYear)}
                    disabled={isRunning || camperHistorySync.isPending}
                    className="w-full py-2 mt-3 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {isRunning ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <><Play className="w-4 h-4" /> Run</>
                    )}
                  </button>
                ) : syncType.id === 'family_camp_derived' ? (
                  // Family camp derived requires year parameter - use selected year from dropdown
                  <button
                    onClick={() => familyCampDerivedSync.mutate(syncYear)}
                    disabled={isRunning || familyCampDerivedSync.isPending}
                    className="w-full py-2 mt-3 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {isRunning ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <><Play className="w-4 h-4" /> Run</>
                    )}
                  </button>
                ) : syncType.id === 'staff_skills' ? (
                  // Staff skills requires year parameter - use selected year from dropdown
                  <button
                    onClick={() => staffSkillsSync.mutate(syncYear)}
                    disabled={isRunning || staffSkillsSync.isPending}
                    className="w-full py-2 mt-3 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {isRunning ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <><Play className="w-4 h-4" /> Run</>
                    )}
                  </button>
                ) : syncType.id === 'financial_aid_applications' ? (
                  // Financial aid applications requires year parameter - use selected year from dropdown
                  <button
                    onClick={() => faApplicationsSync.mutate(syncYear)}
                    disabled={isRunning || faApplicationsSync.isPending}
                    className="w-full py-2 mt-3 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {isRunning ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <><Play className="w-4 h-4" /> Run</>
                    )}
                  </button>
                ) : ENTITY_SYNC_TYPES.includes(syncType.id as EntitySyncType) ? (
                  // Persons/Households - have settings button for custom field values option
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => runIndividualSync.mutate(syncType.id)}
                      disabled={isRunning || runIndividualSync.isPending}
                      className="flex-1 py-2 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      {isRunning ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <><Play className="w-4 h-4" /> Run</>
                      )}
                    </button>
                    <button
                      onClick={() => setEntityModalSyncType(syncType.id as EntitySyncType)}
                      disabled={isRunning}
                      className="px-3 py-2 text-xs sm:text-sm font-medium rounded-lg disabled:opacity-50 flex items-center justify-center transition-colors bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/60"
                      title="Sync options (include custom field values)"
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => runIndividualSync.mutate(syncType.id)}
                    disabled={isRunning || runIndividualSync.isPending}
                    className="w-full py-2 mt-3 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {isRunning ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <><Play className="w-4 h-4" /> Run</>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Global Sync Types Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Globe className="w-4 h-4" />
          <span className="text-sm font-medium">Global Definitions</span>
          <span className="text-xs text-muted-foreground/70">(cross-year)</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {GLOBAL_SYNC_TYPES.map((syncType) => {
            const statusValue = syncStatus?.[syncType.id as keyof typeof syncStatus];
            const status = (statusValue && typeof statusValue === 'object' && 'status' in statusValue)
              ? statusValue as SyncStatus
              : { status: 'idle' } as SyncStatus;
            const Icon = syncType.icon;
            const isRunning = status.status === 'running';

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
                    <div className="space-y-1.5">
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
                  disabled={isRunning || runIndividualSync.isPending}
                  className="w-full py-2 mt-3 text-xs sm:text-sm font-medium rounded-lg bg-muted/50 dark:bg-muted hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                >
                  {isRunning ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <><Play className="w-4 h-4" /> Run</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
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

      {/* Entity Sync Options Modal (Persons/Households with custom field values option) */}
      {entityModalSyncType && (
        <EntitySyncOptions
          isOpen={!!entityModalSyncType}
          onClose={() => setEntityModalSyncType(null)}
          onSubmit={(options: EntitySyncOptionsState) => {
            // Run the combined persons sync (populates persons + households)
            runIndividualSync.mutate(entityModalSyncType);

            // If custom field values option is enabled, also trigger custom field syncs
            // The persons sync populates both persons and households tables,
            // so we sync custom field values for both entity types
            if (options.includeCustomFieldValues) {
              runOnDemandSync.mutate({
                syncType: 'person_custom_values',
                session: options.session,
                debug: options.debug,
              });
              runOnDemandSync.mutate({
                syncType: 'household_custom_values',
                session: options.session,
                debug: options.debug,
              });
            }
            setEntityModalSyncType(null);
          }}
          isProcessing={runIndividualSync.isPending || runOnDemandSync.isPending}
          entityType={entityModalSyncType}
        />
      )}
    </div>
  );
}
