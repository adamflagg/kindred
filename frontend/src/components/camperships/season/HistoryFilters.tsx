import { useState } from 'react'

import {
  actorWords,
  chipKinds,
  isSeasonDay,
  KIND_LABELS,
  type HistoryFilterKey,
  type HistoryFilters as Filters,
} from './historyModel'

/**
 * The compact control of this row (history.html B: 12.5px, tight padding). lodgingStyles' FIELD_INLINE
 * is the form-sized one (`text-sm py-1.5`) and can't be shrunk without two classes setting one
 * property, so the row has its own. Padding is added per use, so a box with a glyph sets its own left.
 */
const COMPACT_BASE =
  'border-border bg-background focus:ring-primary/50 rounded-md border text-xs focus:ring-2 focus:outline-none'
const COMPACT_FIELD = `${COMPACT_BASE} px-2 py-0.5`
/** A kind chip: an outlined pill when idle (history.html B), filled when it is the one asked for. */
const CHIP = 'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors'
const CHIP_ACTIVE = `${CHIP} border-primary bg-primary text-primary-foreground`
const CHIP_IDLE = `${CHIP} border-border bg-card text-muted-foreground hover:text-foreground`

/**
 * A box's text while it is edited, which follows the URL's value when that changes from elsewhere
 * (Back, a pasted link): React's reset-state-on-prop-change, in render. A `key` would remount the box
 * and drop focus on every commit.
 */
function useDraft(value: string): [string, (text: string) => void] {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(value)
  }
  return [text, setText]
}

/** The search writes on Enter or on leaving the box, never per keystroke (D15; the lead's rule). */
function SearchBox({ initial, onSearch }: { initial: string; onSearch: (text: string) => void }) {
  const [text, setText] = useDraft(initial)
  const commit = () => {
    const trimmed = text.trim()
    if (trimmed !== initial) onSearch(trimmed)
  }
  return (
    <form
      className="relative ml-auto"
      onSubmit={(event) => {
        event.preventDefault()
        commit()
      }}
    >
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs">
        ⌕
      </span>
      <input
        type="search"
        aria-label="Search"
        value={text}
        maxLength={200}
        placeholder="Reason, person or record id"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        className={`${COMPACT_BASE} w-50 py-0.5 pr-2 pl-6`}
      />
    </form>
  )
}

const orNull = (value: string): string | null => (value === '' ? null : value)

/**
 * A date box. A browser fires `change` on every digit once the box holds a whole day (typing 15 into
 * 04/20 passes through 04/01), and a typed year passes through 0002-…, 0020-…, 0202-…, so nothing is
 * written per change: the day lands on leaving the box or Enter, as the search does (I1). Only an
 * empty box or a day in a season's year is kept (I4); any other day goes back to the URL's.
 */
function DayBox({
  label,
  value,
  onDay,
}: {
  label: string
  value: string | null
  onDay: (day: string | null) => void
}) {
  const current = value ?? ''
  const [text, setText] = useDraft(current)
  const commit = () => {
    if (text === current) return
    if (text === '') onDay(null)
    else if (isSeasonDay(text)) onDay(text)
    else setText(current)
  }
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      {label}
      <input
        type="date"
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
        className={COMPACT_FIELD}
      />
    </span>
  )
}

/**
 * History's filters (spec §7.6; D49; history.html B): one kind at a time (Rules only with `rules`),
 * the person, From and Through (camp days), the intake tick and the search. Every change goes to the
 * URL through `onChange`; the page is in charge of it.
 */
export function HistoryFilters({
  filters,
  actors,
  canSeeRules,
  onChange,
}: {
  filters: Filters
  actors: readonly string[]
  canSeeRules: boolean
  onChange: (key: HistoryFilterKey, value: string | null) => void
}) {
  const people =
    filters.actor !== null && !actors.includes(filters.actor) ? [...actors, filters.actor] : actors
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <button
        type="button"
        className={filters.kind === null ? CHIP_ACTIVE : CHIP_IDLE}
        onClick={() => onChange('kind', null)}
      >
        All
      </button>
      {chipKinds(canSeeRules).map((kind) => (
        <button
          key={kind}
          type="button"
          className={filters.kind === kind ? CHIP_ACTIVE : CHIP_IDLE}
          onClick={() => onChange('kind', kind)}
        >
          {KIND_LABELS[kind]}
        </button>
      ))}
      <select
        aria-label="Person"
        value={filters.actor ?? ''}
        onChange={(event) => onChange('actor', orNull(event.target.value))}
        className={COMPACT_FIELD}
      >
        <option value="">Anyone</option>
        {people.map((actor) => (
          <option key={actor} value={actor}>
            {actorWords(actor)}
          </option>
        ))}
      </select>
      <DayBox label="From" value={filters.since} onDay={(day) => onChange('since', day)} />
      <DayBox label="Through" value={filters.until} onDay={(day) => onChange('until', day)} />
      <label className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={filters.intake}
          onChange={(event) => onChange('intake', event.target.checked ? '1' : null)}
        />
        Show intake runs
      </label>
      <SearchBox initial={filters.q} onSearch={(text) => onChange('q', orNull(text))} />
    </div>
  )
}
