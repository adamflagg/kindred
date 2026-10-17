/**
 * Velocity's pace card (#3207 PR 12, DELTA-PACE): which sessions run ahead of or behind last year.
 *
 * Owner rulings #92–#102 (2026-10-16): after the curves (#92); "level" within PACE_LEVEL_CAMPERS (#93);
 * bars in campers with "now vs last" under every name (#94); every comparable session, no cap (#95);
 * sessions not offered this year listed apart on one line (#96); retired embedded sessions fold into their
 * main session only through the card's toggle, kept in the link (#97); the viewed season decides
 * same-day vs final (#98); the kit's forest / red (#99); campers only (#100); ranked by change in two
 * columns (#101); the legend hints as one visible line (#102). The model is `buildPaceModel`.
 */
import type { ReactNode } from 'react'
import { DefRef, DefinitionNotes } from '../camperships/kit/DefinitionNotes'
import { AidSegmented } from '../camperships/kit/Segmented'
import { DELTA_INK } from '../../utils/deltaTokens'
import { formatCount, formatSignedCount } from '../../utils/numberFormat'
import { PRIORITY_DAY_PENDING, PRIORITY_DAY_PENDING_CLASS } from '../../utils/priorityDay'
import { PACE_LEVEL_CAMPERS, PACE_MIN_SCALE, paceColumns } from './velocityPace'
import type { PaceBasis, PaceModel, PaceRow } from './velocityPace'

const BAR = {
  good: 'bg-forest-600 dark:bg-forest-400',
  bad: 'bg-red-600 dark:bg-red-400',
} as const

const SMALL = 'text-muted-foreground text-xs'
const CHIP =
  'bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium'

function campers(n: number): string {
  return n === 1 ? 'camper' : 'campers'
}

function Value({ row }: { row: PaceRow }) {
  if (row.level) {
    return (
      <span className="text-muted-foreground text-right text-sm font-medium whitespace-nowrap tabular-nums">
        {row.change === 0 ? 'level' : `level (${formatSignedCount(row.change)})`}
      </span>
    )
  }
  const ahead = row.change > 0
  return (
    <span
      className={`text-right text-sm font-semibold whitespace-nowrap tabular-nums ${ahead ? DELTA_INK.good : DELTA_INK.bad}`}
    >
      {`${ahead ? '▲' : '▼'} ${formatCount(Math.abs(row.change))}`}
    </span>
  )
}

function Track({ row, scale }: { row: PaceRow; scale: number }) {
  const ahead = row.change > 0
  return (
    <span className="relative h-5">
      <span className="bg-muted/85 absolute inset-x-0 top-1.5 h-2 rounded" />
      <span className="bg-border dark:bg-muted-foreground/45 absolute top-px left-1/2 h-[18px] w-px" />
      {!row.level && row.change !== 0 && (
        <span
          data-pace-bar
          className={`absolute top-1.5 h-2 ${ahead ? `left-1/2 rounded-r ${BAR.good}` : `right-1/2 rounded-l ${BAR.bad}`}`}
          style={{ width: `${String((Math.abs(row.change) / scale) * 50)}%` }}
        />
      )}
    </span>
  )
}

function Row({ row, scale }: { row: PaceRow; scale: number }) {
  const sub = `${formatCount(row.now)} vs ${formatCount(row.prior)}${row.embedded ? ' · embedded' : ''}${
    row.folded.length ? ' · incl. folded' : ''
  }`
  return (
    <div
      data-pace-row
      className="border-border/70 grid grid-cols-[minmax(0,11.5rem)_minmax(80px,1fr)_5.2rem] items-center gap-3 border-b py-1.5 last:border-0"
    >
      <span className="flex min-w-0 flex-col">
        <b className="text-foreground truncate text-sm font-medium">{row.name}</b>
        <small className={`${SMALL} truncate tabular-nums`}>{sub}</small>
      </span>
      <Track row={row} scale={scale} />
      <Value row={row} />
    </div>
  )
}

function Chip({ swatch, n, label }: { swatch: ReactNode; n: number; label: string }) {
  return (
    <span className={CHIP}>
      {swatch}
      <b className="text-foreground font-semibold tabular-nums">{n}</b> {label}
    </span>
  )
}

function joinParts(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [' · ', part]))
}

