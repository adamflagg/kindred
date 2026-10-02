import {
  Field,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react'
import { ChevronDown } from 'lucide-react'

import { FIELD_INLINE } from '../../admin/lodging/lodgingStyles'
import type { ProgramGroup } from './programLabel'
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

/** The dropdown's own value: a pool heading or a program, both kinds of key in one list. */
const asPool = (key: string) => `pool:${key}`
const asProgram = (key: string) => `program:${key}`
const ALL_PROGRAMS = 'All programs'
const PLAIN = 'listbox-option py-1.5'
const HEADING = `${PLAIN} font-semibold`
const UNDER = `${PLAIN} pl-8`

/**
 * Program and Pool as ONE grouped dropdown (slice 1 grid layout T6): each budget pool a heading you
 * can pick (`pool=`), its programs under it (`program=`); picking one clears the other. Summer's
 * filters are the model: AllCampersView's grouped Headless UI Listbox, whose group-level entries
 * ("Teen Programs", "Quests") are themselves options — a native <select> cannot make an <optgroup>
 * heading selectable. A stale URL value still filters, so it shows as its own option to clear (A5).
 */
function ProgramSelect({
  groups,
  program,
  pool,
  onPick,
}: {
  groups: readonly ProgramGroup[]
  program: string | null
  pool: string | null
  onPick: (pool: string | null, program: string | null) => void
}) {
  const pools = groups.flatMap((g) => (g.pool ? [g.pool] : []))
  const programs = groups.flatMap((g) => g.programs)
  const stalePool = pool !== null && pool !== '' && !pools.some((p) => p.value === pool)
  const staleProgram =
    program !== null && program !== '' && !programs.some((p) => p.value === program)
  // A program wins when a link carries both: it is the narrower filter, and the one its row shows.
  const value = program ? asProgram(program) : pool ? asPool(pool) : ''
  const shown = program
    ? (programs.find((p) => p.value === program)?.label ?? program)
    : pool
      ? (pools.find((p) => p.value === pool)?.label ?? pool)
      : ALL_PROGRAMS
  const pick = (picked: string) => {
    if (picked.startsWith('pool:')) onPick(picked.slice('pool:'.length), null)
    else if (picked.startsWith('program:')) onPick(null, picked.slice('program:'.length))
    else onPick(null, null)
  }
  return (
    <Field className="flex items-center gap-2">
      <Label>Program</Label>
      <Listbox value={value} onChange={pick}>
        <div className="relative">
          <ListboxButton className={`${FIELD_INLINE} flex items-center gap-1.5`}>
            <span className="truncate">{shown}</span>
            <ChevronDown className="text-muted-foreground h-4 w-4 flex-shrink-0" />
          </ListboxButton>
          <ListboxOptions transition className="listbox-options w-auto min-w-[220px]">
            <ListboxOption value="" className={PLAIN}>
              {ALL_PROGRAMS}
            </ListboxOption>
            {stalePool && (
              <ListboxOption value={asPool(pool)} className={HEADING}>
                {pool}
              </ListboxOption>
            )}
            {staleProgram && (
              <ListboxOption value={asProgram(program)} className={UNDER}>
                {program}
              </ListboxOption>
            )}
            {groups.map((group) => (
              <div key={group.pool?.value ?? ''} className="border-border mt-1 border-t pt-1">
                {group.pool && (
                  <ListboxOption value={asPool(group.pool.value)} className={HEADING}>
                    {group.pool.label}
                  </ListboxOption>
                )}
                {group.programs.map((option) => (
                  <ListboxOption
                    key={option.value}
                    value={asProgram(option.value)}
                    className={group.pool ? UNDER : PLAIN}
                  >
                    {option.label}
                  </ListboxOption>
                ))}
              </div>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
    </Field>
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

/** Program (pools as its headings, T6), Round and Checklist (Decision 9; owner ruling Group 2c Q3) and Show IDs (D27), all held in the URL. */
export function GridFiltersBar({
  groups,
  program,
  pool,
  round,
  tick,
  showIds,
  onChange,
  onProgramPool,
}: {
  groups: readonly ProgramGroup[]
  program: string | null
  pool: string | null
  round: RoundFilter | null
  tick: TickFilter | null
  showIds: boolean
  onChange: (name: GridParamName, value: string | null) => void
  /** The Program dropdown writes both at once: one is always cleared. */
  onProgramPool: (pool: string | null, program: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <ProgramSelect groups={groups} program={program} pool={pool} onPick={onProgramPool} />
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
