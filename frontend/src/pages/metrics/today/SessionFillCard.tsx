/**
 * Analytics › Today › Session fill (#3207 PR 8). This year's sessions in session order (ruling 1, B), never a
 * session last year ran that this year does not (#14). Each compares with its own match last year, and the
 * total adds only matched sessions (#15). "Fill: Bunk plan | Budget goal" (board B), Bunk plan by default,
 * kept in the URL (`?fill=`).
 */
import { Link, useLocation } from 'react-router'
import { AidSegmented } from '../../../components/camperships/kit/Segmented'
import { DefRef } from '../../../components/camperships/kit/DefinitionNotes'
import { CS_CARD_HEADING, CS_LINK_SM, CS_SMALL } from '../../../components/camperships/kit/csType'
import { PILL, TABLE_CARD } from '../../../components/camperships/kit/kitStyles'
import {
  ROW_HEADING,
  ROW_TOTAL,
  TD_LABEL,
  TD_NUMBER,
  TH_LABEL,
  TH_NUMBER,
} from '../../../components/camperships/kit/reportStyles'
import { formatCount } from '../../../utils/numberFormat'
import type { ApiTodaySessions } from '../../../types/api-types'
import { Change, FoldedFigure } from './todayParts'
import {
  analyticsHref,
  basisWords,
  priorBasisOf,
  fillGroups,
  fillTotal,
  openPlaces,
  scopeRows,
  type FillBasis,
  type FillRow,
} from './todayModel'

const TRACK = 'bg-[color-mix(in_oklab,var(--color-muted)_85%,var(--color-card))]'
const STRIPES =
  'bg-[repeating-linear-gradient(45deg,var(--color-amber-500)_0_3px,var(--color-amber-300)_3px_6px)]'
const TD_BASE_MID = TD_LABEL.replace('align-top', 'align-middle').replace('min-w-28 ', '')
const MUTED_CELL = `${TD_BASE_MID} text-muted-foreground text-xs whitespace-nowrap`

/** The kit meter (AidMeter's track): forest to the fill, amber stripes past 100% on the bunk plan. */
function Meter({ enrolled, of, basis }: { enrolled: number; of: number | null; basis: FillBasis }) {
  if (!of) return <span className={`block h-2.5 rounded-full ${TRACK}`} />
  const pct = (enrolled / of) * 100
  const over = basis === 'plan' && pct > 100 ? pct - 100 : 0
  return (
    <span
      data-testid="fill-meter"
      className={`relative block h-2.5 min-w-0 overflow-hidden rounded-full ${TRACK}`}
    >
      <i
        className="bg-forest-700 dark:bg-forest-400 absolute inset-y-0"
        style={{ left: 0, width: `${String(Math.min(pct, 100))}%` }}
      />
      {over > 0 && (
        <i
          className={`absolute inset-y-0 ${STRIPES}`}
          style={{
            left: `${String(100 - Math.min(over, 100))}%`,
            width: `${String(Math.min(over, 100))}%`,
          }}
        />
      )}
    </span>
  )
}

const pct = (enrolled: number, of: number | null) =>
  of ? `${String(Math.round((enrolled / of) * 100))}%` : '—'

interface Props {
  data: ApiTodaySessions
  oneSession: string | null
  basis: FillBasis
  onBasis: (basis: FillBasis) => void
  pending: boolean
  notes: { same?: number | undefined; sessions?: number | undefined; fill?: number | undefined }
}

