/**
 * DrillDownModal - Modal displaying attendees matching a chart segment.
 *
 * Features:
 * - Header with count and filter description
 * - Search input to filter displayed results
 * - Sortable columns
 * - CSV export
 */

import { useState, useMemo } from 'react';
import { X, Download, Search, ArrowUpDown, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { useDrilldownAttendees } from '../../hooks/useDrilldownAttendees';
import type { DrilldownFilter } from '../../types/metrics';

interface DrillDownModalProps {
  year: number;
  filter: DrilldownFilter | null;
  sessionCmId?: number | undefined;
  sessionTypes?: string[] | undefined;
  statusFilter?: string[] | undefined;
  onClose: () => void;
}

type SortField = 'name' | 'grade' | 'gender' | 'school' | 'city' | 'session' | 'years';
type SortDirection = 'asc' | 'desc';

export function DrillDownModal({
  year,
  filter,
  sessionCmId,
  sessionTypes,
  statusFilter,
  onClose,
}: DrillDownModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const { data: attendees = [], isLoading, error } = useDrilldownAttendees({
    year,
    filter,
    sessionCmId,
    sessionTypes,
    statusFilter,
  });

  // Filter attendees by search term
  const filteredAttendees = useMemo(() => {
    if (!searchTerm.trim()) {
      return attendees;
    }
    const term = searchTerm.toLowerCase();
    return attendees.filter(
      (a) =>
        a.first_name.toLowerCase().includes(term) ||
        a.last_name.toLowerCase().includes(term) ||
        (a.preferred_name?.toLowerCase().includes(term) ?? false) ||
        (a.school?.toLowerCase().includes(term) ?? false) ||
        (a.city?.toLowerCase().includes(term) ?? false) ||
        a.session_name.toLowerCase().includes(term),
    );
  }, [attendees, searchTerm]);

  // Sort attendees
  const sortedAttendees = useMemo(() => {
    const sorted = [...filteredAttendees];
    sorted.sort((a, b) => {
      let aVal: string | number | null | undefined;
      let bVal: string | number | null | undefined;

      switch (sortField) {
        case 'name':
          aVal = `${a.last_name} ${a.first_name}`.toLowerCase();
          bVal = `${b.last_name} ${b.first_name}`.toLowerCase();
          break;
        case 'grade':
          aVal = a.grade ?? -1;
          bVal = b.grade ?? -1;
          break;
        case 'gender':
          aVal = a.gender ?? '';
          bVal = b.gender ?? '';
          break;
        case 'school':
          aVal = a.school?.toLowerCase() ?? '';
          bVal = b.school?.toLowerCase() ?? '';
          break;
        case 'city':
          aVal = a.city?.toLowerCase() ?? '';
          bVal = b.city?.toLowerCase() ?? '';
          break;
        case 'session':
          aVal = a.session_name.toLowerCase();
          bVal = b.session_name.toLowerCase();
          break;
        case 'years':
          aVal = a.years_at_camp ?? 0;
          bVal = b.years_at_camp ?? 0;
          break;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredAttendees, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const downloadCsv = () => {
    const headers = [
      'Name',
      'Grade',
      'Gender',
      'Age',
      'School',
      'City',
      'Session',
      'Years at Camp',
      'Status',
      'Returning',
    ];

    const rows = sortedAttendees.map((a) => [
      a.preferred_name || `${a.first_name} ${a.last_name}`,
      a.grade ?? '',
      a.gender ?? '',
      a.age ?? '',
      a.school ?? '',
      a.city ?? '',
      a.session_name,
      a.years_at_camp ?? '',
      a.status,
      a.is_returning ? 'Yes' : 'No',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filter?.label.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3" />
    ) : (
      <ArrowDown className="w-3 h-3" />
    );
  };

  if (!filter) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {sortedAttendees.length} camper{sortedAttendees.length !== 1 ? 's' : ''} in{' '}
              {filter.label}
            </h2>
            <p className="text-sm text-muted-foreground">
              {year} enrollment data
              {searchTerm && ` (filtered from ${attendees.length})`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={downloadCsv}
              disabled={sortedAttendees.length === 0}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Download CSV
            </button>
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, school, city, session..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading campers...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-red-600">
              Failed to load data: {error.message}
            </div>
          ) : sortedAttendees.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              {searchTerm ? 'No campers match your search' : 'No campers found'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  <th
                    onClick={() => handleSort('name')}
                    className="px-4 py-3 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  >
                    <div className="flex items-center gap-1">
                      Name <SortIcon field="name" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('grade')}
                    className="px-4 py-3 text-center font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  >
                    <div className="flex items-center justify-center gap-1">
                      Grade <SortIcon field="grade" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('gender')}
                    className="px-4 py-3 text-center font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  >
                    <div className="flex items-center justify-center gap-1">
                      Gender <SortIcon field="gender" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('school')}
                    className="px-4 py-3 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  >
                    <div className="flex items-center gap-1">
                      School <SortIcon field="school" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('city')}
                    className="px-4 py-3 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  >
                    <div className="flex items-center gap-1">
                      City <SortIcon field="city" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('session')}
                    className="px-4 py-3 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  >
                    <div className="flex items-center gap-1">
                      Session <SortIcon field="session" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('years')}
                    className="px-4 py-3 text-center font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                  >
                    <div className="flex items-center justify-center gap-1">
                      Years <SortIcon field="years" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedAttendees.map((attendee, index) => (
                  <tr
                    key={`${attendee.person_id}-${attendee.session_cm_id}-${index}`}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {attendee.preferred_name || `${attendee.first_name} ${attendee.last_name}`}
                      {attendee.is_returning && (
                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded">
                          Returning
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-foreground">
                      {attendee.grade ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-foreground">
                      {attendee.gender ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-foreground">{attendee.school ?? '—'}</td>
                    <td className="px-4 py-3 text-foreground">{attendee.city ?? '—'}</td>
                    <td className="px-4 py-3 text-foreground">{attendee.session_name}</td>
                    <td className="px-4 py-3 text-center text-foreground">
                      {attendee.years_at_camp ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
