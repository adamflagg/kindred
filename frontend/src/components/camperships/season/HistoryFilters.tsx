import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AidPicker } from '../kit/AidPicker'
import { AidSegmented } from '../kit/Segmented'
import { AidToolbar, ToolbarLabel } from '../kit/Toolbar'
import { CS_DATE, CS_FLABEL, CS_PICKER } from '../kit/csType'
import { AID_SEARCH_INPUT } from '../kit/kitStyles'
import { formatShortDate } from '../kit/dates'
import type { ApiAidHistoryKindCount } from '../../../types/api-types'
import {
  actorWords,
  chipKinds,
  KIND_LABELS,
  isSeasonDay,
  type HistoryFilterKey,
  type HistoryFilters as Filters,
} from './historyModel'

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
      className="relative flex-none"
      style={{ width: 220 }}
      onSubmit={(event) => {
        event.preventDefault()
        commit()
      }}
    >
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
      <input
        type="search"
        aria-label="Search"
        value={text}
        maxLength={200}
        placeholder="Reason, person or record id"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        className={AID_SEARCH_INPUT}
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
    <label className={`${CS_FLABEL} flex items-center justify-between gap-3 px-2 py-1`}>
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
        className={CS_DATE}
      />
    </label>
  )
}

const POPOVER =
  'bg-card text-foreground border-border absolute top-[calc(100%+4px)] left-0 z-[70] flex w-max flex-col rounded-[10px] border p-1.5 shadow-lg'

/** The Dates button's words (the mock): "Any date", or "Jun 1 – today", "Start – Jul 4". */
function datesWords(since: string | null, until: string | null): string {
  if (since === null && until === null) return 'Any date'
  return `${since === null ? 'Start' : formatShortDate(since)} – ${until === null ? 'today' : formatShortDate(until)}`
}

/**
 * One white picker for the date range (the mock's Dates picker): its popover holds From and Through as real
 * date fields and an "Any date" clear. Closes on Escape or a click outside (a click, not a press: a typed day
 * commits on the box's blur, which comes with the press, before the popover unmounts).
 */
function DatesPicker({
  since,
  until,
  onDay,
  onClear,
}: {
  since: string | null
  until: string | null
  onDay: (key: 'since' | 'until', day: string | null) => void
  onClear: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onClick)
    }
  }, [open])
  const words = datesWords(since, until)
  return (
    <div ref={ref} className="relative inline-flex flex-none">
      <button
        type="button"
        className={CS_PICKER}
        title={`Dates: ${words}`}
        aria-label={`Dates: ${words}`}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="min-w-0 truncate">{words}</span>
        <ChevronDown className="text-muted-foreground h-3.5 w-3.5 flex-none" />
      </button>
      {open && (
        <div data-testid="history-dates-popover" className={POPOVER}>
          <DayBox label="From" value={since} onDay={(day) => onDay('since', day)} />
          <DayBox label="Through" value={until} onDay={(day) => onDay('until', day)} />
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted border-border mt-1 cursor-pointer rounded-md border-t px-2 py-1 text-left text-[12.5px]"
            onClick={() => {
              onClear()
              setOpen(false)
            }}
          >
            Any date
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * History's filters (history-1; D49; mock season-history.html): ONE kit toolbar row. The kind switcher (All, then
 * one kind at a time, Rules only with `rules`, counts inside), Who, the Dates picker, the intake runs check, and
 * the search at the right. Every change goes to the URL through `onChange` (`onClear` for several keys in one
 * write); the page is in charge of it.
 */
export function HistoryFilters({
  filters,
  actors,
  kindCounts,
  total,
  canSeeRules,
  counting,
  onChange,
  onClear,
}: {
  filters: Filters
  actors: readonly string[]
  /** Each choice's count as the server counts it (H5); undefined while the read loads. */
  kindCounts: readonly ApiAidHistoryKindCount[] | undefined
  /** All's count; null while the first read loads or after it failed. */
  total: number | null
  canSeeRules: boolean
  /** A filter change is re-reading: the switcher dims. */
  counting: boolean
  onChange: (key: HistoryFilterKey, value: string | null) => void
  onClear: (keys: readonly HistoryFilterKey[]) => void
}) {
  const people =
    filters.actor !== null && !actors.includes(filters.actor) ? [...actors, filters.actor] : actors
  const loading = kindCounts === undefined
  const options = [
    {
      value: 'all',
      label: total === null ? 'All —' : 'All',
      ...(total === null ? {} : { count: total }),
    },
    ...chipKinds(canSeeRules).map((kind) => {
      const count = kindCounts?.find((c) => c.kind === kind)?.operations
      return {
        value: kind,
        label: loading || count === undefined ? `${KIND_LABELS[kind]} —` : KIND_LABELS[kind],
        ...(loading || count === undefined ? {} : { count }),
        title: `Only ${KIND_LABELS[kind].toLowerCase()} operations`,
      }
    }),
  ]
  return (
    <AidToolbar
      left={
        <>
          <AidSegmented
            label="Kind"
            value={filters.kind ?? 'all'}
            options={options}
            {...(counting ? { className: 'opacity-60' } : {})}
            onChange={(value) =>
              onChange('kind', value === 'all' || value === filters.kind ? null : value)
            }
          />
          <ToolbarLabel text="Who">
            {/* Owner ruling 10-09: the white kit picker for every select. */}
            <AidPicker
              label="Who"
              value={filters.actor ?? ''}
              options={[
                { value: '', label: 'Anyone' },
                ...people.map((actor) => ({ value: actor, label: actorWords(actor) })),
              ]}
              onChange={(actor) => onChange('actor', orNull(actor))}
              className="max-w-[220px]"
            />
          </ToolbarLabel>
          <ToolbarLabel text="Dates" plain>
            <DatesPicker
              since={filters.since}
              until={filters.until}
              onDay={onChange}
              onClear={() => onClear(['since', 'until'])}
            />
          </ToolbarLabel>
          <label
            className={`${CS_FLABEL.replace('text-muted-foreground', 'text-foreground')} inline-flex items-center gap-1.5`}
            title="Show the nightly intake runs from CampMinder (hidden by default)"
          >
            <input
              type="checkbox"
              checked={filters.intake}
              onChange={(event) => onChange('intake', event.target.checked ? '1' : null)}
            />
            Intake runs
          </label>
        </>
      }
      right={<SearchBox initial={filters.q} onSearch={(text) => onChange('q', orNull(text))} />}
    />
  )
}