export function VelocityPaceCard({
  model,
  year,
  priorYear,
  basis,
  firstNoteN,
  fold,
  onFold,
  pending,
}: {
  model: PaceModel
  year: number
  priorYear: number
  basis: PaceBasis
  /** The page's notes run first; the card's two continue the numbering. */
  firstNoteN: number
  fold: boolean
  onFold: (fold: boolean) => void
  /** On the priority date itself the same-point bars wait a day (ruling 9). */
  pending: boolean
}) {
  const adjacent = priorYear === year - 1
  const ofLast = adjacent ? 'last season' : String(priorYear)
  const thanLast = adjacent ? 'last season' : `in ${String(priorYear)}`
  const lastYear = adjacent ? 'last year' : `in ${String(priorYear)}`
  const live = basis === 'same_point'
  const levelN = firstNoteN
  const basisN = firstNoteN + 1
  const within = `within ${String(PACE_LEVEL_CAMPERS)} ${campers(PACE_LEVEL_CAMPERS)}`
  const scaleNote = `Bars share one scale: the largest change on the card, at least ${String(PACE_MIN_SCALE)}.`
  const notes = [
    {
      n: levelN,
      text: `Level: a session ${within} of ${ofLast} draws no bar and is counted as level, so an 8 to 12 camper session moving by one or two does not read as a trend.`,
    },
    {
      n: basisN,
      text: live
        ? `Same registration day: enrolled on day N means registered by N and not cancelled by N. Priority day is the priority date plus the day after. ${scaleNote}`
        : `Both seasons’ final counts: ${String(year)}’s registration year is over, so each session compares with its ${String(priorYear)} final. ${scaleNote}`,
    },
  ]
  const folded = model.rows.filter((row) => row.folded.length > 0)

  return (
    <div className="card-lodge p-4">
      <div className="mb-3.5 flex items-baseline gap-3">
        <h3 className="text-foreground text-base font-semibold">
          Pace vs {adjacent ? 'last year' : String(priorYear)}
        </h3>
        <span className={`${SMALL} ml-auto whitespace-nowrap`}>
          {live
            ? `vs same registration day ${thanLast}`
            : `${String(year)} final vs ${String(priorYear)} final`}
          <DefRef n={basisN} />
        </span>
      </div>

      {pending ? (
        <p className={PRIORITY_DAY_PENDING_CLASS}>{PRIORITY_DAY_PENDING}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-x-10 gap-y-1 min-[1000px]:grid-cols-2">
            {paceColumns(model.rows).map((column, i) => (
              <div key={i} data-testid="pace-column" className="flex flex-col">
                {column.map((row) => (
                  <Row key={row.cmId} row={row} scale={model.scale} />
                ))}
              </div>
            ))}
          </div>

          <div
            data-testid="pace-legend"
            className="border-border mt-3 flex flex-wrap gap-1.5 border-t pt-3"
          >
            {model.counts.behind > 0 && (
              <Chip
                swatch={<i className={`inline-block h-2 w-3 rounded-[2px] ${BAR.bad}`} />}
                n={model.counts.behind}
                label="behind"
              />
            )}
            {model.counts.level > 0 && (
              <Chip
                swatch={<i className="bg-muted-foreground inline-block h-3 w-px" />}
                n={model.counts.level}
                label="level"
              />
            )}
            {model.counts.ahead > 0 && (
              <Chip
                swatch={<i className={`inline-block h-2 w-3 rounded-[2px] ${BAR.good}`} />}
                n={model.counts.ahead}
                label="ahead"
              />
            )}
            {model.counts.new > 0 && (
              <Chip
                swatch={
                  <i className="border-muted-foreground inline-block h-2 w-3 rounded-[2px] border border-dashed" />
                }
                n={model.counts.new}
                label="new"
              />
            )}
          </div>
          <p className={`${SMALL} mt-2`}>
            Behind: fewer enrolled than {thanLast} {live ? 'at this point' : 'at the end'}. Level:{' '}
            {within} of {ofLast}
            <DefRef n={levelN} />, no bar. Ahead: more enrolled. New: didn’t run {thanLast}, so no
            pace to measure, not shown above.
          </p>
        </>
      )}

      {model.canFold && (
        <div data-app-chrome className="mt-2 flex items-center gap-1.5">
          <span className={SMALL}>Embedded sessions not offered</span>
          <AidSegmented
            label="Embedded sessions not offered"
            value={fold ? 'fold' : 'apart'}
            onChange={(value) => onFold(value === 'fold')}
            options={[
              { value: 'apart', label: 'Not-offered line' },
              { value: 'fold', label: 'Fold into main session' },
            ]}
          />
        </div>
      )}
      {model.notOffered.length > 0 && (
        <p className={`${SMALL} mt-2`}>
          Not offered this year, so not paced:{' '}
          {joinParts(
            model.notOffered.map((part) => (
              <span key={part.name}>
                <b className="text-foreground font-medium">{part.name}</b> (
                {formatCount(part.prior)} {lastYear})
              </span>
            ))
          )}
          .
        </p>
      )}
      {folded.length > 0 && (
        <p className={`${SMALL} mt-2`}>
          Folded, as Today does:{' '}
          {joinParts(
            folded.map((row) => (
              <span key={row.cmId}>
                <b className="text-foreground font-medium">{row.name}</b> {lastYear} includes{' '}
                {row.folded
                  .map((part) => `${part.name} (${formatCount(part.prior)})`)
                  .join(' and ')}
              </span>
            ))
          )}
          .
        </p>
      )}

      <DefinitionNotes notes={notes} />
    </div>
  )
}
