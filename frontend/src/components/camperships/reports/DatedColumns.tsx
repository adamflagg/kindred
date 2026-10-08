import { useRef, useState } from 'react'

import {
  useAidReportColumns,
  useAidSaveReportColumns,
  useFreshAidReportColumns,
} from '../../../hooks/camperships/useAidDevelopment'
import type { ApiAidDatedColumn } from '../../../types/api-types'
import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_INLINE,
} from '../../admin/lodging/lodgingStyles'
import { campToday } from '../kit/dates'
import { REPORT_NOTE } from '../kit/reportStyles'
import { refusalWords } from '../money/refusal'
import { DONE_NOTE } from '../money/toPlaceStyles'
import { datedWords, dayBefore, sameColumn, withColumn, withoutColumn } from './developmentModel'

const LINK_BUTTON = 'text-primary text-xs font-medium hover:underline'

/**
 * "+ Add a Dated Column" (spec §9.4; D68; Part C Decision 44; slice 4 Decision 17): a season as of a
 * past day, recomputed from dated records, never a frozen copy, saved with the report for everyone
 * who reads it. Each add or remove re-reads the saved list first and applies to it, so a colleague's
 * column is never dropped; the server refuses a season before 2027 or a day not yet past in its words.
 */
export function DatedColumns({ seasons }: { seasons: readonly number[] }) {
  const saved = useAidReportColumns()
  const fresh = useFreshAidReportColumns()
  const save = useAidSaveReportColumns()
  const [adding, setAdding] = useState(false)
  const [season, setSeason] = useState(seasons[0] ?? 0)
  const [day, setDay] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const inFlight = useRef(false)

  const change = async (
    apply: (list: readonly ApiAidDatedColumn[]) => ApiAidDatedColumn[],
    words: string
  ) => {
    if (inFlight.current) return
    inFlight.current = true
    setProblem(null)
    setDone(null)
    try {
      const latest = await fresh()
      await save.mutateAsync({ columns: apply(latest.columns) })
      setDone(words)
      setAdding(false)
      setDay('')
    } catch (caught) {
      setProblem(refusalWords(caught))
    } finally {
      inFlight.current = false
    }
  }

  const columns = saved.data?.columns ?? []
  // a past day only: the server refuses today and later (#2967)
  const latestDay = dayBefore(campToday())
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {columns.map((c) => (
        <span
          key={`${String(c.season)}-${c.as_of}`}
          className="bg-muted rounded px-2 py-0.5 text-xs"
        >
          {datedWords(c)}{' '}
          <button
            type="button"
            className={LINK_BUTTON}
            disabled={save.isPending}
            onClick={() =>
              void change(
                (list) => withoutColumn(list, c),
                `${datedWords(c)}: removed from the report for everyone.`
              )
            }
          >
            Remove
          </button>
        </span>
      ))}
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
            disabled={day === '' || season === 0 || save.isPending}
            onClick={() => {
              const column = { season, as_of: day }
              if (columns.some((c) => sameColumn(c, column))) {
                setProblem(`${datedWords(column)} is on the report already.`)
                return
              }
              void change(
                (list) => withColumn(list, column),
                `${datedWords(column)}: added, and saved with the report for everyone who reads it.`
              )
            }}
          >
            {save.isPending ? 'Saving…' : 'Add'}
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setAdding(false)}>
            Back
          </button>
        </span>
      ) : (
        <button type="button" className={BUTTON_SECONDARY} onClick={() => setAdding(true)}>
          + Add a Dated Column
        </button>
      )}
      {columns.length > 0 && (
        <span className={REPORT_NOTE}>
          Saved with this report; recomputed from dated records, never a frozen copy.
        </span>
      )}
      {problem !== null && <p className={`${AMBER_NOTE} basis-full`}>{problem}</p>}
      {done !== null && <p className={`${DONE_NOTE} basis-full`}>✓ {done}</p>}
    </div>
  )
}
