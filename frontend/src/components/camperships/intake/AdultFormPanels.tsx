import { CS_PANEL_RULE, CS_PHEAD } from '../kit/csType'
import { formatShortDate } from '../kit/dates'
import { POOL_NEGATIVE_INK } from '../kit/aidStyles'
import {
  alsoLine,
  figureRows,
  matchEvidence,
  noteParts,
  PRICED_FIELDS,
  responseLines,
  signedLine,
  type Seg,
} from './adultFormModel'
import type { FormResponseView } from './adultFormTypes'
import type { SessionIndex } from './intakeModel'

const MUTED = 'text-muted-foreground'
/**
 * The opened row's three panels (the mock's `.cf-detail .cf-open`): 5 : 4 : 5 under a dashed amber rule, divided by
 * the same rule, at the opened row's 12.5/18. The same grid as To place's opened row.
 */
const PANELS = `mt-[7px] grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,5fr)] border-t pt-[7px] text-[12.5px] leading-[18px] ${CS_PANEL_RULE}`
const LEFT = `flex min-w-0 flex-col items-start gap-0.5 pr-3.5`
const MIDDLE = `flex min-w-0 flex-col items-start gap-0.5 border-l px-3.5 ${CS_PANEL_RULE}`
const RIGHT = `flex min-w-0 flex-col items-start gap-0.5 border-l pl-3.5 ${CS_PANEL_RULE}`
/** Label · figure · its note (K2 a: the note beside its figure, owner 10-29). */
const FIGS =
  'grid w-full grid-cols-[max-content_max-content_minmax(0,1fr)] items-baseline gap-x-2.5 gap-y-px'

function Segs({ segs }: { segs: readonly Seg[] }) {
  return (
    <>
      {segs.map((s, i) =>
        s.bold === true ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>
      )}
    </>
  )
}

function Note({ note }: { note: string }) {
  return (
    <span data-note="" className={`${MUTED} min-w-0`}>
      {noteParts(note).map((p, i) =>
        p.quoted ? (
          <span key={i} data-quoted="" className="text-foreground">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  )
}

/**
 * An adult aid form response opened on Form intake (adult aid form design §10; mock v2 steps 14–16): its figures
 * with each parse note beside its figure (K2 a), the answers that price nothing on one line, the special
 * circumstances and signature, then the match evidence and every response. POC, race/ethnicity and gender identity
 * are never in the read; the respondent email shows only inside Link….
 */
export function AdultFormPanels({
  response,
  year,
  names,
}: {
  response: FormResponseView
  year: number
  names: SessionIndex
}) {
  const evidence = matchEvidence(response, names)
  return (
    <div data-adult-form-panels="" className={PANELS}>
      <div className={LEFT}>
        <span
          className={CS_PHEAD}
        >{`Adult aid form · ${formatShortDate(response.submitted_at)}`}</span>
        <div className={FIGS}>
          {figureRows(response, year).map((f, i) => (
            <div key={f.label} data-figure={PRICED_FIELDS[i]} className="contents">
              <span className={`${MUTED} font-semibold whitespace-nowrap`}>{f.label}</span>
              <span
                data-value=""
                className={`text-right whitespace-nowrap tabular-nums ${f.value === null ? `${POOL_NEGATIVE_INK} italic` : ''}`}
              >
                {f.value ?? 'unknown'}
              </span>
              {f.note === '' ? <span /> : <Note note={f.note} />}
            </div>
          ))}
        </div>
        <div className={`${MUTED} mt-[3px]`}>{alsoLine(response)}</div>
      </div>
      <div className={MIDDLE}>
        <span className={CS_PHEAD}>Special circumstances</span>
        {response.special_circumstances.trim() === '' ? (
          <span className={MUTED}>Left blank</span>
        ) : (
          <span className="text-foreground italic">{`“${response.special_circumstances}”`}</span>
        )}
        <div className={`${MUTED} mt-[3px]`}>{signedLine(response)}</div>
      </div>
      <div className={RIGHT}>
        <span className={CS_PHEAD}>Match</span>
        <span>
          <Segs segs={evidence.segs} />
          {evidence.muted !== '' && <span className={MUTED}>{` ${evidence.muted}`}</span>}
        </span>
        <span className={`${CS_PHEAD} mt-[7px]`}>Responses</span>
        <ul className="m-0 list-none p-0">
          {responseLines(response).map((line) => (
            <li key={line.text} className={line.current ? 'text-foreground' : MUTED}>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
