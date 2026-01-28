/**
 * CollapsibleDemographicTable - Generic collapsible table for demographic breakdowns.
 *
 * Supports two variants:
 * - registration: Name, Count, % columns
 * - retention: Name, BaseYear, Returned, Retention columns with color-coded rates
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface RegistrationTableData {
  name: string;
  count: number;
  percentage: number;
}

export interface RetentionTableData {
  name: string;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

interface BaseProps {
  title: string;
  icon: React.ReactNode;
  nameColumn: string;
  defaultOpen?: boolean;
  emptyMessage?: string;
}

interface RegistrationProps extends BaseProps {
  variant: 'registration';
  data: RegistrationTableData[];
  baseYear?: never;
}

interface RetentionProps extends BaseProps {
  variant: 'retention';
  data: RetentionTableData[];
  baseYear: number;
}

export type CollapsibleDemographicTableProps = RegistrationProps | RetentionProps;

// ============================================================================
// Helper Components
// ============================================================================

function EmptyState({ message }: { message: string }) {
  return <div className="px-4 py-8 text-center text-muted-foreground text-sm">{message}</div>;
}

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

// ============================================================================
// Main Component
// ============================================================================

export function CollapsibleDemographicTable(props: CollapsibleDemographicTableProps) {
  const {
    title,
    icon,
    nameColumn,
    defaultOpen = false,
    emptyMessage = 'No data available',
    variant,
    data,
  } = props;

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
          <span className="text-sm text-muted-foreground">({data.length})</span>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-border">
          {data.length === 0 ? (
            <EmptyState message={emptyMessage} />
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      {nameColumn}
                    </th>
                    {variant === 'registration' ? (
                      <>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Count
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          %
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          {props.baseYear}
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Returned
                        </th>
                        <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                          Retention
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {variant === 'registration'
                    ? (data as RegistrationTableData[]).map((item, idx) => (
                        <tr
                          key={idx}
                          className="border-t border-border hover:bg-muted/30"
                        >
                          <td
                            className="px-4 py-2 text-foreground truncate max-w-[200px]"
                            title={item.name}
                          >
                            {item.name}
                          </td>
                          <td className="px-4 py-2 text-right text-foreground">{item.count}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">
                            {item.percentage.toFixed(1)}%
                          </td>
                        </tr>
                      ))
                    : (data as RetentionTableData[]).map((item, idx) => (
                        <tr
                          key={idx}
                          className="border-t border-border hover:bg-muted/30"
                        >
                          <td
                            className="px-4 py-2 text-foreground truncate max-w-[200px]"
                            title={item.name}
                          >
                            {item.name}
                          </td>
                          <td className="px-4 py-2 text-right text-foreground">
                            {item.base_count}
                          </td>
                          <td className="px-4 py-2 text-right text-foreground">
                            {item.returned_count}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <RetentionRateCell rate={item.retention_rate} />
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
