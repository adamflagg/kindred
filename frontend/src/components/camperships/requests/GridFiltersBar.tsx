import { FIELD_INLINE } from '../../admin/lodging/lodgingStyles'
import type { GridParamName } from './useGridParams'
import type { RoundFilter, TickFilter } from './views'

export interface FilterOption {
  readonly value: string
  readonly label: string
}

function Select({
  id,
  label,
  value,
  all,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string | null
  all: string
  options: readonly FilterOption[]
  onChange: (value: string | null) => void
}) {
  // A stale URL value (a bookmark, a past as-of date) still filters the grid, so keep it visible and clearable.
  const stale = value !== null && value !== '' && !options.some((o) => o.value === value)
  return (
    <span className="flex items-center gap-2">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className={FIELD_INLINE}
      >
        <option value="">{all}</option>
        {stale && <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}

const ROUNDS: readonly FilterOption[] = [
  { value: '1', label: 'Round 1' },
  { value: '2', label: 'Round 2' },
  { value: '3', label: 'Round 3' },
]
const TICKS: readonly FilterOption[] = [
  { value: 'posted', label: 'Posted' },
  { value: 'accepted', label: 'Accepted' },
]

/** Program, Pool, Round and Checklist (Decision 9; owner ruling Group 2c Q3) and Show IDs (D27), all held in the URL. */
export function GridFiltersBar({
  programs,
  pools,
  program,
  pool,
  round,
  tick,
  showIds,
  onChange,
}: {
  programs: readonly FilterOption[]
  pools: readonly FilterOption[]
  program: string | null
  pool: string | null
  round: RoundFilter | null
  tick: TickFilter | null
  showIds: boolean
  onChange: (name: GridParamName, value: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <Select
        id="aid-filter-program"
        label="Program"
        value={program}
        all="All programs"
        options={programs}
        onChange={(v) => onChange('program', v)}
      />
      <Select
        id="aid-filter-pool"
        label="Pool"
        value={pool}
        all="All pools"
        options={pools}
        onChange={(v) => onChange('pool', v)}
      />
      <Select
        id="aid-filter-round"
        label="Round"
        value={round === null ? null : String(round)}
        all="Any round"
        options={ROUNDS}
        onChange={(v) => onChange('round', v)}
      />
      <Select
        id="aid-filter-tick"
        label="Checklist"
        value={tick}
        all="Any checklist"
        options={TICKS}
        onChange={(v) => onChange('tick', v)}
      />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={showIds}
          onChange={(event) => onChange('ids', event.target.checked ? '1' : null)}
        />
        Show IDs
      </label>
    </div>
  )
}
