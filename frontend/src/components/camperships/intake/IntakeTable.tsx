import { useCallback, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'

import { POOL_NEGATIVE_INK } from '../kit/aidStyles'
import { AidTable, type AidColumn, type AidCsvExtra } from '../kit/AidTable'
import type { AidView } from '../kit/asOf'
import { CS_LINK_CELL, CS_LINK_SM, CS_PANEL, CS_PMETA, CS_POPEN_META } from '../kit/csType'
import { programLabel } from '../requests/programLabel'
import { formatShortDate } from '../kit/dates'
import { Money } from '../kit/MoneyText'
import { AidHouseholdChip, AidNameWithChip } from '../kit/NameChips'
import { FormSourceMark, OriginMark, StatusPill } from '../kit/Pills'
import { aidActionColumn, type AidRowActionSpec } from '../kit/RowAction'
import { formatMoney } from '../kit/money'
import { AdultFormPanels } from './AdultFormPanels'
import {
  becameFlag,
  formChangeToReview,
  gridAmberAid,
  gridFooterWords,
  responseAsked,
  responseBecame,
  responseCamper,
  responseNoRequestLine,
  type IntakeGridRow,
} from './adultFormModel'
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
  campDayOf,
  enrolledWords,
  fullName,
  householdHref,
  INTAKE_WORDS,
  originOf,
  originTitle,
  tinyName,
  formEvidence,
  whyWords,
  type SessionIndex,
} from './intakeModel'
import type { FormIntakeRowOut, FormResponseOut } from './intakeTypes'

const MUTED = 'text-muted-foreground'
const AMBER = POOL_NEGATIVE_INK
const rowKey = (r: IntakeGridRow) => r.key
/** The adult aid form's mark in Form asked (K1 a): its title says which form it is. */
const ADULT_FORM_TITLE =
  "The adult aid form: the Google form adults fill in for Family Camp and Adult Weekends. It prices that adult's own request."

/** The footnote marks on Form asked, Became and CampMinder aid (the registry's surface `requests-form-intake`). */
export interface IntakeMarks {
  readonly asked?: { readonly n: number; readonly title?: string | undefined } | undefined
  readonly became?: { readonly n: number; readonly title?: string | undefined } | undefined
  readonly campminder?: { readonly n: number; readonly title?: string | undefined } | undefined
}

/**
 * What one row's action column offers (casework only): Add a Request… on a gap row, else Mark Reviewed; on a response
 * no person holds, Link… · Ignore… (Link… alone on an ignored one).
 */
export type RowActionOf = (
  row: IntakeGridRow
) => AidRowActionSpec | readonly AidRowActionSpec[] | null

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

function BecameCell({
  row,
  names,
  programs,
}: {
  row: FormIntakeRowOut
  names: SessionIndex
  programs: Readonly<Record<string, string>>
}) {
  const why =
    (row.gap_sessions ?? []).length > 0 || (row.became ?? []).length === 0
      ? whyWords(row, names, programs)
      : null
  return (
    <span className="flex min-w-0 items-center gap-[5px] overflow-hidden whitespace-nowrap">
      {(row.became ?? []).map((b) => {
        const status = becameStatus(b.status)
        const origin = originOf(b)
        const aside = becameAside(b)
        const flag = becameFlag(b)
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
            {flag !== null && (
              <span className={`${AMBER} cursor-help`} title={flag.title}>
                {flag.words}
              </span>
            )}
          </span>
        )
      })}
      {why !== null && <span className={`${MUTED} min-w-0 truncate`}>{why.short}</span>}
    </span>
  )
}

function becameText(
  row: FormIntakeRowOut,
  names: SessionIndex,
  programs: Readonly<Record<string, string>>
): string {
  const parts = (row.became ?? []).map((b) => {
    const origin = originOf(b)
    return [
      becameStatus(b.status).words,
      becameSession(b, names),
      origin ? `(${origin === 'added' ? 'added' : 'reg. ask'})` : '',
      becameFlag(b)?.words ?? '',
    ]
      .filter(Boolean)
      .join(' ')
  })
  const why = whyWords(row, names, programs)
  if (why !== null && ((row.gap_sessions ?? []).length > 0 || parts.length === 0))
    parts.push(why.short)
  return parts.join(' · ')
}

