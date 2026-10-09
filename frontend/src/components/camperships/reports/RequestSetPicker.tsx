import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { AidRequestSet } from '../../../services/camperships/aidApi'
import type { ApiAidRequestSetNote } from '../../../types/api-types'
import { CS_DATE, CS_PICKER } from '../kit/csType'
import { formatShortDate } from '../kit/dates'

const POPOVER =
  'bg-card text-foreground border-border absolute top-[calc(100%+4px)] left-0 z-[70] flex w-max min-w-full flex-col rounded-[10px] border p-1 shadow-lg'
const ROW =
  'hover:bg-muted relative flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2.5 pl-[22px] text-left text-[12.5px] leading-[18px] whitespace-nowrap'
const CHECK = 'text-primary absolute left-[7px]'

/** What the button reads: short, so the controls row keeps its room for Copy and Download CSV. */
function shortWords(value: AidRequestSet): string {
  if (value.kind === 'deadline') return 'By the R1 deadline'
  if (value.kind === 'date') return `Through ${formatShortDate(value.date)}`
  return 'All requests'
}

/** Which requests count, in full (the button's title); the server's label when it sent one. */
function fullWords(value: AidRequestSet, note: ApiAidRequestSetNote | null): string {
  if (note !== null) return note.label
  if (value.kind === 'deadline') return 'requests received through the Round 1 deadline'
  if (value.kind === 'date') return `requests received through ${formatShortDate(value.date)}`
  return 'every request'
}

/** The requests the set leaves out, later ones and those with no received date (the retired sentence's words). */
function leftOutWords(note: ApiAidRequestSetNote | null): string {
  if (note === null) return ''
  const later = note.left_out > 0 ? `${String(note.left_out)} later requests left out` : ''
  const unknown = note.unknown > 0 ? `${String(note.unknown)} with no received date` : ''
  if (later !== '' && unknown !== '') return ` ${later}, and ${unknown}.`
  if (later !== '') return ` ${later}.`
  return unknown !== '' ? ` ${unknown} left out.` : ''
}

/**
 * Statistics' one Requests picker (final mock reports-statistics.html; owner rev 10-09, "picker
 * form"): the white 26px picker whose popover lists All requests, Through the R1 deadline and, last,
 * the product's date field (no preset dates). The two real choices and the date are one value (the URL's
 * `through`), so they can never both be on. Typing a day keeps the popover open; clearing it returns to
 * all requests; Escape and a press outside close it.
 */
export function RequestSetPicker({
  value,
  note,
  onChange,
}: {
  readonly value: AidRequestSet
  /** The server's note for the set the figures were priced on: its words and the requests it left out. */
  readonly note: ApiAidRequestSetNote | null
  readonly onChange: (next: AidRequestSet) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPress = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPress)
    }
  }, [open])

  const shown = shortWords(value)
  const leftOut = leftOutWords(note)
  const choose = (next: AidRequestSet) => {
    onChange(next)
    setOpen(false)
  }
  return (
    <div ref={ref} className="relative inline-flex flex-none">
      <button
        type="button"
        className={CS_PICKER}
        title={`Which requests count: ${fullWords(value, note)}${leftOut}`}
        aria-label={`Requests: ${shown}`}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="min-w-0 truncate">{shown}</span>
        <ChevronDown className="text-muted-foreground h-3.5 w-3.5 flex-none" aria-hidden />
      </button>
      {open && (
        <div data-testid="request-set-popover" className={POPOVER}>
          <button type="button" className={ROW} onClick={() => choose({ kind: 'all' })}>
            {value.kind === 'all' && <span className={CHECK}>✓</span>}
            All requests
          </button>
          <button type="button" className={ROW} onClick={() => choose({ kind: 'deadline' })}>
            {value.kind === 'deadline' && <span className={CHECK}>✓</span>}
            Through the R1 deadline
          </button>
          <label className={`${ROW} cursor-default`}>
            {value.kind === 'date' && <span className={CHECK}>✓</span>}
            Received through
            <input
              type="date"
              aria-label="Received through"
              title="Type or pick any day"
              className={CS_DATE}
              value={value.kind === 'date' ? value.date : ''}
              onChange={(event) => {
                const next = event.target.value
                onChange(next === '' ? { kind: 'all' } : { kind: 'date', date: next })
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}
