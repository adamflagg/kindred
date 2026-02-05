/**
 * DemographicBreakdowns - Session+Bunk combination table.
 *
 * Note: School, city, synagogue, and first year breakdowns have been moved
 * to the Geographic Analysis tab (/metrics/registration/geo).
 * This component now only shows the session+bunk combinations table.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Building2 } from "lucide-react";
import type { SessionBunkBreakdown } from "../../types/metrics";

interface DemographicBreakdownsProps {
  bySessionBunk: SessionBunkBreakdown[] | undefined;
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
  bySessionBunk = [],
}: DemographicBreakdownsProps) {
  if (bySessionBunk.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
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
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                  Bunk
                </th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {bySessionBunk.map((item, idx) => (
                <tr
                  key={idx}
                  className="border-t border-border hover:bg-muted/30"
                >
                  <td className="px-4 py-2 text-foreground">{item.session}</td>
                  <td className="px-4 py-2 text-foreground">{item.bunk}</td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {item.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleTable>
    </div>
  );
}