function becameLongTitle(
  row: FormIntakeRowOut,
  names: SessionIndex,
  programs: Readonly<Record<string, string>>
): string {
  const parts = (row.became ?? []).map((b) =>
    [becameTitle(b, names), becameFlag(b)?.title ?? ''].filter(Boolean).join(' · ')
  )
  const why = whyWords(row, names, programs)
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
  response,
  flagged,
  names,
  programs,
  view,
  editor,
}: {
  row: FormIntakeRowOut
  /** The row's live adult aid form response: its three panels follow the evidence. */
  response: FormResponseOut | null
  /** A second response after a decision, flagged and not applied. */
  flagged: FormResponseOut | null
  names: SessionIndex
  programs: Readonly<Record<string, string>>
  view: AidView
  editor: ReactNode
}) {
  const reg = row.registration_ask ?? null
  const evidence: ReactNode[] = []
  const shown = formEvidence(row, programs)
  if (shown.noForm !== null) evidence.push(shown.noForm)
  // The adult aid form's answers say so, with the day it was filed (mock v2 steps 3–4, 15); CampMinder's keep theirs.
  const adult = (row.answers ?? []).filter((a) => a.form_source === 'google_form')
  const campminder = (row.answers ?? []).filter((a) => a.form_source !== 'google_form')
  if (adult.length > 0) {
    const flag = (row.became ?? []).map(becameFlag).find((f) => f !== null) ?? null
    evidence.push(
      <>
        {`Adult aid form filed${response?.submitted_at ? ` ${campDayOf(response.submitted_at)}` : ''}`}
        {adult.map((a) => (
          <span key={`${a.program_key}:${a.option_text}`}>
            {` · ${answerProgram(a, names, programs)} “${a.option_text}” `}
            <b>{formatMoney(a.ask)}</b>
          </span>
        ))}
        {flag !== null && <span className={AMBER} title={flag.title}>{` · ⚠ ${flag.words}`}</span>}
      </>
    )
  }
  if (shown.filed && (campminder.length > 0 || adult.length === 0)) {
    const answers = campminder
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
              : b.form_source === 'google_form'
                ? 'from the adult aid form'
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
      {response !== null && (
        <AdultFormPanels
          response={response}
          year={view.year}
          names={names}
          change={formChangeToReview(row)?.form_change ?? null}
          flagged={flagged}
        />
      )}
      {editor}
    </div>
  )
}

/**
 * A response no person holds, opened (mock v2 steps 6–12, 17–19): what it asked, that no request is made until it is
 * linked (or who ignored it), then its three panels and the editor Link… or Ignore… opened.
 */
