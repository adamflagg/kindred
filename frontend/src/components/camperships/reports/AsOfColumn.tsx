import { useState } from 'react'

import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_INLINE,
} from '../../admin/lodging/lodgingStyles'
import { campToday } from '../kit/dates'
import { REPORT_NOTE } from '../kit/reportStyles'
import { datedWords, dayBefore, NOT_SAVED_TAG, type AsOfPick } from './developmentModel'

const LINK_BUTTON = 'text-primary text-xs font-medium hover:underline'

interface AsOfColumnProps {
  readonly seasons: readonly number[]
  /** The column on screen now, if any. The parent owns it: it lives in component state, never the URL. */
  readonly shown: AsOfPick | null
  readonly onShow: (pick: AsOfPick) => void
  readonly onRemove: () => void
  readonly pending: boolean
  /** The server's own sentence when it refused the column. */
  readonly refusal: string | null
}

/**
 * "Show As Of a Date…" (spec §9.4; D68, reworked 2026-10-08): one season as of a past day, recomputed
 * from dated records and saved nowhere. It lasts until the page is left; Remove drops it sooner.
 * The server refuses a season before 2027 or a day not yet past, in its words.
 */
export function AsOfColumn({
  seasons,
  shown,
  onShow,
  onRemove,
  pending,
  refusal,
}: AsOfColumnProps) {
  const [adding, setAdding] = useState(false)
  const [season, setSeason] = useState(seasons[0] ?? 0)
  const [day, setDay] = useState('')
  // a past day only: the server refuses today and later (#2967)
  const latestDay = dayBefore(campToday())
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {shown !== null && (
        <span className="bg-muted rounded px-2 py-0.5 text-xs">
          {datedWords(shown)} · {NOT_SAVED_TAG}{' '}
          <button type="button" className={LINK_BUTTON} onClick={onRemove}>
            Remove
          </button>
        </span>
      )}
      {adding ? (
        <span className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            Season
            <select
              className={FIELD_INLINE}
              value={season}
              onChange={(event) => setSeason(Number(event.target.value))}
            >
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            as of
            <input
              type="date"
              aria-label="As of"
              className={FIELD_INLINE}
              value={day}
              max={latestDay}
              onChange={(event) => setDay(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={day === '' || season === 0 || pending}
            onClick={() => onShow({ season: season || (seasons[0] ?? 0), day })}
          >
            {pending ? 'Showing…' : 'Show'}
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setAdding(false)}>
            Back
          </button>
        </span>
      ) : (
        <button type="button" className={BUTTON_SECONDARY} onClick={() => setAdding(true)}>
          Show As Of a Date…
        </button>
      )}
      {shown !== null && (
        <span className={REPORT_NOTE}>
          Recomputed from dated records, never a frozen copy; nothing is saved.
        </span>
      )}
      {refusal !== null && <p className={`${AMBER_NOTE} basis-full`}>{refusal}</p>}
    </div>
  )
}