export function SessionFillHead({
  data,
  oneSession,
  basis,
  onBasis,
  notes,
}: Omit<Props, 'pending'>) {
  const location = useLocation()
  const rows = scopeRows(data.rows, oneSession !== null)
  const plan = basis === 'plan'
  const bedsKnown = rows.some((r) => r.beds != null)
  const goalsKnown =
    rows.some((r) => r.goal != null) || (oneSession !== null && data.rows[0]?.goal != null)
  const types = new Set(data.rows.map((r) => r.session_type))
  const noBeds = [...types].every((t) => t === 'scit' || t === 'tli')
    ? 'places not set yet'
    : types.has('quest') || types.has('scit') || types.has('tli')
      ? 'beds and places not set yet'
      : 'beds not planned yet'
  const unit =
    oneSession !== null ? `${oneSession} by cabin group` : `${String(rows.length)} sessions`
  return (
    <div className="flex items-center gap-2.5">
      <h2 className={CS_CARD_HEADING}>Session fill</h2>
      <span className={`${CS_SMALL} min-w-0 truncate`}>
        {unit} · counted in camper-sessions
        {notes.sessions !== undefined && <DefRef n={notes.sessions} />}
        {plan && !bedsKnown && ` · ${noBeds}`}
        {!plan && !goalsKnown && ' · goal not set yet'}
      </span>
      <span className="ml-auto flex flex-none items-center gap-3">
        <span data-app-chrome className="flex items-center gap-1.5">
          <span className={CS_SMALL}>Fill</span>
          <AidSegmented
            label="Fill"
            value={basis}
            onChange={onBasis}
            options={[
              { value: 'plan', label: 'Bunk plan' },
              { value: 'goal', label: 'Budget goal' },
            ]}
          />
        </span>
        {plan ? (
          <Link
            data-app-chrome
            className={`${CS_LINK_SM} whitespace-nowrap`}
            to={analyticsHref('/analytics/registration/availability', location.search)}
          >
            Availability ›
          </Link>
        ) : (
          <Link
            data-app-chrome
            className={`${CS_LINK_SM} whitespace-nowrap`}
            to={analyticsHref('/analytics/registration/forecast', location.search)}
          >
            Forecast ›
          </Link>
        )}
      </span>
    </div>
  )
}