function ResponseDetail({
  response,
  names,
  programs,
  year,
  editor,
}: {
  response: FormResponseOut
  names: SessionIndex
  programs: Readonly<Record<string, string>>
  year: number
  editor: ReactNode
}) {
  const ignored = response.match_status === 'ignored'
  return (
    <div className="flex flex-col gap-1">
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 ${CS_PANEL}`}>
        <span>
          {`Adult aid form filed${response.submitted_at ? ` ${campDayOf(response.submitted_at)}` : ''} · ${programLabel(programs, response.program_key ?? '')} “${response.program_choice ?? ''}” `}
          <b>{response.ask == null ? 'ask unknown' : formatMoney(response.ask)}</b>
        </span>
        <span className={`${CS_PMETA} ${MUTED}`}>
          {ignored ? 'Link… on the row undoes it' : 'Link… or Ignore… on the row'}
        </span>
      </div>
      <div className={CS_POPEN_META}>{responseNoRequestLine(response)}</div>
      <AdultFormPanels response={response} year={year} names={names} />
      {editor}
    </div>
  )
}

const CSV_EXTRA: ReadonlyArray<AidCsvExtra<IntakeGridRow>> = [
  { header: 'Household', value: (r) => (r.kind === 'row' ? (r.row.household_label ?? '') : '') },
  {
    header: 'CampMinder aid on no request',
    value: (r) => (gridAmberAid(r) > 0 ? gridAmberAid(r).toFixed(2) : ''),
  },
]

const DASH = <span className={MUTED}>—</span>

/** The Camper cell of a response no person holds: the typed name in quotes, a dashed "not linked" chip. */
function ResponseCamperCell({ response }: { response: FormResponseOut }) {
  const c = responseCamper(response)
  return (
    <AidNameWithChip
      name={<span>{c.name}</span>}
      chip={<AidHouseholdChip label={c.chip} href={null} title={c.chipTitle} />}
    />
  )
}

function ResponseAskedCell({
  response,
  names,
  programs,
}: {
  response: FormResponseOut
  names: SessionIndex
  programs: Readonly<Record<string, string>>
}) {
  return (
    <span className="block truncate">
      <span className="mr-[5px] align-[1px]">
        <FormSourceMark source="google_form" title={ADULT_FORM_TITLE} />
      </span>
      {responseAsked(response, names, programs).main}
    </span>
  )
}

/** A row whose answers are gone (its response deleted in Google or unlinked) still reads as what its response asked. */
const askedByResponse = (r: IntakeGridRow): FormResponseOut | null =>
  r.kind === 'row' && (r.row.answers ?? []).length === 0 ? r.response : null

/** Each column's reading of a grid row: a Form intake row as ever, or a response no person holds. */
const onRow =
  <T,>(row: (r: FormIntakeRowOut) => T, response: (r: FormResponseOut) => T) =>
  (r: IntakeGridRow): T =>
    r.kind === 'row' ? row(r.row) : response(r.response)

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
  editorOf,
  csvFilename,
  emptyText,
  toolbarLead,
  toolbarStatus,
  toolbarActions,
  belowToolbar,
  bandRow,
  closed = false,
}: {
  rows: readonly IntakeGridRow[]
  kept: ReadonlySet<string>
  names: SessionIndex
  programs: Readonly<Record<string, string>>
  view: AidView
  marks: IntakeMarks
  /** Null: no action column (no casework). */
  actionOf: RowActionOf | null
  highlighted: string | null
  onHighlight: (key: string | null) => void
  /** The editor a row's action opened (Add a Request…, Link…, Ignore…), drawn in its detail line; null for none. */
  editorOf: (row: IntakeGridRow) => ReactNode
  csvFilename: string
  emptyText: (searching: boolean) => string
  toolbarLead: ReactNode
  toolbarStatus: ReactNode
  toolbarActions: ReactNode
  belowToolbar: ReactNode
  /** A fact for every row in view: the refused Google read (mock v2 callout 4). */
  bandRow?:
    | { readonly tone: 'warn' | 'group'; readonly content: ReactNode; readonly title?: string }
    | undefined
  /** CLOSED-SEASONS-DONE: a closed season's CampMinder aid in plain ink. Amber meant "needs a request", and no
   *  request will be made, so its footer sum (shown, never counted) goes too. */
  closed?: boolean
}) {
  const columns = useMemo((): Array<AidColumn<IntakeGridRow>> => {
    const cols: Array<AidColumn<IntakeGridRow>> = [
      {
        key: 'camper',
        header: 'Camper',
        // Adult aid form mock v2, callout 1: 300 → 282, giving Form asked the room for its chip.
        width: 282,
        // The search finds a camper by their own name (and, through searchExtra, their household's).
        searchable: true,
        value: onRow(camperLabel, (r) => responseCamper(r).name),
        title: onRow(camperTitle, (r) => responseCamper(r).title),
        render: onRow(
          (r) => <CamperCell row={r} view={view} />,
          (r) => <ResponseCamperCell response={r} />
        ),
      },
      {
        key: 'asked',
        header: 'Form asked',
        width: 280,
        mark: marks.asked,
        value: (g) => {
          const held = askedByResponse(g)
          if (held !== null) return responseAsked(held, names, programs).main
          return onRow(
            (r) => {
              const p = askedParts(r, names, programs)
              return p.reg === null ? p.main : `${p.main} · ${p.reg}`
            },
            (r) => responseAsked(r, names, programs).main
          )(g)
        },
        title: (g) => {
          const held = askedByResponse(g)
          if (held !== null) return responseAsked(held, names, programs).title
          return onRow(
            (r) => askedTitle(r, names, programs),
            (r) => responseAsked(r, names, programs).title
          )(g)
        },
        render: (g) => {
          const held = askedByResponse(g)
          return onRow(
            (r) => {
              const p = askedParts(r, names, programs)
              return (
                <span className="block truncate">
                  {/* A mark that must never cut sits before the text that may (design-language §6). */}
                  {p.source === 'google_form' && (
                    <span className="mr-[5px] align-[1px]">
                      <FormSourceMark source="google_form" title={ADULT_FORM_TITLE} />
                    </span>
                  )}
                  <span className={p.muted ? MUTED : undefined}>{p.main}</span>
                  {p.reg !== null && <span className={MUTED}>{` · ${p.reg}`}</span>}
                </span>
              )
            },
            (r) => <ResponseAskedCell response={r} names={names} programs={programs} />
          )(held === null ? g : { kind: 'response', key: g.key, response: held })
        },
      },
      {
        key: 'enrolled',
        header: 'Enrolled',
        width: 104,
        help: "Sessions the camper is enrolled in this season (status 2), in the tiny form; each cell's title has the full names",
        value: onRow(
          (r) => enrolledWords(r, names).text,
          () => null
        ),
        title: onRow(
          (r) => enrolledWords(r, names).title,
          () => 'No person yet, so no enrollment'
        ),
        render: onRow(
          (r) => {
            const e = enrolledWords(r, names)
            return (
              <span className={(r.enrolled_session_cm_ids ?? []).length === 0 ? MUTED : undefined}>
                {e.text}
              </span>
            )
          },
          () => DASH
        ),
      },
      {
        key: 'became',
        header: 'Became',
        flex: true,
        mark: marks.became,
        value: onRow(
          (r) => becameText(r, names, programs),
          (r) => {
            const b = responseBecame(r, names)
            return `${b.words} · ${b.why}`
          }
        ),
        title: onRow(
          (r) => becameLongTitle(r, names, programs),
          (r) => responseBecame(r, names).title
        ),
        render: onRow(
          (r) => <BecameCell row={r} names={names} programs={programs} />,
          (r) => {
            const b = responseBecame(r, names)
            return (
              <span className="flex min-w-0 items-center gap-[5px] overflow-hidden whitespace-nowrap">
                {/* The pill never cuts; the words after it do (design-language §6). */}
                <span className="flex-none">
                  <StatusPill tone={b.tone} title={b.title}>
                    {b.words}
                  </StatusPill>
                </span>
                <span className={`${MUTED} min-w-0 truncate`}>{b.why}</span>
              </span>
            )
          }
        ),
      },
      {
        key: 'campminder',
        header: 'CampMinder aid',
        width: 118,
        align: 'right',
        mark: marks.campminder,
        value: onRow(
          (r) => ((r.campminder_aid ?? []).length === 0 ? null : allAid(r)),
          () => null
        ),
        csv: onRow(
          (r) => ((r.campminder_aid ?? []).length === 0 ? '' : allAid(r).toFixed(2)),
          () => ''
        ),
        title: onRow(
          (r) => campminderTitle(r, names),
          () => 'No person yet, so no CampMinder aid to show'
        ),
        render: onRow(
          (r) =>
            (r.campminder_aid ?? []).length === 0 ? (
              DASH
            ) : amberAid(r) > 0 && !closed ? (
              <Money value={amberAid(r)} className={AMBER} />
            ) : (
              <Money value={allAid(r)} />
            ),
          () => DASH
        ),
        // The footer sums only the amber money: CampMinder aid on no request in this list (shown, never counted).
        total: (list) => {
          if (closed) return null
          const sum = list.reduce((s, r) => s + Math.round(gridAmberAid(r) * 100), 0) / 100
          return sum > 0 ? sum : null
        },
        ...(closed ? {} : { totalClassName: AMBER }),
        footerTitle: (list) => {
          if (closed) return undefined
          const sum = list.reduce((s, r) => s + Math.round(gridAmberAid(r) * 100), 0) / 100
          return sum > 0
            ? `${formatMoney(sum)} of CampMinder aid on no request in this list: shown, never counted`
            : undefined
        },
      },
    ]
    if (actionOf !== null)
      cols.push(aidActionColumn<IntakeGridRow>({ width: 132, action: actionOf }))
    return cols
  }, [view, marks, names, programs, actionOf, closed])

  const searchExtra = useCallback(
    (r: IntakeGridRow) =>
      r.kind === 'row'
        ? [r.row.household_label ?? '', r.row.person_cm_id || null]
        : [r.response.name_typed ?? ''],
    []
  )
  const renderDetail = useCallback(
    (r: IntakeGridRow) =>
      r.kind === 'row' ? (
        <IntakeDetail
          row={r.row}
          response={r.response}
          flagged={r.flagged ?? null}
          names={names}
          programs={programs}
          view={view}
          editor={editorOf(r)}
        />
      ) : (
        <ResponseDetail
          response={r.response}
          names={names}
          programs={programs}
          year={view.year}
          editor={editorOf(r)}
        />
      ),
    [names, programs, view, editorOf]
  )

  return (
    <AidTable<IntakeGridRow>
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
      footerLabel={gridFooterWords}
      footerTitle={gridFooterWords}
      emptyText={emptyText}
      searchPlaceholder="Find a camper…"
      searchWidth={150}
      toolbarLead={toolbarLead}
      toolbarStatus={toolbarStatus}
      toolbarActions={toolbarActions}
      belowToolbar={belowToolbar}
      bandRow={bandRow}
    />
  )
}
