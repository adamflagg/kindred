/**
 * YearModeToggle - Switch between single-year and comparison mode.
 */

interface YearModeToggleProps {
  mode: 'single' | 'comparison';
  onModeChange: (mode: 'single' | 'comparison') => void;
  yearA: number;
  yearB: number;
  onYearAChange: (year: number) => void;
  onYearBChange: (year: number) => void;
  availableYears: number[];
}

export function YearModeToggle({
  mode,
  onModeChange,
  yearA,
  yearB,
  onYearAChange,
  onYearBChange,
  availableYears,
}: YearModeToggleProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex rounded-lg border border-border overflow-hidden">
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'single'
              ? 'bg-primary text-primary-foreground'
              : 'bg-background text-foreground hover:bg-muted'
          }`}
          onClick={() => onModeChange('single')}
        >
          Single Year
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mode === 'comparison'
              ? 'bg-primary text-primary-foreground'
              : 'bg-background text-foreground hover:bg-muted'
          }`}
          onClick={() => onModeChange('comparison')}
        >
          Compare Years
        </button>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={yearA}
          onChange={(e) => onYearAChange(Number(e.target.value))}
          className="px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {availableYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>

        {mode === 'comparison' && (
          <>
            <span className="text-muted-foreground">vs</span>
            <select
              value={yearB}
              onChange={(e) => onYearBChange(Number(e.target.value))}
              className="px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
