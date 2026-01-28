/**
 * RetentionDemographicBreakdowns - Collapsible tables for retention by demographics.
 *
 * Refactored to use CollapsibleDemographicTable for standard 4-column retention tables.
 * Session+Bunk table kept as custom due to unique 2-name-column structure.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Building2, MapPin, Heart, Calendar, Home } from 'lucide-react';
import {
  CollapsibleDemographicTable,
  type RetentionTableData,
} from './CollapsibleDemographicTable';
import type {
  RetentionBySchool,
  RetentionByCity,
  RetentionBySynagogue,
  RetentionByFirstYear,
  RetentionBySessionBunk,
} from '../../types/metrics';

interface RetentionDemographicBreakdownsProps {
  bySchool: RetentionBySchool[] | undefined;
  byCity: RetentionByCity[] | undefined;
  bySynagogue: RetentionBySynagogue[] | undefined;
  byFirstYear: RetentionByFirstYear[] | undefined;
  bySessionBunk: RetentionBySessionBunk[] | undefined;
  baseYear: number;
}

// Transform functions to convert API types to table data
function transformSchoolData(data: RetentionBySchool[]): RetentionTableData[] {
  return data.map((item) => ({
    name: item.school,
    base_count: item.base_count,
    returned_count: item.returned_count,
    retention_rate: item.retention_rate,
  }));
}

function transformCityData(data: RetentionByCity[]): RetentionTableData[] {
  return data.map((item) => ({
    name: item.city,
    base_count: item.base_count,
    returned_count: item.returned_count,
    retention_rate: item.retention_rate,
  }));
}

function transformSynagogueData(data: RetentionBySynagogue[]): RetentionTableData[] {
  return data.map((item) => ({
    name: item.synagogue,
    base_count: item.base_count,
    returned_count: item.returned_count,
    retention_rate: item.retention_rate,
  }));
}

function transformFirstYearData(data: RetentionByFirstYear[]): RetentionTableData[] {
  return data.map((item) => ({
    name: String(item.first_year),
    base_count: item.base_count,
    returned_count: item.returned_count,
    retention_rate: item.retention_rate,
  }));
}

// Helper component for retention rate display in Session+Bunk table
function RetentionRateCell({ rate }: { rate: number }) {
  const percentage = rate * 100;
  const colorClass =
    percentage >= 60
      ? 'text-emerald-600 dark:text-emerald-400'
      : percentage >= 40
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  return <span className={colorClass}>{percentage.toFixed(1)}%</span>;
}

// Custom CollapsibleTable for Session+Bunk (has 2 name columns)
interface CollapsibleTableProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  count?: number;
}

function CollapsibleTable({
  title,
  icon,
  defaultOpen = false,
  children,
  count,
}: CollapsibleTableProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="card-lodge overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-foreground">{title}</span>
          {count !== undefined && (
            <span className="text-sm text-muted-foreground">({count})</span>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {isOpen && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

export function RetentionDemographicBreakdowns({
  bySchool = [],
  byCity = [],
  bySynagogue = [],
  byFirstYear = [],
  bySessionBunk = [],
  baseYear,
}: RetentionDemographicBreakdownsProps) {
  return (
    <div className="space-y-4">
      <CollapsibleDemographicTable
        title="Retention by School"
        icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
        data={transformSchoolData(bySchool)}
        variant="retention"
        nameColumn="School"
        baseYear={baseYear}
        emptyMessage="No school data available. Run camper-history sync to populate."
      />

      <CollapsibleDemographicTable
        title="Retention by City"
        icon={<MapPin className="w-4 h-4 text-muted-foreground" />}
        data={transformCityData(byCity)}
        variant="retention"
        nameColumn="City"
        baseYear={baseYear}
        emptyMessage="No city data available. Run camper-history sync to populate."
      />

      <CollapsibleDemographicTable
        title="Retention by Synagogue"
        icon={<Heart className="w-4 h-4 text-muted-foreground" />}
        data={transformSynagogueData(bySynagogue)}
        variant="retention"
        nameColumn="Synagogue"
        baseYear={baseYear}
        emptyMessage="No synagogue data available. Run camper-history sync to populate."
      />

      <CollapsibleDemographicTable
        title="Retention by First Year Attended"
        icon={<Calendar className="w-4 h-4 text-muted-foreground" />}
        data={transformFirstYearData(byFirstYear)}
        variant="retention"
        nameColumn="First Year"
        baseYear={baseYear}
        defaultOpen
        emptyMessage="No first year data available. Run camper-history sync to populate."
      />

      {/* Session+Bunk has 2 name columns, keeping custom table */}
      {bySessionBunk.length > 0 && (
        <CollapsibleTable
          title="Retention by Session + Bunk"
          icon={<Home className="w-4 h-4 text-muted-foreground" />}
          count={bySessionBunk.length}
        >
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                    Session
                  </th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Bunk</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                    {baseYear}
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                    Returned
                  </th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                    Retention
                  </th>
                </tr>
              </thead>
              <tbody>
                {bySessionBunk.map((item, idx) => (
                  <tr key={idx} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 text-foreground">{item.session}</td>
                    <td className="px-4 py-2 text-foreground">{item.bunk}</td>
                    <td className="px-4 py-2 text-right text-foreground">{item.base_count}</td>
                    <td className="px-4 py-2 text-right text-foreground">{item.returned_count}</td>
                    <td className="px-4 py-2 text-right">
                      <RetentionRateCell rate={item.retention_rate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleTable>
      )}
    </div>
  );
}
