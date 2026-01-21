import { useState } from 'react';
import { format } from 'date-fns';
import {
  Play,
  Loader2,
  Clock3,
  Zap,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import { useYear } from '../../hooks/useCurrentYear';
import { type SyncStatus } from '../../hooks/useSyncStatusAPI';
import { useSyncCompletionToasts } from '../../hooks/useSyncCompletionToasts';
import { useRunIndividualSync } from '../../hooks/useRunIndividualSync';
import { useRunOnDemandSync } from '../../hooks/useRunOnDemandSync';
import { useHistoricalSync } from '../../hooks/useHistoricalSync';
import { useProcessRequests } from '../../hooks/useProcessRequests';
import { StatusIcon, formatDuration } from './ConfigInputs';
import { clearCache } from '../../utils/queryClient';
import ProcessRequestOptions, { type ProcessRequestOptionsState } from './ProcessRequestOptions';
import EntitySyncOptions, { type EntitySyncOptionsState } from './EntitySyncOptions';
import { SYNC_TYPES, HISTORICAL_SYNC_TYPES } from './syncTypes';

// Run all syncs mutation
function useRunAllSyncs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return await pb.send('/api/custom/sync/daily', { method: 'POST' });
    },
    onMutate: () => {
      toast('Starting daily sync...', { icon: '🚀', duration: 3000 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      toast.error(msg.includes('already in progress') ? 'Sync already running' : `Failed: ${msg}`);
    },
  });
}

// Entity types that support custom field values sync option
const ENTITY_SYNC_TYPES = ['persons', 'households'] as const;
type EntitySyncType = typeof ENTITY_SYNC_TYPES[number];

export function SyncTab() {
  const currentYear = useYear();
  const [showHistorical, setShowHistorical] = useState(false);
  const [historicalYear, setHistoricalYear] = useState(currentYear - 1);
  const [historicalService, setHistoricalService] = useState('all');
  const [showProcessOptions, setShowProcessOptions] = useState(false);
  const [entityModalSyncType, setEntityModalSyncType] = useState<EntitySyncType | null>(null);

  // Use the completion toasts hook - it wraps useSyncStatusAPI and fires toasts on completion
  const syncStatus = useSyncCompletionToasts();
  const isLoading = !syncStatus;
  const runIndividualSync = useRunIndividualSync();
  const runOnDemandSync = useRunOnDemandSync();
  const runAllSyncs = useRunAllSyncs();
  const runHistoricalSync = useHistoricalSync();
  const processRequests = useProcessRequests();

  const hasRunningSyncs = syncStatus && Object.values(syncStatus).some(
    (status: SyncStatus) => status.status === 'running'
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner-lodge" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Actions Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <button
          onClick={() => runAllSyncs.mutate()}
          disabled={runAllSyncs.isPending || hasRunningSyncs}
          className="btn-primary text-base"
        >
          {runAllSyncs.isPending ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Starting...</>
          ) : (
            <><Zap className="w-5 h-5" /> Run Daily Sync</>
          )}
        </button>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowHistorical(!showHistorical)}
            className="text-base text-muted-foreground hover:text-foreground flex items-center justify-center sm:justify-start gap-2 font-medium"
          >
            <Clock3 className="w-5 h-5" />
            Historical Import
          </button>
          <button
            onClick={() => {
              clearCache();
              toast.success('Cache cleared - data will refresh', { duration: 3000 });
            }}
            className="text-base text-muted-foreground hover:text-foreground flex items-center justify-center sm:justify-start gap-2 font-medium"
            title="Clear cached data and force refresh from server"
          >
            <RefreshCw className="w-5 h-5" />
            Refresh Data
          </button>
        </div>
      </div>

      {/* Historical Import Panel */}
      {showHistorical && (
        <div className="bg-muted/50 dark:bg-muted/30 rounded-xl p-4 sm:p-5 border border-border">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-stretch sm:items-end">
            <div className="flex-1 sm:flex-none">
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">Year</label>
              <select
                value={historicalYear}
                onChange={(e) => setHistoricalYear(parseInt(e.target.value))}
                className="w-full sm:w-auto px-4 py-2.5 border border-border rounded-lg text-base bg-background text-foreground"
                disabled={runHistoricalSync.isPending}
              >
                {Array.from({ length: currentYear - 2017 }, (_, i) => currentYear - 1 - i).map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 sm:flex-none">
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">Service</label>
              <select
                value={historicalService}
                onChange={(e) => setHistoricalService(e.target.value)}
                className="w-full sm:w-auto px-4 py-2.5 border border-border rounded-lg text-base bg-background text-foreground"
                disabled={runHistoricalSync.isPending}
              >
                <option value="all">All Services</option>
                {HISTORICAL_SYNC_TYPES.map(type => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => runHistoricalSync.mutate({ year: historicalYear, service: historicalService })}
              disabled={runHistoricalSync.isPending || hasRunningSyncs}
              className="px-5 py-2.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-semibold rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/60 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
            >
              {runHistoricalSync.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
              ) : (
                <><Clock3 className="w-4 h-4" /> Import</>
              )}
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-4">Import historical bunking data for enrolled campers.</p>
        </div>
      )}

      {/* Sync Status Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {SYNC_TYPES.map((syncType) => {
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
                    className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-lg disabled:opacity-50 flex items-center justify-center transition-colors ${
                      syncType.id === 'persons'
                        ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/60'
                        : 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60'
                    }`}
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
            // Run the main entity sync
            runIndividualSync.mutate(entityModalSyncType);

            // If custom field values option is enabled, also trigger that sync
            if (options.includeCustomFieldValues) {
              const cfSyncType = entityModalSyncType === 'persons'
                ? 'person_custom_field_values'
                : 'household_custom_field_values';
              runOnDemandSync.mutate({
                syncType: cfSyncType,
                sessionFilter: options.sessionFilter,
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
