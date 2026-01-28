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

  return (
    <div className="bg-card rounded-xl border border-border p-4 sm:p-5 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 bg-primary/10 rounded-lg flex-shrink-0">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground truncate">{workbook.title}</h3>
            <p className="text-sm text-muted-foreground">
              {yearDisplay === 'Globals' ? 'Global Data + Index' : `Year ${yearDisplay}`}
            </p>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
        <div>
          <span className="text-muted-foreground">Tabs</span>
          <p className="font-medium">{workbook.tab_count}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Records</span>
          <p className="font-medium">{workbook.total_records.toLocaleString()}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Last Sync</span>
          <p className="font-medium text-xs">{formatDate(workbook.last_sync)}</p>
        </div>
      </div>

      {/* Error Message */}
      {workbook.status === 'error' && workbook.error_message && (
        <div className="mb-3 p-2 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
          <p className="text-xs text-red-600 dark:text-red-400">{workbook.error_message}</p>
        </div>
      )}

      {/* Open Button */}
      <a
        href={workbook.url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg font-medium text-sm transition-colors"
      >
        <span>Open in Google Sheets</span>
        <ExternalLink className="w-4 h-4" />
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
      <div className="bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 dark:border-red-800 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-display font-bold text-red-800 dark:text-red-200">Failed to load workbooks</h3>
            <p className="text-red-600 dark:text-red-400 mt-1 text-sm">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header with Export Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-display font-bold text-foreground">
            Google Sheets Workbooks
          </h2>
          <p className="text-muted-foreground text-sm">
            Export data to multiple Google Sheets workbooks
          </p>
        </div>
        <button
          onClick={handleFullExport}
          disabled={multiExport.isPending}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg font-medium text-sm transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${multiExport.isPending ? 'animate-spin' : ''}`} />
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
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <FileSpreadsheet className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display font-bold text-lg mb-2">No Workbooks Found</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Run a full export to create workbooks for your data.
          </p>
          <button
            onClick={handleFullExport}
            disabled={multiExport.isPending}
            className="btn btn-primary"
          >
            {multiExport.isPending ? 'Creating...' : 'Create Workbooks'}
          </button>
        </div>
      )}

      {/* Globals Workbook */}
      {globalsWorkbook && (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Master Index & Global Data
          </h3>
          <div className="max-w-md">
            <WorkbookCard workbook={globalsWorkbook} />
          </div>
        </section>
      )}

      {/* Year Workbooks */}
      {yearWorkbooks.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {yearWorkbooks.map((workbook) => (
              <WorkbookCard key={workbook.id} workbook={workbook} />
            ))}
          </div>
        </section>
      )}

      {/* Help Text */}
      <div className="bg-muted/50 dark:bg-muted rounded-lg p-4 text-sm text-muted-foreground">
        <p>
          <strong>Full Export</strong> creates/updates all workbooks: one for global data (Tag Definitions, Divisions, etc.)
          and one for each year&apos;s data (Attendees, Persons, etc.).
        </p>
        <p className="mt-2">
          The Globals workbook includes an <strong>Index</strong> sheet with links to all workbooks.
        </p>
      </div>
    </div>
  );
}
