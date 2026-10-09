import { useState } from 'react'

import { AidPicker } from '../kit/AidPicker'
import { CS_BTN, CS_BTN2, CS_DATE } from '../kit/csType'
import { campToday } from '../kit/dates'
import { AidFilterChip, ToolbarLabel } from '../kit/Toolbar'
import { asOfChipWords, dayBefore, type AsOfPick } from './developmentModel'

interface AsOfColumnProps {
  readonly seasons: readonly number[]
  /** The column on screen now, if any. The parent owns it: it lives in component state, never the URL. */
  readonly shown: AsOfPick | null
  readonly onShow: (pick: AsOfPick) => void
  /** Drops the asked column: the chip's ✕, and Back or a new day after a refusal (it leaves the status slot). */
  readonly onRemove: () => void
  readonly pending: boolean
}

const CHIP_TITLE =
  "Recomputed from dated records, never a frozen copy; nothing is saved, and it's gone when you leave the page. ✕ removes it."
const SEASON_TITLE = 'Dated records start in 2027'

/**
 * "Show As Of a Date…" (spec §9.4; D68; final mock `?asof=form|shown`; design-language §24): one season as
 * of a past day, recomputed from dated records and saved nowhere. It draws into the page's ONE toolbar row,
 * as a fragment of it: closed, a 26px button; open, `Season` · `As of` · Show · Back; shown, a removable
 * chip (the dated column is at the right of the table). A refusal is the page's status slot, not here.
 * The server refuses a season before 2027 or a day not yet past.
 */
export function AsOfColumn({ seasons, shown, onShow, onRemove, pending }: AsOfColumnProps) {
  const [adding, setAdding] = useState(false)
  // Show closes the form once the column is on screen (the chip's ✕ is all that stays); a refusal leaves
  // it open with the typing kept.
  const [closedFor, setClosedFor] = useState<AsOfPick | null>(null)
  if (shown !== null && shown !== closedFor) {
    setClosedFor(shown)
    setAdding(false)
  }
  const [season, setSeason] = useState(seasons[0] ?? 0)
  const [day, setDay] = useState('')
  // a past day only: the server refuses today and later (#2967)
  const latestDay = dayBefore(campToday())
  if (shown !== null) {
    return (
      <AidFilterChip title={CHIP_TITLE} onClear={onRemove}>
        {asOfChipWords(shown)}
      </AidFilterChip>
    )
  }
  if (!adding) {
    return (
      <button type="button" className={CS_BTN2} onClick={() => setAdding(true)}>
        Show As Of a Date…
      </button>
    )
  }
  const chosen = seasons.includes(season) ? season : (seasons[0] ?? 0)
  return (
    <>
      <ToolbarLabel text="Season" plain>
        <span title={SEASON_TITLE} className="inline-flex">
          <AidPicker
            label="Season"
            value={chosen}
            options={seasons.map((s) => ({ value: s, label: String(s) }))}
            onChange={setSeason}
          />
        </span>
      </ToolbarLabel>
      <ToolbarLabel text="As of" plain>
        <input
          type="date"
          aria-label="As of"
          className={CS_DATE}
          value={day}
          max={latestDay}
          onChange={(event) => {
            setDay(event.target.value)
            onRemove()
          }}
        />
      </ToolbarLabel>
      <button
        type="button"
        className={CS_BTN}
        disabled={day === '' || chosen === 0 || pending}
        onClick={() => onShow({ season: chosen, day })}
      >
        {pending ? 'Showing…' : 'Show'}
      </button>
      <button
        type="button"
        className={CS_BTN2}
        onClick={() => {
          setAdding(false)
          onRemove()
        }}
      >
        Back
      </button>
    </>
  )
}
