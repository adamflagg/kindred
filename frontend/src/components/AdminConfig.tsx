import { useState } from 'react';
import { Settings, RefreshCw, AlertCircle, Sliders } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { SyncTab } from './admin/SyncTab';
import { ConfigTab } from './admin/ConfigTab';

/**
 * AdminConfig - Main admin control center container
 *
 * This component provides the top-level layout and tab switching for:
 * - Sync Operations: Manage CampMinder data synchronization
 * - Configuration: Adjust optimizer and processing settings
 *
 * The actual functionality is delegated to:
 * - SyncTab: Sync status grid, daily sync, historical imports
 * - ConfigTab: Categorized settings with search, scale context UI
 */
function AdminConfigInner() {
  const [activeTab, setActiveTab] = useState<'sync' | 'config'>('sync');

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-forest-700 to-forest-800 rounded-xl px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="p-1.5 sm:p-2 bg-white/10 rounded-lg">
            <Settings className="h-5 w-5 sm:h-6 sm:w-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-display font-bold text-white">
              Admin Control Center
            </h1>
            <p className="text-forest-200 text-xs sm:text-sm">
              Sync operations and optimizer settings
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 p-1.5 bg-muted/50 dark:bg-muted rounded-lg w-full sm:w-fit">
        <button
          onClick={() => setActiveTab('sync')}
          className={`flex-1 sm:flex-none px-4 sm:px-5 py-2.5 text-sm sm:text-base font-semibold rounded-md transition-colors flex items-center justify-center gap-2 ${
            activeTab === 'sync'
              ? 'bg-card text-forest-800 dark:text-forest-200 shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5" />
          <span className="hidden sm:inline">Sync </span>Operations
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={`flex-1 sm:flex-none px-4 sm:px-5 py-2.5 text-sm sm:text-base font-semibold rounded-md transition-colors flex items-center justify-center gap-2 ${
            activeTab === 'config'
              ? 'bg-card text-forest-800 dark:text-forest-200 shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sliders className="w-4 h-4 sm:w-5 sm:h-5" />
          Configuration
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'sync' ? <SyncTab /> : <ConfigTab />}
    </div>
  );
}

export function AdminConfig() {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="max-w-7xl mx-auto p-4 sm:p-6">
          <div className="bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 dark:border-red-800 p-4 sm:p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-red-800 dark:text-red-200 text-sm sm:text-base">Failed to load Admin Configuration</h3>
                <p className="text-red-600 dark:text-red-400 mt-1 text-sm">{error.message}</p>
                <button
                  onClick={reset}
                  className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 text-sm"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    >
      <AdminConfigInner />
    </ErrorBoundary>
  );
}