export function SessionFillTable({
  data,
  oneSession,
  basis,
  pending,
  notes,
}: Omit<Props, 'onBasis'>) {
  const rows = scopeRows(data.rows, oneSession !== null)
  const total = fillTotal(rows)
  const plan = basis === 'plan'
  const showBeds = plan && rows.some((r) => r.beds != null)
  const sessionGoal = oneSession !== null ? (data.rows[0]?.goal ?? null) : null
  const showGoal = !plan && (rows.some((r) => r.goal != null) || sessionGoal != null)
  const hasPills = showBeds && rows.some((r) => openPlaces(r, data.limited_threshold).length > 0)
  const basisCols = showBeds ? 3 : showGoal ? 3 : 0
  const compared = priorBasisOf(data)
  const same = basisWords(compared, data.prior_year)
  const colCount = 1 + 1 + basisCols + (hasPills ? 1 : 0) + 1 + 1

  // A row whose basis can't be read says why across the basis columns, with no hover needed.
  const basisGap = (r: FillRow): string | null => {
    if (showBeds && r.beds == null) return 'no beds or places set'
    if (showGoal && r.goal == null)
      return r.goalPerSession ? 'goal is set per session' : 'goal not set yet'
    return null
  }

  const sameCell = (
    now: number,
    prior: number | null,
    isNew: boolean,
    priorParts: FillRow['priorParts']
  ) => (
    <>
      <Change now={now} prior={prior} pending={pending} />
      {prior != null && !pending && (
        <span className="text-muted-foreground font-normal">
          {' · '}
          <FoldedFigure parts={priorParts} priorYear={data.prior_year}>
            {formatCount(prior)}
          </FoldedFigure>
        </span>
      )}
      {isNew && <span className="text-muted-foreground text-xs font-normal"> new this year</span>}
    </>
  )

  const row = (r: FillRow) => {
    const gap = basisGap(r)
    const pills = hasPills ? openPlaces(r, data.limited_threshold) : []
    return (
      <tr key={r.key}>
        <td className={`${TD_LABEL} whitespace-nowrap`}>
          <span className="text-foreground block min-w-0 truncate font-medium" title={r.name}>
            {r.name}
          </span>
        </td>
        <td className={TD_NUMBER}>{formatCount(r.enrolled)}</td>
        {basisCols > 0 &&
          (gap ? (
            <td colSpan={basisCols} className={MUTED_CELL}>
              {gap}
            </td>
          ) : (
            <>
              <td className={TD_NUMBER}>{formatCount(showBeds ? r.beds : r.goal)}</td>
              <td className={TD_BASE_MID}>
                <Meter enrolled={r.enrolled} of={showBeds ? r.beds : r.goal} basis={basis} />
              </td>
              <td className={TD_NUMBER}>{pct(r.enrolled, showBeds ? r.beds : r.goal)}</td>
            </>
          ))}
        {hasPills && (
          <td className={TD_BASE_MID}>
            <span className="flex flex-wrap gap-1">
              {pills.map((p) => (
                <span key={p.words} className={`${p.full ? PILL.amber : PILL.muted} flex-none`}>
                  {p.words}
                </span>
              ))}
            </span>
          </td>
        )}
        <td className={`${TD_NUMBER} text-muted-foreground`}>{formatCount(r.waitlisted)}</td>
        <td className={TD_NUMBER}>
          {sameCell(
            r.enrolled,
            r.prior,
            compared === 'same_point' && r.prior == null,
            r.priorParts
          )}
        </td>
      </tr>
    )
  }

  const groups = fillGroups(rows)
  const totalBasis = showBeds ? total.beds : showGoal ? (sessionGoal ?? total.goal) : null
  const totalEnrolled = showBeds
    ? total.bedsEnrolled
    : showGoal && sessionGoal != null
      ? total.enrolled
      : total.goalEnrolled

  return (
    <div className={TABLE_CARD}>
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          <col style={basisCols > 0 ? { width: 148 } : undefined} />
          <col style={{ width: 66 }} />
          {basisCols > 0 && (
            <>
              <col style={{ width: 52 }} />
              <col />
              <col style={{ width: 48 }} />
            </>
          )}
          {hasPills && <col style={{ width: 184 }} />}
          <col style={{ width: 62 }} />
          <col style={{ width: 150 }} />
        </colgroup>
        <thead>
          <tr>
            <th className={TH_LABEL}>{oneSession !== null ? 'Cabins' : 'Session'}</th>
            <th className={TH_NUMBER}>Enrolled</th>
            {basisCols > 0 && (
              <>
                <th className={TH_NUMBER}>
                  {showBeds ? 'Beds' : 'Goal'}
                  {notes.fill !== undefined && <DefRef n={notes.fill} />}
                </th>
                <th className={TH_LABEL}>Fill</th>
                <th className={TH_NUMBER}>%</th>
              </>
            )}
            {hasPills && <th className={TH_LABEL}>Open places</th>}
            <th className={TH_NUMBER}>Waitlist</th>
            <th className={TH_NUMBER}>
              {same}
              {notes.same !== undefined && <DefRef n={notes.same} />}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => [
            ...(g.label
              ? [
                  <tr key={`group-${g.label}`}>
                    <td colSpan={colCount} className={ROW_HEADING}>
                      {g.label}
                      <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                        {g.rows.length} {g.rows.length === 1 ? 'session' : 'sessions'}
                      </span>
                    </td>
                  </tr>,
                ]
              : []),
            ...g.rows.map(row),
          ])}
          <tr className={ROW_TOTAL}>
            <td className={`${TD_LABEL} whitespace-nowrap`}>
              {oneSession ?? `${String(rows.length)} ${rows.length === 1 ? 'session' : 'sessions'}`}
            </td>
            <td className={TD_NUMBER}>{formatCount(total.enrolled)}</td>
            {basisCols > 0 &&
              (totalBasis == null ? (
                <td colSpan={basisCols} className={MUTED_CELL}>
                  {showBeds ? 'no beds or places set' : 'goal not set yet'}
                </td>
              ) : (
                <>
                  <td className={TD_NUMBER}>{formatCount(totalBasis)}</td>
                  <td className={TD_BASE_MID}>
                    <Meter enrolled={totalEnrolled} of={totalBasis} basis={basis} />
                  </td>
                  <td className={TD_NUMBER}>{pct(totalEnrolled, totalBasis)}</td>
                </>
              ))}
            {hasPills && <td className={TD_BASE_MID} />}
            <td className={TD_NUMBER}>{formatCount(total.waitlisted)}</td>
            <td className={TD_NUMBER}>
              {sameCell(total.matchedEnrolled, total.prior, false, total.priorParts)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
