/**
 * CompareYearSelector - Always-on comparison mode with "Compare to" dropdown.
 * Primary year comes from app context (nav year selector).
 * This component only controls the comparison year.
 */

interface CompareYearSelectorProps {
  primaryYear: number;
  compareYear: number;
  onCompareYearChange: (year: number) => void;
  availableYears: number[];
}

export function CompareYearSelector({
  primaryYear,
  compareYear,
  onCompareYearChange,
  availableYears,
}: CompareYearSelectorProps) {
  // Filter out the primary year from comparison options
  const comparisonYears = availableYears.filter(y => y !== primaryYear);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold text-foreground">{primaryYear}</span>
        <span className="text-muted-foreground">compared to</span>
        <select
          value={compareYear}
          onChange={(e) => onCompareYearChange(Number(e.target.value))}
          className="px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {comparisonYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
