/**
 * FilterBar - Status and session type filters for metrics dashboard.
 *
 * Provides checkboxes for filtering by enrollment status and session type.
 * The compare year selector is separate (CompareYearSelector component).
 */

import { Filter } from 'lucide-react';

interface FilterBarProps {
  /** Currently selected statuses (multi-select) */
  selectedStatuses: string[];
  /** Callback when statuses change */
  onStatusChange: (statuses: string[]) => void;
  /** Currently selected session types (multi-select) */
  selectedSessionTypes: string[];
  /** Callback when session types change */
  onSessionTypeChange: (types: string[]) => void;
}

/** Available enrollment statuses */
const STATUS_OPTIONS = [
  { id: 'enrolled', label: 'Enrolled' },
  { id: 'waitlisted', label: 'Waitlisted' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'withdrawn', label: 'Withdrawn' },
] as const;

/** Available session types */
const SESSION_TYPE_OPTIONS = [
  { id: 'main', label: 'Main' },
  { id: 'embedded', label: 'Embedded' },
  { id: 'ag', label: 'All-Gender' },
  { id: 'family', label: 'Family Camp' },
] as const;

interface CheckboxGroupProps {
  label: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
}

function CheckboxGroup({ label, options, selected, onChange }: CheckboxGroupProps) {
  const handleToggle = (id: string) => {
    if (selected.includes(id)) {
      // Don't allow deselecting the last option
      if (selected.length > 1) {
        onChange(selected.filter((s) => s !== id));
      }
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground mr-1">{label}:</span>
      {options.map((option) => (
        <label
          key={option.id}
          className="flex items-center gap-1.5 cursor-pointer select-none"
        >
          <input
            type="checkbox"
            checked={selected.includes(option.id)}
            onChange={() => handleToggle(option.id)}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0"
          />
          <span className="text-sm text-foreground">{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function FilterBar({
  selectedStatuses,
  onStatusChange,
  selectedSessionTypes,
  onSessionTypeChange,
}: FilterBarProps) {
  return (
    <div className="card-lodge p-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Filters</span>
      </div>
      <div className="space-y-3">
        <CheckboxGroup
          label="Status"
          options={STATUS_OPTIONS}
          selected={selectedStatuses}
          onChange={onStatusChange}
        />
        <CheckboxGroup
          label="Sessions"
          options={SESSION_TYPE_OPTIONS}
          selected={selectedSessionTypes}
          onChange={onSessionTypeChange}
        />
      </div>
    </div>
  );
}
