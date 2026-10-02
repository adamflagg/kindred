import { useState } from 'react'

import { FIELD_INLINE, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from '../../admin/lodging/lodgingStyles'
import {
  actorWords,
  chipKinds,
  isSeasonDay,
  KIND_LABELS,
  type HistoryFilterKey,
  type HistoryFilters as Filters,
} from './historyModel'

/** The search writes on Enter or on leaving the box, never per keystroke (D15; the lead's rule). */
function SearchBox({ initial, onSearch }: { initial: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState(initial)
  const commit = () => {
    const trimmed = text.trim()
    if (trimmed !== initial) onSearch(trimmed)
  }
  return (
    <form
      className="ml-auto"
      onSubmit={(event) => {
        event.preventDefault()
        commit()
      }}
    >
      <input
        type="search"
        aria-label="Search"
        value={text}
        maxLength={200}
        placeholder="Reason, person or record id"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        className={`${FIELD_INLINE} w-56`}
      />
    </form>
  )
}

const orNull = (value: string): string | null => (value === '' ? null : value)

/**
 * A date box. Typing a year passes through 0002-…, 0020-…, 0202-…, each a real day, so only an
 * empty box or a day in a season's year is written (I4); a picker's click writes at once. The box
 * is uncontrolled (React would wipe a half-typed year back to the URL's day) and keyed on the URL's
 * day, so Back or a pasted link still shows the right one.
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
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      {label}
      <input
        key={value ?? ''}
        type="date"
        aria-label={label}
        defaultValue={value ?? ''}
        onChange={(event) => {
          const day = event.target.value
          if (day === '') onDay(null)
          else if (isSeasonDay(day)) onDay(day)
        }}
        className={FIELD_INLINE}
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
        className={filters.kind === null ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
        onClick={() => onChange('kind', null)}
      >
        All
      </button>
      {chipKinds(canSeeRules).map((kind) => (
        <button
          key={kind}
          type="button"
          className={filters.kind === kind ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
          onClick={() => onChange('kind', kind)}
        >
          {KIND_LABELS[kind]}
        </button>
      ))}
      <select
        aria-label="Person"
        value={filters.actor ?? ''}
        onChange={(event) => onChange('actor', orNull(event.target.value))}
        className={FIELD_INLINE}
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
      <SearchBox
        key={filters.q}
        initial={filters.q}
        onSearch={(text) => onChange('q', orNull(text))}
      />
    </div>
  )
}
