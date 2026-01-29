import { ExternalLink, FileSpreadsheet, RefreshCw, AlertCircle, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { useSheetsWorkbooks, useMultiWorkbookExport, type SheetsWorkbook } from '../../hooks/useSheetsWorkbooks';
import { useYear } from '../../hooks/useCurrentYear';

/**
 * SheetsTab - Google Sheets Workbooks Management Tab
 *
 * Displays all Google Sheets workbooks in a unified table with links, status, and export controls.
 * Uses the multi-workbook architecture where:
 * - Globals workbook contains non-year-specific data + master index
 * - Per-year workbooks contain year-specific data
 */

function StatusBadge({ status, errorMessage }: { status: SheetsWorkbook['status']; errorMessage?: string }) {
  const config = {
    ok: {
      icon: CheckCircle,
      label: 'OK',
      classes: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    },
    syncing: {
      icon: Clock,
      label: 'Syncing',
      classes: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
      iconClass: 'animate-pulse',
    },
    error: {
      icon: AlertTriangle,
      label: 'Error',
      classes: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    },
  }[status];

  if (!config) return null;

  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${config.classes}`}
      title={status === 'error' && errorMessage ? errorMessage : undefined}
    >
      <Icon className={`w-3 h-3 ${config.iconClass || ''}`} />
      <span>{config.label}</span>
    </span>
  );
}

function formatDate(dateStr: string) {
  if (!dateStr) return 'Never';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/** Mobile card view for small screens */
function WorkbookMobileCard({ workbook }: { workbook: SheetsWorkbook }) {
  const isGlobals = workbook.workbook_type === 'globals';
  const name = isGlobals ? 'Globals' : String(workbook.year);

  return (
    <a
      href={workbook.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block p-3 rounded-lg border transition-colors hover:border-primary/50 ${
        isGlobals
          ? 'border-l-2 border-l-amber-500 border-border bg-amber-50/30 dark:bg-amber-950/10'
          : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{name}</span>
          <ExternalLink className="w-3 h-3 text-muted-foreground" />
        </div>
        <StatusBadge status={workbook.status} errorMessage={workbook.error_message} />
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{workbook.tab_count} tabs</span>
        <span className="tabular-nums">{workbook.total_records.toLocaleString()} records</span>
        <span className="ml-auto">{formatDate(workbook.last_sync)}</span>
      </div>
    </a>
  );
}

export function SheetsTab() {
  const currentYear = useYear();
  const { data: workbooks, isLoading, error } = useSheetsWorkbooks();
  const multiExport = useMultiWorkbookExport();

  const handleFullExport = () => {
    multiExport.mutate({});
  };

  const handleYearExport = (year: number) => {
    multiExport.mutate({ years: [year], includeGlobals: false });
  };

  // Combine all workbooks: globals first, then years descending
  const sortedWorkbooks = [...(workbooks || [])].sort((a, b) => {
    if (a.workbook_type === 'globals') return -1;
    if (b.workbook_type === 'globals') return 1;
    return b.year - a.year;
  });

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800 p-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load workbooks: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header with Export Buttons */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Google Sheets</h2>
          <p className="text-xs text-muted-foreground">Export data to workbooks</p>
        </div>
        <div className="flex items-center gap-2">
          {currentYear && sortedWorkbooks.some((w) => w.year === currentYear) && (
            <button
              onClick={() => handleYearExport(currentYear)}
              disabled={multiExport.isPending}
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              Export {currentYear}
            </button>
          )}
          <button
            onClick={handleFullExport}
            disabled={multiExport.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-md text-xs font-medium transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${multiExport.isPending ? 'animate-spin' : ''}`} />
            <span>{multiExport.isPending ? 'Exporting...' : 'Full Export'}</span>
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 text-primary animate-spin" />
        </div>
      )}

      {/* No Workbooks State */}
      {!isLoading && workbooks?.length === 0 && (
        <div className="bg-card rounded-lg border border-border p-6 text-center">
          <FileSpreadsheet className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">No workbooks yet</p>
          <button
            onClick={handleFullExport}
            disabled={multiExport.isPending}
            className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs font-medium"
          >
            {multiExport.isPending ? 'Creating...' : 'Create Workbooks'}
          </button>
        </div>
      )}

      {/* Workbooks Table (Desktop) */}
      {!isLoading && sortedWorkbooks.length > 0 && (
        <>
          {/* Desktop table view */}
          <div className="hidden sm:block overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Workbook</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Tabs</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Records</th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">Last Sync</th>
                  <th className="text-center py-2 px-3 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedWorkbooks.map((workbook) => {
                  const isGlobals = workbook.workbook_type === 'globals';
                  const name = isGlobals ? 'Globals' : String(workbook.year);

                  return (
                    <tr
                      key={workbook.id}
                      className={`border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/30 ${
                        isGlobals ? 'border-l-2 border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/10' : ''
                      }`}
                      onClick={() => window.open(workbook.url, '_blank', 'noopener,noreferrer')}
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{name}</span>
                          <ExternalLink className="w-3 h-3 text-muted-foreground" />
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-3 tabular-nums text-muted-foreground">
                        {workbook.tab_count}
                      </td>
                      <td className="text-right py-2.5 px-3 tabular-nums text-muted-foreground">
                        {workbook.total_records.toLocaleString()}
                      </td>
                      <td className="text-right py-2.5 px-3 text-muted-foreground">
                        {formatDate(workbook.last_sync)}
                      </td>
                      <td className="text-center py-2.5 px-3">
                        <StatusBadge status={workbook.status} errorMessage={workbook.error_message} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="sm:hidden space-y-2">
            {sortedWorkbooks.map((workbook) => (
              <WorkbookMobileCard key={workbook.id} workbook={workbook} />
            ))}
          </div>
        </>
      )}

      {/* Help Text */}
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">Full Export</span> updates all workbooks. Click any row to open in Google Sheets.
      </p>
    </div>
  );
}
