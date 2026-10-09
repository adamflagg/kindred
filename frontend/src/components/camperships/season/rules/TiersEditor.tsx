import { useEffect, useMemo, useState } from 'react'

import { CS_AMBER_NOTE, CS_FLABEL, CS_INPUT, CS_LINK_SM, CS_SMALL } from '../../kit/csType'
import { DefRef } from '../../kit/DefinitionNotes'
import { bandsOf, countNote, evenOf, type Band } from './tierGrid'

const WHOLE = /^\d+$/

/**
 * The tiers editor (spec §6.2 E.2; owner Q6): start, band width, number of tiers and the income ceiling; the bands
 * rebuild live with the +$1 edge. By hand, each tier's top is a box and the width box steps aside. The lowest final
 * tier stays hidden (fixed at 1). It reports the section to save, or null while a box can't be read.
 */
export function TiersEditor({
  tiers,
  onContent,
  problem,
}: {
  tiers: { bands: Band[]; income_ceiling: string | null; floor_tier?: number }
  onContent: (content: Record<string, unknown> | null) => void
  problem: string | null
}) {
  const even = evenOf(tiers.bands)
  const [start, setStart] = useState(String(even?.start ?? Number(tiers.bands[0]?.lower ?? 0)))
  const [width, setWidth] = useState(even === null ? '' : String(even.width))
  const [count, setCount] = useState(String(tiers.bands.length))
  const [ceiling, setCeiling] = useState(tiers.income_ceiling ?? '')
  const [byHand, setByHand] = useState(even === null)
  const [tops, setTops] = useState<string[]>(tiers.bands.map((b) => b.upper ?? ''))
  const was = tiers.bands.length

  const bands = useMemo((): Band[] | null => {
    if (!WHOLE.test(start) || !WHOLE.test(count) || Number(count) < 1) return null
    const n = Number(count)
    if (!byHand) {
      return WHOLE.test(width) && Number(width) > 0
        ? bandsOf(Number(start), Number(width), n)
        : null
    }
    const out: Band[] = []
    let lower = Number(start)
    for (let i = 0; i < n; i += 1) {
      if (i === n - 1) {
        out.push({ lower: String(lower), upper: null })
        break
      }
      const top = tops[i] ?? ''
      if (!WHOLE.test(top) || Number(top) <= lower) return null
      out.push({ lower: String(lower), upper: top })
      lower = Number(top) + 1
    }
    return out
  }, [start, width, count, byHand, tops])

  const ceilingOk = ceiling === '' || /^\d+(\.\d{1,2})?$/.test(ceiling)
  useEffect(() => {
    onContent(
      bands === null || !ceilingOk
        ? null
        : { ...tiers, bands, income_ceiling: ceiling === '' ? null : ceiling }
    )
  }, [bands, ceiling, ceilingOk, onContent, tiers])

  // Going by hand starts from the bands as they stand now, so a width just typed is not lost.
  const toggle = () => {
    if (!byHand && bands !== null) setTops(bands.map((b) => b.upper ?? ''))
    setByHand(!byHand)
  }

  const note = WHOLE.test(count) ? countNote(was, Number(count)) : null
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <label className={`${CS_FLABEL} inline-flex items-center gap-1.5`}>
          Start $
          <input
            aria-label="Start"
            className={`${CS_INPUT} w-24 text-right`}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className={`${CS_FLABEL} inline-flex items-center gap-1.5`}>
          Band width $
          <input
            aria-label="Band width"
            className={`${CS_INPUT} w-24 text-right`}
            value={byHand ? '' : width}
            placeholder={byHand ? 'by hand' : undefined}
            disabled={byHand}
            onChange={(e) => setWidth(e.target.value)}
          />
        </label>
        <label className={`${CS_FLABEL} inline-flex items-center gap-1.5`}>
          Tiers
          <input
            aria-label="Tiers"
            className={`${CS_INPUT} w-14 text-right`}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          {count !== String(was) && (
            <span className="text-amber-700 dark:text-amber-400">{`was ${String(was)}`}</span>
          )}
        </label>
        <label className={`${CS_FLABEL} inline-flex items-center gap-1.5`}>
          Income ceiling
          <DefRef n={3} /> $
          <input
            aria-label="Income ceiling"
            className={`${CS_INPUT} w-28 text-right`}
            value={ceiling}
            placeholder="none"
            onChange={(e) => setCeiling(e.target.value)}
          />
        </label>
      </div>
      {note !== null && <p className={CS_AMBER_NOTE}>{note}</p>}
      {byHand && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: Math.max(0, Number(count) - 1) }, (_, i) => (
            <label key={i} className={`${CS_SMALL} inline-flex items-center gap-1`}>
              {`Tier ${String(i + 1)} top $`}
              <input
                aria-label={`Tier ${String(i + 1)} top`}
                className={`${CS_INPUT} w-24 text-right`}
                value={tops[i] ?? ''}
                onChange={(e) =>
                  setTops((previous) => Object.assign([...previous], { [i]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
      )}
      <button type="button" className={`${CS_LINK_SM}`} onClick={toggle}>
        {byHand ? 'Back to even bands' : 'Edit bands by hand ›'}
      </button>
      {problem !== null && <p className={CS_AMBER_NOTE}>{problem}</p>}
    </div>
  )
}
