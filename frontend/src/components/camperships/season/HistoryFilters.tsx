import { useState } from 'react'

import type { ApiAidHistoryKind, ApiAidHistoryKindCount } from '../../../types/api-types'
import {
  CS_CHIP,
  CS_CHIP_COUNT,
  CS_CHIP_INK,
  CS_CHIP_ON,
  CS_FLABEL,
  CS_PANEL,
  CS_SEARCH,
  CS_SELECT,
  CS_STRIP,
  CS_STRIP_LENSES,
} from '../kit/csType'
import {
  actorWords,
  chipKinds,
  KIND_LABELS,
  isSeasonDay,
  type HistoryFilterKey,
  type HistoryFilters as Filters,
} from './historyModel'

/** Each kind's dot, in its pill's tone (spec §7.2 A), with dark partners. */
const DOT: Readonly<Record<ApiAidHistoryKind, string>> = {
  rules: 'bg-emerald-600 dark:bg-emerald-400',
  offers: 'bg-sky-600 dark:bg-sky-400',
  money: 'bg-amber-500 dark:bg-amber-400',
  holds: 'bg-red-500 dark:bg-red-400',
  grants: 'bg-purple-400 dark:bg-purple-300',
  intake: 'bg-muted-foreground',
}

function Count({ value, dim }: { value: number | null; dim: boolean }) {
  return (
    <i data-testid="history-count" className={`${CS_CHIP_COUNT} ${dim ? 'opacity-35' : ''}`}>
      {value ?? '—'}
    </i>
  )
}

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
      className="relative w-64"
      onSubmit={(event) => {
        event.preventDefault()
        commit()
      }}
    >
      <span
        className={`text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 ${CS_PANEL}`}
      >
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
        className={CS_SEARCH}
      />
    </form>
  )
}

const orNull = (value: string): string | null => (value === '' ? null : value)

/**
 * A date box. A browser fires `change` on every digit once the box holds a whole day (typing 15 into
 * 04/20 passes through 04/01), and a typed year passes through 0002-…, 0020-…, 0202-…, so nothing is
 * written per change: the day lands on leaving the box or Enter, as the search does (I1). Only an
 * empty box or a day in a season's year is kept (I4); any other day goes back to the URL's. A partly
 * typed box reads '' too (badInput): it is reset in the DOM, since with no URL day React sees no change.
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
  const commit = (input: HTMLInputElement) => {
    // A partly erased box reads '' too, but it is a half-edited day, not "no date": back to the URL's.
    // Forced in the DOM: with '' on both sides React never rewrites the input's partial segments.
    if (input.validity.badInput) {
      input.value = current
      setText(current)
      return
    }
    if (text === current) return
    if (text === '') onDay(null)
    else if (isSeasonDay(text)) onDay(text)
    else setText(current)
  }
  return (
    <span className={`${CS_FLABEL} inline-flex items-center gap-2`}>
      {label}
      <input
        type="date"
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget)
        }}
        className={CS_SELECT}
      />
    </span>
  )
}

/**
 * History's filters (spec §7.2 A and B; D49; history-v2.html): the Requests strip (All, then one kind at a time,
 * Rules only with `rules`), then the person, From and Through (camp days), the intake runs and the search. Every
 * change goes to the URL through `onChange`; the page is in charge of it.
 */
export function HistoryFilters({
  filters,
  actors,
  kindCounts,
  total,
  canSeeRules,
  counting,
  onChange,
}: {
  filters: Filters
  actors: readonly string[]
  /** Each chip's count as the server counts it (H5); undefined while the read loads. */
  kindCounts: readonly ApiAidHistoryKindCount[] | undefined
  /** All's count; null while the first read loads or after it failed. */
  total: number | null
  canSeeRules: boolean
  /** A filter change is re-reading: the counts dim. */
  counting: boolean
  onChange: (key: HistoryFilterKey, value: string | null) => void
}) {
  const people =
    filters.actor !== null && !actors.includes(filters.actor) ? [...actors, filters.actor] : actors
  return (
    <div className="space-y-2">
      <div className={CS_STRIP} data-testid="history-strip">
        <div className={CS_STRIP_LENSES}>
          <button
            type="button"
            className={filters.kind === null ? CS_CHIP_ON : CS_CHIP_INK}
            onClick={() => onChange('kind', null)}
          >
            All <Count value={total} dim={counting} />
          </button>
        </div>
        <div className="flex min-w-0 gap-0.5 overflow-x-auto">
          {chipKinds(canSeeRules).map((kind) => {
            const on = filters.kind === kind
            const count = kindCounts?.find((c) => c.kind === kind)?.operations ?? null
            return (
              <button
                key={kind}
                type="button"
                className={on ? CS_CHIP_ON : CS_CHIP}
                onClick={() => onChange('kind', on ? null : kind)}
              >
                <span
                  className={`inline-block size-[7px] rounded-full ${DOT[kind]} ${on ? 'ring-primary-foreground ring-[1.5px]' : ''}`}
                />
                {KIND_LABELS[kind]}{' '}
                <Count value={kindCounts === undefined ? null : count} dim={counting} />
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className={`${CS_FLABEL} inline-flex items-center gap-2`}>
          <span>Person</span>
          <select
            aria-label="Person"
            value={filters.actor ?? ''}
            onChange={(event) => onChange('actor', orNull(event.target.value))}
            className={`${CS_SELECT} max-w-[220px]`}
          >
            <option value="">Anyone</option>
            {people.map((actor) => (
              <option key={actor} value={actor}>
                {actorWords(actor)}
              </option>
            ))}
          </select>
        </label>
        <DayBox label="From" value={filters.since} onDay={(day) => onChange('since', day)} />
        <DayBox label="Through" value={filters.until} onDay={(day) => onChange('until', day)} />
        <label className={`${CS_FLABEL} inline-flex items-center gap-1.5`}>
          <input
            type="checkbox"
            checked={filters.intake}
            onChange={(event) => onChange('intake', event.target.checked ? '1' : null)}
          />
          Show intake runs
        </label>
        <SearchBox initial={filters.q} onSearch={(text) => onChange('q', orNull(text))} />
      </div>
    </div>
  )
}
