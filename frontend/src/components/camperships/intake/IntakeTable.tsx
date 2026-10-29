import { useCallback, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'

import { POOL_NEGATIVE_INK } from '../kit/aidStyles'
import { AidTable, type AidColumn, type AidCsvExtra } from '../kit/AidTable'
import type { AidView } from '../kit/asOf'
import { CS_LINK_CELL, CS_LINK_SM, CS_PANEL, CS_PMETA, CS_POPEN_META } from '../kit/csType'
import { formatShortDate } from '../kit/dates'
import { Money } from '../kit/MoneyText'
import { AidHouseholdChip, AidNameWithChip } from '../kit/NameChips'
import { OriginMark, StatusPill } from '../kit/Pills'
import { aidActionColumn, type AidRowActionSpec } from '../kit/RowAction'
import { formatMoney } from '../kit/money'
import { AddRequestEditor } from './AddRequestEditor'
import {
  amberAid,
  answerProgram,
  askedParts,
  askedTitle,
  becameAside,
  becameSession,
  becameStatus,
  becameTitle,
  camperLabel,
  enrolledWords,
  footerWords,
  fullName,
  householdHref,
  INTAKE_WORDS,
  originOf,
  originTitle,
  targetFromRow,
  tinyName,
  whyWords,
  type SessionIndex,
} from './intakeModel'
import type { FormIntakeRowOut } from './intakeTypes'

const MUTED = 'text-muted-foreground'
const AMBER = POOL_NEGATIVE_INK
const rowKey = (row: FormIntakeRowOut) => row.key

/** The footnote marks on Form asked, Became and CampMinder aid (the registry's surface `requests-form-intake`). */
export interface IntakeMarks {
  readonly asked?: { readonly n: number; readonly title?: string | undefined } | undefined
  readonly became?: { readonly n: number; readonly title?: string | undefined } | undefined
  readonly campminder?: { readonly n: number; readonly title?: string | undefined } | undefined
}

/** What one row's action column offers (casework only): Add a Request… on a gap row, else Mark Reviewed. */
export type RowActionOf = (row: FormIntakeRowOut) => AidRowActionSpec | null

function camperTitle(row: FormIntakeRowOut): string {
  if (row.person_cm_id === 0) return `Household request: ${row.household_label ?? ''}`
  return `${camperLabel(row)} · ${row.household_cm_id > 0 ? `household ${row.household_label ?? ''}` : 'no household'}`
}

function CamperCell({ row, view }: { row: FormIntakeRowOut; view: AidView }) {
  const href = row.household_cm_id > 0 ? householdHref(view, row.household_cm_id) : null
  if (row.person_cm_id === 0)
    return href === null ? (
      <span>⌂ {row.household_label}</span>
    ) : (
      <Link to={href} className={CS_LINK_CELL}>
        ⌂ {row.household_label}
      </Link>
    )
  const name =
    href === null ? (
      <span>{row.camper_name}</span>
    ) : (
      <Link to={href} className={CS_LINK_CELL}>
        {row.camper_name}
      </Link>
    )
  return (
    <AidNameWithChip
      name={name}
      chip={
        <AidHouseholdChip
          // No household: the kit's own "no household" words, not an empty label.
          label={href === null ? undefined : row.household_label}
          href={href}
          title={href === null ? undefined : `Open the ${row.household_label ?? ''} household`}
        />
      }
    />
  )
}

function BecameCell({ row, names }: { row: FormIntakeRowOut; names: SessionIndex }) {
  const why =
    (row.gap_sessions ?? []).length > 0 || (row.became ?? []).length === 0
      ? whyWords(row, names)
      : null
  return (
    <span className="flex min-w-0 items-center gap-[5px] overflow-hidden whitespace-nowrap">
      {(row.became ?? []).map((b) => {
        const status = becameStatus(b.status)
        const origin = originOf(b)
        const aside = becameAside(b)
        return (
          <span key={b.request_id} className="flex flex-none items-center gap-[5px]">
            <StatusPill tone={status.tone} title={becameTitle(b, names)}>
              {status.words}
            </StatusPill>
            {becameSession(b, names) !== '' && (
              <span className="mr-1">{becameSession(b, names)}</span>
            )}
            {origin !== null && <OriginMark origin={origin} title={originTitle(b, INTAKE_WORDS)} />}
            {aside !== null && <span className={MUTED}>{aside}</span>}
          </span>
        )
      })}
      {why !== null && <span className={`${MUTED} min-w-0 truncate`}>{why.short}</span>}
    </span>
  )
}

function becameText(row: FormIntakeRowOut, names: SessionIndex): string {
  const parts = (row.became ?? []).map((b) => {
    const origin = originOf(b)
    return [
      becameStatus(b.status).words,
      becameSession(b, names),
      origin ? `(${origin === 'added' ? 'added' : 'reg. ask'})` : '',
    ]
      .filter(Boolean)
      .join(' ')
  })
  const why = whyWords(row, names)
  if (why !== null && ((row.gap_sessions ?? []).length > 0 || parts.length === 0))
    parts.push(why.short)
  return parts.join(' · ')
}

function becameLongTitle(row: FormIntakeRowOut, names: SessionIndex): string {
  const parts = (row.became ?? []).map((b) => becameTitle(b, names))
  const why = whyWords(row, names)
  if (why !== null && ((row.gap_sessions ?? []).length > 0 || parts.length === 0))
    parts.push(why.long)
  return parts.join(' · ')
}

function campminderTitle(row: FormIntakeRowOut, names: SessionIndex): string {
  const aid = row.campminder_aid ?? []
  if (aid.length === 0) return 'No camp aid posted in CampMinder for this family and session'
  return aid
    .map((a) => {
      const where =
        a.session_cm_id > 0
          ? fullName(a.session_cm_id, names)
          : 'a session the dashboard cannot tell'
      return a.on_request
        ? `${formatMoney(a.amount)} of camp aid posted on the ${where} request`
        : `CampMinder posted ${formatMoney(a.amount)} of camp aid on this family's ${where}${a.posted_on ? ` (${formatShortDate(a.posted_on)})` : ''}, and no request holds it. Shown, never counted, as Season's "CampMinder aid on no request".`
    })
    .join(' · ')
}

const allAid = (row: FormIntakeRowOut) =>
  (row.campminder_aid ?? []).reduce((sum, a) => sum + Math.round(a.amount * 100), 0) / 100

/** The opened row: its evidence on two lines (as Requests' detail line), then the editor while adding. */
function IntakeDetail({
  row,
  names,
  programs,
  view,
  editor,
}: {
  row: FormIntakeRowOut
  names: SessionIndex
  programs: Readonly<Record<string, string>>
  view: AidView
  editor: ReactNode
}) {
  const reg = row.registration_ask ?? null
  const evidence: ReactNode[] = []
  if (row.registration_only) evidence.push('No aid form, this season or any earlier one')
  else if (!row.filed)
    evidence.push('No aid form and no registration ask, this season or any earlier one')
  else {
    const answers = row.answers ?? []
    evidence.push(
      <>
        Aid form filed
        {answers.length === 0
          ? ' · names no program for this camper'
          : answers.map((a) => (
              <span key={`${a.program_key}:${a.option_text}`}>
                {` · ${answerProgram(a, names, programs)} “${(a.named_session_cm_id ?? 0) > 0 ? fullName(a.named_session_cm_id ?? 0, names) : a.option_text}” `}
                <b>{formatMoney(a.ask)}</b>
              </span>
            ))}
      </>
    )
  }
  if (reg !== null)
    evidence.push(
      <>
        Registration ask <b>{formatMoney(reg.amount)}</b>
        {reg.on ? ` · ${formatShortDate(reg.on)}` : ''}
      </>
    )
  for (const a of row.campminder_aid ?? [])
    if (!a.on_request)
      evidence.push(
        <span className={AMBER}>
          CampMinder aid <b>{formatMoney(a.amount)}</b>
          {a.session_cm_id > 0 ? ` on ${tinyName(a.session_cm_id, names)}` : ''}
          {a.posted_on ? ` (${formatShortDate(a.posted_on)})` : ''}, no request holds it
        </span>
      )
  const href = row.household_cm_id > 0 ? householdHref(view, row.household_cm_id) : null
  const unclear = (row.became ?? []).some((b) => b.status === 'session_unclear')
  const next =
    href === null ? (
      <span className={MUTED}>Fix the household in CampMinder</span>
    ) : (
      <Link to={href} className={CS_LINK_SM} data-aid-step="">
        {unclear ? 'Settle Session… on the household ›' : 'Open the household ›'}
      </Link>
    )
  const requests = (row.became ?? []).map((b) => {
    const source =
      b.origin === 'added'
        ? `added by ${b.added_by ? INTAKE_WORDS.who(b.added_by) : 'staff'}${b.added_at ? `, ${INTAKE_WORDS.day(b.added_at)}` : ''}${b.round1_posted != null ? `; Round 1 ${formatMoney(b.round1_posted)} posted` : ''}`
        : b.origin === 'registration_ask'
          ? 'from the registration ask'
          : b.status === 'withdrawn'
            ? 'withdrawn'
            : b.status === 'cancelled'
              ? 'cancelled'
              : 'from the form'
    return `${becameSession(b, names)} (${source})`
  })
  return (
    <div className="flex flex-col gap-1">
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 ${CS_PANEL}`}>
        <span>
          {evidence.map((e, i) => (
            <span key={i}>
              {i > 0 ? ' · ' : ''}
              {e}
            </span>
          ))}
        </span>
        <span className={CS_PMETA}>{next}</span>
      </div>
      <div className={CS_POPEN_META}>
        {requests.length === 0 ? 'No requests' : `Requests: ${requests.join(' · ')}`}
        {href === null ? (
          ' · no household'
        ) : (
          <>
            {' · '}
            <Link to={href} className={CS_LINK_SM}>
              ⌂ {row.household_label} ›
            </Link>
          </>
        )}
      </div>
      {editor}
    </div>
  )
}

const CSV_EXTRA: ReadonlyArray<AidCsvExtra<FormIntakeRowOut>> = [
  { header: 'Household', value: (r) => r.household_label ?? '' },
  {
    header: 'CampMinder aid on no request',
    value: (r) => (amberAid(r) > 0 ? amberAid(r).toFixed(2) : ''),
  },
]

/**
 * Form intake's one grid (spec 71 §2.4; the mock's `grid`): Camper · Form asked · Enrolled · Became · CampMinder aid,
 * and for casework the row's own action (design rule 20). A row opens onto its evidence; while `adding` names it, the
 * Add a Request… editor sits in its detail line. Kept rows (rule 22) are drawn but never counted.
 */
export function IntakeTable({
  rows,
  kept,
  names,
  programs,
  view,
  marks,
  actionOf,
  highlighted,
  onHighlight,
  adding,
  onAdded,
  onCancelAdd,
  csvFilename,
  emptyText,
  toolbarLead,
  toolbarStatus,
  toolbarActions,
  belowToolbar,
  closed = false,
}: {
  rows: readonly FormIntakeRowOut[]
  kept: ReadonlySet<string>
  names: SessionIndex
  programs: Readonly<Record<string, string>>
  view: AidView
  marks: IntakeMarks
  /** Null: no action column (no casework). */
  actionOf: RowActionOf | null
  highlighted: string | null
  onHighlight: (key: string | null) => void
  adding: string | null
  onAdded: (row: FormIntakeRowOut, status: string) => void
  onCancelAdd: () => void
  csvFilename: string
  emptyText: (searching: boolean) => string
  toolbarLead: ReactNode
  toolbarStatus: ReactNode
  toolbarActions: ReactNode
  belowToolbar: ReactNode
  /** CLOSED-SEASONS-DONE: a closed season's CampMinder aid in plain ink. Amber meant "needs a request", and no
   *  request will be made, so its footer sum (shown, never counted) goes too. */
  closed?: boolean
}) {
  const columns = useMemo((): Array<AidColumn<FormIntakeRowOut>> => {
    const cols: Array<AidColumn<FormIntakeRowOut>> = [
      {
        key: 'camper',
        header: 'Camper',
        width: 300,
        // The search finds a camper by their own name (and, through searchExtra, their household's).
        searchable: true,
        value: camperLabel,
        title: camperTitle,
        render: (r) => <CamperCell row={r} view={view} />,
      },
      {
        key: 'asked',
        header: 'Form asked',
        width: 262,
        mark: marks.asked,
        value: (r) => {
          const p = askedParts(r, names, programs)
          return p.reg === null ? p.main : `${p.main} · ${p.reg}`
        },
        title: (r) => askedTitle(r, names, programs),
        render: (r) => {
          const p = askedParts(r, names, programs)
          return (
            <span className="block truncate">
              <span className={p.muted ? MUTED : undefined}>{p.main}</span>
              {p.reg !== null && <span className={MUTED}>{` · ${p.reg}`}</span>}
            </span>
          )
        },
      },
      {
        key: 'enrolled',
        header: 'Enrolled',
        width: 104,
        help: "Sessions the camper is enrolled in this season (status 2), in the tiny form; each cell's title has the full names",
        value: (r) => enrolledWords(r, names).text,
        title: (r) => enrolledWords(r, names).title,
        render: (r) => {
          const e = enrolledWords(r, names)
          return (
            <span className={(r.enrolled_session_cm_ids ?? []).length === 0 ? MUTED : undefined}>
              {e.text}
            </span>
          )
        },
      },
      {
        key: 'became',
        header: 'Became',
        flex: true,
        mark: marks.became,
        value: (r) => becameText(r, names),
        title: (r) => becameLongTitle(r, names),
        render: (r) => <BecameCell row={r} names={names} />,
      },
      {
        key: 'campminder',
        header: 'CampMinder aid',
        width: 118,
        align: 'right',
        mark: marks.campminder,
        value: (r) => ((r.campminder_aid ?? []).length === 0 ? null : allAid(r)),
        csv: (r) => ((r.campminder_aid ?? []).length === 0 ? '' : allAid(r).toFixed(2)),
        title: (r) => campminderTitle(r, names),
        render: (r) =>
          (r.campminder_aid ?? []).length === 0 ? (
            <span className={MUTED}>—</span>
          ) : amberAid(r) > 0 && !closed ? (
            <Money value={amberAid(r)} className={AMBER} />
          ) : (
            <Money value={allAid(r)} />
          ),
        // The footer sums only the amber money: CampMinder aid on no request in this list (shown, never counted).
        total: (list) => {
          if (closed) return null
          const sum = list.reduce((s, r) => s + Math.round(amberAid(r) * 100), 0) / 100
          return sum > 0 ? sum : null
        },
        ...(closed ? {} : { totalClassName: AMBER }),
        footerTitle: (list) => {
          if (closed) return undefined
          const sum = list.reduce((s, r) => s + Math.round(amberAid(r) * 100), 0) / 100
          return sum > 0
            ? `${formatMoney(sum)} of CampMinder aid on no request in this list: shown, never counted`
            : undefined
        },
      },
    ]
    if (actionOf !== null)
      cols.push(aidActionColumn<FormIntakeRowOut>({ width: 132, action: actionOf }))
    return cols
  }, [view, marks, names, programs, actionOf, closed])

  const searchExtra = useCallback(
    (r: FormIntakeRowOut) => [r.household_label ?? '', r.person_cm_id || null],
    []
  )
  const renderDetail = useCallback(
    (r: FormIntakeRowOut) => (
      <IntakeDetail
        row={r}
        names={names}
        programs={programs}
        view={view}
        editor={
          adding === r.key ? (
            <AddRequestEditor
              target={targetFromRow(r)}
              names={names}
              onSaved={(status) => onAdded(r, status)}
              onCancel={onCancelAdd}
            />
          ) : null
        }
      />
    ),
    [names, programs, view, adding, onAdded, onCancelAdd]
  )

  return (
    <AidTable<FormIntakeRowOut>
      rows={rows}
      columns={columns}
      rowKey={rowKey}
      searchExtra={searchExtra}
      csvFilename={csvFilename}
      csvExtra={CSV_EXTRA}
      keptKeys={kept}
      highlighted={highlighted}
      onHighlight={onHighlight}
      renderDetail={renderDetail}
      arrowKeys
      nowrapHeaders
      bounded={rows.length > 14}
      footerSpan={4}
      footerLabel={footerWords}
      footerTitle={footerWords}
      emptyText={emptyText}
      searchPlaceholder="Find a camper…"
      searchWidth={150}
      toolbarLead={toolbarLead}
      toolbarStatus={toolbarStatus}
      toolbarActions={toolbarActions}
      belowToolbar={belowToolbar}
    />
  )
}
