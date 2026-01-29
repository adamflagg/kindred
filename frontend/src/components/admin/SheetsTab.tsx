import { ExternalLink, FileSpreadsheet, RefreshCw, AlertCircle, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { useSheetsWorkbooks, useMultiWorkbookExport, type SheetsWorkbook } from '../../hooks/useSheetsWorkbooks';
import { useYear } from '../../hooks/useCurrentYear';

/**
 * SheetsTab - Google Sheets Workbooks Management Tab
 *
 * Displays all Google Sheets workbooks with links, status, and export controls.
 * Uses the multi-workbook architecture where:
 * - Globals workbook contains non-year-specific data + master index
 * - Per-year workbooks contain year-specific data
 */

function WorkbookCard({ workbook }: { workbook: SheetsWorkbook }) {
  const getStatusIcon = () => {
    switch (workbook.status) {
      case 'ok':
        return <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />;
      case 'syncing':
        return <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-pulse" />;
      case 'error':
        return <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />;
      default:
        return null;
    }
  };

  const getStatusBadge = () => {
    switch (workbook.status) {
      case 'ok':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
            {getStatusIcon()}
            <span>OK</span>
          </span>
        );
      case 'syncing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
            {getStatusIcon()}
            <span>Syncing</span>
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
            {getStatusIcon()}
            <span>Error</span>
          </span>
        );
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Never';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const yearDisplay = workbook.workbook_type === 'globals' ? 'Globals' : workbook.year;
  // Extract short name from title (e.g., "Kindred 2026" -> "2026", "Kindred Globals" -> "Globals")
  const shortName = workbook.workbook_type === 'globals' ? 'Globals' : String(workbook.year);

  return (
    <div className="bg-card rounded-xl border border-border p-3 sm:p-4 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 bg-primary/10 rounded-md flex-shrink-0">
            <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">{shortName}</h3>
            <p className="text-xs text-muted-foreground truncate" title={workbook.title}>
              {yearDisplay === 'Globals' ? 'Global definitions + Index' : `Year data`}
            </p>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      {/* Stats Row */}
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-3 px-1">
        <span>{workbook.tab_count} tabs</span>
        <span className="tabular-nums">{workbook.total_records.toLocaleString()} records</span>
        <span className="text-right">{formatDate(workbook.last_sync)}</span>
      </div>

      {/* Error Message */}
      {workbook.status === 'error' && workbook.error_message && (
        <div className="mb-2 p-1.5 bg-red-50 dark:bg-red-950/30 rounded text-xs text-red-600 dark:text-red-400 truncate" title={workbook.error_message}>
          {workbook.error_message}
        </div>
      )}

      {/* Open Button */}
      <a
        href={workbook.url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-md text-xs font-medium transition-colors"
      >
        <span>Open</span>
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
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

  // Separate globals and year workbooks
  const globalsWorkbook = workbooks?.find((w) => w.workbook_type === 'globals');
  const yearWorkbooks = workbooks?.filter((w) => w.workbook_type === 'year').sort((a, b) => b.year - a.year) || [];

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
      {/* Header with Export Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Google Sheets</h2>
          <p className="text-xs text-muted-foreground">Export data to workbooks</p>
        </div>
        <button
          onClick={handleFullExport}
          disabled={multiExport.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-md text-xs font-medium transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${multiExport.isPending ? 'animate-spin' : ''}`} />
          <span>{multiExport.isPending ? 'Exporting...' : 'Full Export'}</span>
        </button>
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

      {/* Globals Workbook */}
      {globalsWorkbook && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            Global Data
          </h3>
          <div className="max-w-xs">
            <WorkbookCard workbook={globalsWorkbook} />
          </div>
        </section>
      )}

      {/* Year Workbooks */}
      {yearWorkbooks.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Year Workbooks
            </h3>
            {currentYear && (
              <button
                onClick={() => handleYearExport(currentYear)}
                disabled={multiExport.isPending}
                className="text-xs text-primary hover:text-primary/80 font-medium"
              >
                Export {currentYear} Only
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {yearWorkbooks.map((workbook) => (
              <WorkbookCard key={workbook.id} workbook={workbook} />
            ))}
          </div>
        </section>
      )}

      {/* Help Text */}
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">Full Export</span> updates all workbooks. Global workbook includes an Index with links to all sheets.
      </p>
    </div>
  );
}
