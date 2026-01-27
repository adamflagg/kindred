/**
 * DemographicBreakdowns - Collapsible tables for school, city, synagogue breakdowns.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Building2, MapPin, Heart, Calendar } from 'lucide-react';
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

interface CollapsibleTableProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  count?: number;
}

function CollapsibleTable({ title, icon, defaultOpen = false, children, count }: CollapsibleTableProps) {
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center text-muted-foreground text-sm">
      {message}
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
      {/* School Breakdown */}
      <CollapsibleTable
        title="By School"
        icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
        count={bySchool.length}
      >
        {bySchool.length === 0 ? (
          <EmptyState message="No school data available. Run camper-history sync to populate." />
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">School</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Count</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">%</th>
                </tr>
              </thead>
              <tbody>
                {bySchool.map((item, idx) => (
                  <tr key={idx} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 text-foreground truncate max-w-[200px]" title={item.school}>
                      {item.school}
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">{item.count}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{item.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleTable>

      {/* City Breakdown */}
      <CollapsibleTable
        title="By City"
        icon={<MapPin className="w-4 h-4 text-muted-foreground" />}
        count={byCity.length}
      >
        {byCity.length === 0 ? (
          <EmptyState message="No city data available. Run camper-history sync to populate." />
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">City</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Count</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">%</th>
                </tr>
              </thead>
              <tbody>
                {byCity.map((item, idx) => (
                  <tr key={idx} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 text-foreground truncate max-w-[200px]" title={item.city}>
                      {item.city}
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">{item.count}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{item.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleTable>

      {/* Synagogue Breakdown */}
      <CollapsibleTable
        title="By Synagogue"
        icon={<Heart className="w-4 h-4 text-muted-foreground" />}
        count={bySynagogue.length}
      >
        {bySynagogue.length === 0 ? (
          <EmptyState message="No synagogue data available. Run camper-history sync to populate." />
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Synagogue</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Count</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">%</th>
                </tr>
              </thead>
              <tbody>
                {bySynagogue.map((item, idx) => (
                  <tr key={idx} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 text-foreground truncate max-w-[200px]" title={item.synagogue}>
                      {item.synagogue}
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">{item.count}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{item.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleTable>

      {/* First Year Attended Breakdown */}
      <CollapsibleTable
        title="By First Year Attended"
        icon={<Calendar className="w-4 h-4 text-muted-foreground" />}
        count={byFirstYear.length}
        defaultOpen={true}
      >
        {byFirstYear.length === 0 ? (
          <EmptyState message="No first year data available. Run camper-history sync to populate." />
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">First Year</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Count</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">%</th>
                </tr>
              </thead>
              <tbody>
                {byFirstYear.map((item, idx) => (
                  <tr key={idx} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 text-foreground">{item.first_year}</td>
                    <td className="px-4 py-2 text-right text-foreground">{item.count}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{item.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleTable>

      {/* Session+Bunk Breakdown */}
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
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Session</th>
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
