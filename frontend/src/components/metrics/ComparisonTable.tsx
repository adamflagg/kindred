/**
 * ComparisonTable - Display year-over-year comparison data in a table.
 */

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface ComparisonRow {
  label: string;
  yearA: number;
  yearB: number;
  change?: number;
  changePercent?: number;
}

interface ComparisonTableProps {
  title: string;
  yearALabel: string;
  yearBLabel: string;
  rows: ComparisonRow[];
  className?: string;
}

export function ComparisonTable({
  title,
  yearALabel,
  yearBLabel,
  rows,
  className = '',
}: ComparisonTableProps) {
  const getTrendIcon = (change: number | undefined) => {
    if (change === undefined || change === 0) {
      return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
    return change > 0 ? (
      <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
    ) : (
      <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
    );
  };

  const formatChange = (change: number | undefined, percent?: number) => {
    if (change === undefined) return '';
    const sign = change > 0 ? '+' : '';
    const changeStr = `${sign}${change}`;
    if (percent !== undefined) {
      return `${changeStr} (${sign}${percent.toFixed(1)}%)`;
    }
    return changeStr;
  };

  const getChangeClass = (change: number | undefined) => {
    if (change === undefined || change === 0) return 'text-muted-foreground';
    return change > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';
  };

  return (
    <div className={`card-lodge overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">{yearALabel}</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">{yearBLabel}</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{row.label}</td>
                <td className="px-4 py-3 text-right text-foreground">{row.yearA}</td>
                <td className="px-4 py-3 text-right text-foreground">{row.yearB}</td>
                <td className={`px-4 py-3 text-right ${getChangeClass(row.change)}`}>
                  <span className="flex items-center justify-end gap-1">
                    {getTrendIcon(row.change)}
                    {formatChange(row.change, row.changePercent)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
