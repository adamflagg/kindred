/**
 * DemographicBreakdowns - Collapsible tables for school, city, synagogue breakdowns.
 *
 * Refactored to use CollapsibleDemographicTable for standard 3-column tables.
 * Session+Bunk table kept as custom due to unique 2-name-column structure.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Building2, MapPin, Heart, Calendar } from 'lucide-react';
import { CollapsibleDemographicTable, type RegistrationTableData } from './CollapsibleDemographicTable';
import type {
  SchoolBreakdown,
  CityBreakdown,
  SynagogueBreakdown,
  FirstYearBreakdown,
  SessionBunkBreakdown,
} from '../../types/metrics';

interface DemographicBreakdownsProps {
  bySchool: SchoolBreakdown[] | undefined;
  byCity: CityBreakdown[] | undefined;
  bySynagogue: SynagogueBreakdown[] | undefined;
  byFirstYear: FirstYearBreakdown[] | undefined;
  bySessionBunk: SessionBunkBreakdown[] | undefined;
}

// Transform functions to convert API types to table data
function transformSchoolData(data: SchoolBreakdown[]): RegistrationTableData[] {
  return data.map((item) => ({
    name: item.school,
    count: item.count,
    percentage: item.percentage,
  }));
}

function transformCityData(data: CityBreakdown[]): RegistrationTableData[] {
  return data.map((item) => ({
    name: item.city,
    count: item.count,
    percentage: item.percentage,
  }));
}

function transformSynagogueData(data: SynagogueBreakdown[]): RegistrationTableData[] {
  return data.map((item) => ({
    name: item.synagogue,
    count: item.count,
    percentage: item.percentage,
  }));
}

function transformFirstYearData(data: FirstYearBreakdown[]): RegistrationTableData[] {
  return data.map((item) => ({
    name: String(item.first_year),
    count: item.count,
    percentage: item.percentage,
  }));
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

export function DemographicBreakdowns({
  bySchool = [],
  byCity = [],
  bySynagogue = [],
  byFirstYear = [],
  bySessionBunk = [],
}: DemographicBreakdownsProps) {
  return (
    <div className="space-y-4">
      <CollapsibleDemographicTable
        title="By School"
        icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
        data={transformSchoolData(bySchool)}
        variant="registration"
        nameColumn="School"
        emptyMessage="No school data available. Run camper-history sync to populate."
      />

      <CollapsibleDemographicTable
        title="By City"
        icon={<MapPin className="w-4 h-4 text-muted-foreground" />}
        data={transformCityData(byCity)}
        variant="registration"
        nameColumn="City"
        emptyMessage="No city data available. Run camper-history sync to populate."
      />

      <CollapsibleDemographicTable
        title="By Synagogue"
        icon={<Heart className="w-4 h-4 text-muted-foreground" />}
        data={transformSynagogueData(bySynagogue)}
        variant="registration"
        nameColumn="Synagogue"
        emptyMessage="No synagogue data available. Run camper-history sync to populate."
      />

      <CollapsibleDemographicTable
        title="By First Year Attended"
        icon={<Calendar className="w-4 h-4 text-muted-foreground" />}
        data={transformFirstYearData(byFirstYear)}
        variant="registration"
        nameColumn="First Year"
        defaultOpen
        emptyMessage="No first year data available. Run camper-history sync to populate."
      />

      {/* Session+Bunk has 2 name columns, keeping custom table */}
      {bySessionBunk.length > 0 && (
        <CollapsibleTable
          title="Top Session + Bunk Combinations"
          icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
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
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Count</th>
                </tr>
              </thead>
              <tbody>
                {bySessionBunk.map((item, idx) => (
                  <tr key={idx} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 text-foreground">{item.session}</td>
                    <td className="px-4 py-2 text-foreground">{item.bunk}</td>
                    <td className="px-4 py-2 text-right text-foreground">{item.count}</td>
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
