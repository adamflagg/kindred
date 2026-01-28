/**
 * DemographicTable - Searchable, sortable table for demographic breakdowns
 *
 * Displays full lists of school/city/synagogue data with retention stats.
 * Enables data quality visibility by showing ALL values, not just top-N.
 */

import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, Download } from 'lucide-react';

export interface DemographicRow {
  name: string;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface DemographicTableProps {
  /** Title for the table (e.g., "School", "City", "Synagogue") */
  title: string;
  /** Data rows to display */
  data: DemographicRow[];
  /** Callback when a row is clicked (for cohort export) */
  onRowClick?: (name: string) => void;
}

type SortField = 'name' | 'base_count' | 'retention_rate';
type SortDirection = 'asc' | 'desc';

export function DemographicTable({ title, data, onRowClick }: DemographicTableProps) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('base_count');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Filter and sort data
  const filteredData = useMemo(() => {
    let result = data;

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter((row) => row.name.toLowerCase().includes(searchLower));
    }

    // Apply sorting
    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'base_count':
          comparison = a.base_count - b.base_count;
          break;
        case 'retention_rate':
          comparison = a.retention_rate - b.retention_rate;
          break;
      }
      return sortDirection === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [data, search, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'desc' ? (
      <ChevronDown className="h-4 w-4" />
    ) : (
      <ChevronUp className="h-4 w-4" />
    );
  };

  // Export to CSV
  const handleExport = () => {
    const headers = ['Name', 'Base Count', 'Returned', 'Retention Rate'];
    const rows = filteredData.map((row) => [
      row.name,
      row.base_count,
      row.returned_count,
      `${(row.retention_rate * 100).toFixed(1)}%`,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase()}_retention.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-8 py-1.5 text-sm w-40"
            />
          </div>
          <button
            onClick={handleExport}
            className="btn-ghost p-1.5"
            title="Export to CSV"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="overflow-auto max-h-80">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border">
              <th
                className="text-left py-2 px-2 cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-1">
                  {title}
                  <SortIcon field="name" />
                </div>
              </th>
              <th
                className="text-right py-2 px-2 cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('base_count')}
              >
                <div className="flex items-center justify-end gap-1">
                  Count
                  <SortIcon field="base_count" />
                </div>
              </th>
              <th className="text-right py-2 px-2">Returned</th>
              <th
                className="text-right py-2 px-2 cursor-pointer hover:bg-muted/50"
                onClick={() => handleSort('retention_rate')}
              >
                <div className="flex items-center justify-end gap-1">
                  Rate
                  <SortIcon field="retention_rate" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-4 text-muted-foreground">
                  {search ? 'No matching results' : 'No data available'}
                </td>
              </tr>
            ) : (
              filteredData.map((row) => (
                <tr
                  key={row.name}
                  className={`border-b border-border last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-muted/30' : ''}`}
                  onClick={() => onRowClick?.(row.name)}
                >
                  <td className="py-2 px-2">{row.name}</td>
                  <td className="text-right py-2 px-2">{row.base_count}</td>
                  <td className="text-right py-2 px-2">{row.returned_count}</td>
                  <td className="text-right py-2 px-2">
                    <span
                      className={
                        row.retention_rate >= 0.7
                          ? 'text-green-600 dark:text-green-400'
                          : row.retention_rate >= 0.5
                            ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-red-600 dark:text-red-400'
                      }
                    >
                      {(row.retention_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">
          Showing {filteredData.length} of {data.length} entries
        </div>
      )}
    </div>
  );
}
