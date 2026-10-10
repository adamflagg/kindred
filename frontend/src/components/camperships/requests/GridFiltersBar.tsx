import type { ReactNode } from 'react'

import { AidPicker } from '../kit/AidPicker'
import { CS_FLABEL } from '../kit/csType'
import type { AidPickerOption } from '../kit/pickerWords'
import { AidSegmented } from '../kit/Segmented'
import type { ProgramGroup } from './programLabel'
import type { GridParamName } from './useGridParams'
import type { RoundFilter } from './views'

/** The picker's own value: a pool heading or a program, both kinds of key in one list. */
const asPool = (key: string) => `pool:${key}`
const asProgram = (key: string) => `program:${key}`
const ALL = ''
const ALL_PROGRAMS = 'All programs'

/** A toolbar label beside its control. A span, not a <label>: a label would forward its click to the first segment. */
function Labelled({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={CS_FLABEL}>{text}</span>
      {children}
    </span>
  )
}

/**
 * The picker's options (slice 1 grid layout T6; the approved mock's PROG_OPTS): All programs, then each
 * budget pool as a pickable bold heading (`pool=`) with its programs indented under it (`program=`);
 * a program in no pool sits last, unindented. A stale URL value still filters, so it shows as its own
 * option to clear (A5).
 */
function programOptions(
  groups: readonly ProgramGroup[],
  program: string | null,
  pool: string | null
): Array<AidPickerOption<string>> {
  const pools = groups.flatMap((g) => (g.pool ? [g.pool] : []))
  const programs = groups.flatMap((g) => g.programs)
  const out: Array<AidPickerOption<string>> = [{ value: ALL, label: ALL_PROGRAMS }]
  if (pool !== null && pool !== '' && !pools.some((p) => p.value === pool)) {
    out.push({ value: asPool(pool), label: pool, level: 'heading' })
  }
  if (program !== null && program !== '' && !programs.some((p) => p.value === program)) {
    out.push({ value: asProgram(program), label: program, level: 'indent' })
  }
  for (const group of groups) {
    if (group.pool) {
      out.push({ value: asPool(group.pool.value), label: group.pool.label, level: 'heading' })
    }
    for (const option of group.programs) {
      out.push({
        value: asProgram(option.value),
        label: option.label,
        ...(group.pool ? { level: 'indent' as const } : {}),
      })
    }
  }
  return out
}

const ROUNDS = [
  { value: '1', label: 'R1' },
  { value: '2', label: 'R2' },
  { value: '3', label: 'R3' },
]

/**
 * Program (the white picker, pools as its headings, T6) and Round (the segmented well; clicking the
 * lit round clears it, as the chips did, Decision 9; owner ruling Group 2c Q3), held in the URL. No
 * Checklist chips: under D162 there are no Posted ticks (owner, fast-follow 10-03). Controls only, as
 * one fragment: the grid's toolbar (`AidTable`'s `toolbarLead`) lays them out on its one row, then
 * Flat / By reason, then Show IDs (`ShowIdsToggle`), the link chip, search and Download CSV (§5).
 */
export function GridFiltersBar({
  groups,
  program,
  pool,
  round,
  onChange,
  onProgramPool,
}: {
  groups: readonly ProgramGroup[]
  program: string | null
  pool: string | null
  round: RoundFilter | null
  onChange: (name: GridParamName, value: string | null) => void
  /** The Program picker writes both at once: one is always cleared. */
  onProgramPool: (pool: string | null, program: string | null) => void
}) {
  // A program wins when a link carries both: it is the narrower filter, and the one its row shows.
  const value = program ? asProgram(program) : pool ? asPool(pool) : ALL
  const pick = (picked: string) => {
    if (picked.startsWith('pool:')) onProgramPool(picked.slice('pool:'.length), null)
    else if (picked.startsWith('program:')) onProgramPool(null, picked.slice('program:'.length))
    else onProgramPool(null, null)
  }
  const current = round === null ? '' : String(round)
  return (
    <>
      <Labelled text="Program (as priced)">
        <AidPicker
          label="Program (as priced)"
          value={value}
          options={programOptions(groups, program, pool)}
          onChange={pick}
        />
      </Labelled>
      <Labelled text="Round">
        <AidSegmented
          label="Round"
          value={current}
          options={ROUNDS}
          onChange={(v) => onChange('round', v === current ? null : v)}
        />
      </Labelled>
    </>
  )
}

/** Show IDs (D27), held in the URL: on the grid's toolbar it sits after Flat / By reason. */
export function ShowIdsToggle({
  showIds,
  onChange,
}: {
  showIds: boolean
  onChange: (name: GridParamName, value: string | null) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap">
      <input
        type="checkbox"
        checked={showIds}
        onChange={(event) => onChange('ids', event.target.checked ? '1' : null)}
      />
      Show IDs
    </label>
  )
}
