import { useState, type ReactNode } from 'react'

import type {
  ApiAidAnswer,
  ApiAidHouseholdLink,
  ApiAidHouseholdPage,
  ApiAidIncome,
} from '../../../types/api-types'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
import { Money, ReversedAmount } from '../kit/MoneyText'
import { HouseholdChip, StatusPill } from '../kit/Pills'
import { codeWords } from '../requests/attention'
import { programLabel } from '../requests/programLabel'
import { historyLines } from './historyWords'
import {
  answerValue,
  answerWords,
  expectedWords,
  householdChip,
  householdName,
  multiHousehold,
  noteWords,
} from './householdModel'
import {
  HH_EYEBROW,
  HH_NOTE,
  HH_TABLE,
  HH_TD,
  HH_TD_NUM,
  HH_TH,
  HH_TH_NUM,
  HH_TOGGLE,
} from './householdStyles'
import {
  conflictsOf,
  conflictWords,
  exceptionsOf,
  moreWords,
  otherFlags,
  pctWords,
  pricedFacts,
  type FieldConflict,
} from './incomeModel'

/**
 * The household page's lower card's panels (§6.3 items 5–7; household-v2.html tabsE). HouseholdTabs
 * holds the strip and shows one at a time; these draw what is inside.
 */

export type CorrectRender = (income: ApiAidIncome, answer: ApiAidAnswer) => ReactNode

// ── Income: the exceptions only (owner pick 10-04, income (e); N8) ───────────

/** A flagged answer (the mock's tr.fl): amber tint, a 3px amber edge on its first cell. */
const FLAGGED_ROW = 'bg-amber-50 dark:bg-amber-900/20'
const FLAGGED_EDGE =
  'shadow-[inset_3px_0_0_var(--color-amber-500)] dark:shadow-[inset_3px_0_0_var(--color-amber-400)]'
const WHY_FLAGGED = 'text-amber-800 dark:text-amber-300'
const WHY_SETTLED = 'text-muted-foreground'

const nonEmpty = (text: string) => text.trim() !== ''

function notesOf(income: ApiAidIncome): Array<[string, string]> {
  return Object.entries(income.notes).filter(([, text]) => nonEmpty(text))
}

/** The family's free text, for staff (main spec §9.1). */
function FreeText({ income }: { income: ApiAidIncome }) {
  const notes = notesOf(income)
  if (notes.length === 0) return null
  return (
    <div className="mt-2 space-y-1.5 text-[13.5px]">
      {notes.map(([key, text]) => (
        <div key={key}>
          <div className="text-muted-foreground text-xs font-semibold">{noteWords(key)}</div>
          <p className="whitespace-pre-line">{text}</p>
        </div>
      ))}
    </div>
  )
}

function AnswerRows({
  page,
  income,
  answer,
  conflict,
  correct,
  fixed,
}: {
  page: ApiAidHouseholdPage
  income: ApiAidIncome
  answer: ApiAidAnswer
  conflict: FieldConflict | undefined
  correct: CorrectRender | undefined
  fixed: boolean
}) {
  const open = conflict !== undefined && !conflict.resolved
  const cell = conflict === undefined ? HH_TD : `${HH_TD} border-b-0`
  const edge = open ? FLAGGED_EDGE : ''
  return (
    <>
      <tr className={open ? FLAGGED_ROW : ''}>
        <td className={`${cell} ${edge} ${fixed ? 'w-[210px]' : 'xl:w-[210px]'}`}>
          {answerWords(answer.field)}
        </td>
        <td
          className={`${conflict === undefined ? HH_TD_NUM : `${HH_TD_NUM} border-b-0`} ${fixed ? 'w-[104px]' : 'xl:w-[104px]'}`}
        >
          {answerValue(answer.field, answer.synced)}
        </td>
        <td
          className={`${conflict === undefined ? HH_TD_NUM : `${HH_TD_NUM} border-b-0`} ${fixed ? 'w-[104px]' : 'xl:w-[104px]'} ${answer.corrected ? 'font-bold' : ''}`}
        >
          {answerValue(answer.field, answer.effective)}
        </td>
        <td className={`${cell} whitespace-normal`}>
          <div className="flex flex-wrap items-center gap-2">
            {answer.corrected && <StatusPill tone="amber">corrected</StatusPill>}
            {answer.changed_since_correction && (
              <span className={AMBER_NOTE}>the form changed since</span>
            )}
            {correct?.(income, answer)}
          </div>
        </td>
      </tr>
      {conflict !== undefined && (
        <tr className={open ? FLAGGED_ROW : ''}>
          <td
            colSpan={4}
            className={`${HH_TD} ${edge} pt-0 text-[12.5px] whitespace-normal ${open ? WHY_FLAGGED : WHY_SETTLED}`}
          >
            {conflictWords(page, income, conflict)}
          </td>
        </tr>
      )}
    </>
  )
}

/** One household's exceptions, its "N more answers match" toggle, and its other flags. */
function Exceptions({
  page,
  income,
  correct,
  fixed,
  freeTextWhenOpen,
}: {
  page: ApiAidHouseholdPage
  income: ApiAidIncome
  correct: CorrectRender | undefined
  /** The mock's sized columns (210 / 104 / 104): always for one household; halves only from xl, fitting below. */
  fixed: boolean
  freeTextWhenOpen: boolean
}) {
  const [all, setAll] = useState(false)
  const exceptions = exceptionsOf(income)
  const conflicts = conflictsOf(income)
  const shown = all ? income.answers : exceptions
  const others = otherFlags(income)
  return (
    <div className="min-w-0">
      {shown.length === 0 ? (
        <p className={`${HH_NOTE} py-1`}>No corrections and no flags.</p>
      ) : (
        <table className={HH_TABLE}>
          <thead>
            <tr>
              <th className={HH_TH}>Answer</th>
              <th className={HH_TH_NUM}>On the form</th>
              <th className={HH_TH_NUM}>Used</th>
              <th className={HH_TH} />
            </tr>
          </thead>
          <tbody>
            {shown.map((answer) => (
              <AnswerRows
                key={answer.field}
                page={page}
                income={income}
                answer={answer}
                conflict={conflicts.find((c) => c.field === answer.field)}
                correct={correct}
                fixed={fixed}
              />
            ))}
          </tbody>
        </table>
      )}
      {others.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {others.map((flag) => (
            <StatusPill key={flag.code} tone="amber">
              {codeWords(flag.code)}
            </StatusPill>
          ))}
        </div>
      )}
      <button type="button" className={`${HH_TOGGLE} mt-1`} onClick={() => setAll(!all)}>
        {moreWords(income.answers.length, exceptions.length, all)}
      </button>
      {all && freeTextWhenOpen && <FreeText income={income} />}
    </div>
  )
}

const PK = 'text-muted-foreground'
const PV = 'tabular-nums'
const MUTED = 'text-muted-foreground'

/**
 * "What priced it" (the mock's .priced; the owner kept it, 10-04): the figures staff check an
 * answer against, from the payload only. Household size and the form's date are not in the
 * payload, so they have no rows; a figure missing for this household leaves its row out.
 */
function PricedCard({ page, income }: { page: ApiAidHouseholdPage; income: ApiAidIncome }) {
  const facts = pricedFacts(page, income)
  const pct = pctWords(facts.adjusted, facts.confirmed)
  const rows: Array<[string, ReactNode]> = []
  if (facts.adjusted !== null) {
    rows.push(['Adjusted income', <b key="v">{formatMoney(facts.adjusted)}</b>])
  }
  if (facts.confirmed !== null) {
    rows.push([
      "Last year's confirmed",
      <>
        <b>{formatMoney(facts.confirmed)}</b>
        {pct !== null && <span className={MUTED}> {pct}</span>}
      </>,
    ])
  }
  if (facts.tier !== null) {
    const shifted = facts.finalTier !== null && facts.finalTier !== facts.tier
    rows.push([
      'Income tier',
      <>
        <b>{facts.tier}</b>
        {shifted && <span className={MUTED}> → {String(facts.finalTier)} with equity</span>}
        {facts.rules !== null && <span className={MUTED}> {facts.rules}</span>}
      </>,
    ])
  }
  const notes = notesOf(income)
  if (rows.length === 0 && notes.length === 0) return null
  return (
    <div
      data-testid="priced"
      className="bg-muted/30 border-border max-w-[620px] rounded-[10px] border px-3 py-2 text-[13px]"
    >
      <div className={`${HH_EYEBROW} mb-1`}>What priced it</div>
      {rows.length > 0 && (
        <div className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-3.5 gap-y-[3px]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <div className={PK}>{label}</div>
              <div className={PV}>{value}</div>
            </div>
          ))}
        </div>
      )}
      {notes.map(([key, text]) => (
        <div
          key={key}
          className={`text-[12.5px] leading-normal ${rows.length > 0 ? 'border-border mt-1.5 border-t pt-1.5' : ''}`}
        >
          <span className="text-muted-foreground mr-1 font-semibold">{noteWords(key)}</span>
          <span className="whitespace-pre-line">{text}</span>
        </div>
      ))}
    </div>
  )
}

/** "Adjusted $84,200 · tier 4 · vs last year +4%": a household half's pricing line, what the payload has. */
function HalfMeta({ page, income }: { page: ApiAidHouseholdPage; income: ApiAidIncome }) {
  const facts = pricedFacts(page, income)
  const pct = pctWords(facts.adjusted, facts.confirmed)
  const parts: ReactNode[] = []
  if (facts.adjusted !== null) {
    parts.push(
      <>
        Adjusted <b className="text-foreground">{formatMoney(facts.adjusted)}</b>
      </>
    )
  }
  if (facts.tier !== null) {
    parts.push(
      <>
        tier <b className="text-foreground">{facts.tier}</b>
      </>
    )
  }
  if (pct !== null) parts.push(<>vs last year {pct}</>)
  if (parts.length === 0) return null
  return (
    <span className={HH_NOTE}>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {part}
        </span>
      ))}
    </span>
  )
}

/**
 * Household income, the exceptions only (owner pick 10-04: income (e); N8, O9). One household:
 * its exceptions beside "What priced it". Two or more: side-by-side halves, each with its chip and
 * pricing line, stacking only when the window is narrow. `correct` puts the casework "Correct…" on
 * each answer shown.
 */
export function IncomePanel({
  page,
  correct,
}: {
  page: ApiAidHouseholdPage
  correct?: CorrectRender | undefined
}) {
  if (page.incomes.length === 0) {
    return <p className={HH_NOTE}>No income form on file.</p>
  }
  const [first] = page.incomes
  if (page.incomes.length === 1 && first !== undefined) {
    return (
      <div className="space-y-1">
        {multiHousehold(page) && (
          <HouseholdChip
            index={householdChip(page, first.household_cm_id) ?? 0}
            name={householdName(page, first.household_cm_id)}
          />
        )}
        <div className="grid items-start gap-x-8 gap-y-3 lg:grid-cols-[max-content_minmax(0,1fr)]">
          <Exceptions page={page} income={first} correct={correct} fixed freeTextWhenOpen={false} />
          <PricedCard page={page} income={first} />
        </div>
      </div>
    )
  }
  return (
    <div className="grid items-start gap-x-7 gap-y-4 lg:grid-cols-2">
      {page.incomes.map((income) => (
        <div key={income.household_cm_id} data-testid="income-household" className="min-w-0">
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <HouseholdChip
              index={householdChip(page, income.household_cm_id) ?? 0}
              name={householdName(page, income.household_cm_id)}
            />
            <HalfMeta page={page} income={income} />
          </div>
          <Exceptions
            page={page}
            income={income}
            correct={correct}
            fixed={false}
            freeTextWhenOpen
          />
        </div>
      ))}
    </div>
  )
}

// ── Grants and postings (§6.3 item 6; D30, D31, D55, D56, D74, D127) ─────────

type Grant = ApiAidHouseholdPage['grants'][number]

/** An unplaced line (person 0) is "the household" only by the household basis; otherwise it needs a camper. */
function grantCamper(grant: Grant): ReactNode {
  if (grant.camper_basis === 'household') return 'the household'
  if (grant.person_cm_id === 0) return <span className={MUTED}>needs a camper</span>
  return grant.camper_name === '' ? `person ${String(grant.person_cm_id)}` : grant.camper_name
}

const EYEBROW = `${HH_EYEBROW} mt-3 mb-0.5 first:mt-0`

/**
 * The household's grants with the Expected chips first, then every CampMinder aid posting, live and
 * reversed. A reversed line stays one row, struck through and dated, so "posted $X, reversed,
 * reposted $Y" reads top to bottom. Program in the rules' words (D31); the source in sentence case.
 */
export function GrantsPostingsPanel({
  page,
  programNames,
}: {
  page: ApiAidHouseholdPage
  programNames: Readonly<Record<string, string>>
}) {
  const camperName = (personCmId: number) =>
    page.requests.find((r) => r.row.person_cm_id === personCmId)?.row.camper_name ??
    (personCmId > 0 ? `person ${String(personCmId)}` : 'the household')
  return (
    <div>
      {page.expected.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1.5">
          {page.expected.map((expected) => (
            <StatusPill key={`${String(expected.household_cm_id)}:${expected.kind}`} tone="sky">
              {expectedWords(expected)}
            </StatusPill>
          ))}
        </div>
      )}
      <div className={EYEBROW}>Grants</div>
      {page.grants.length === 0 ? (
        <p className={HH_NOTE}>No outside grants.</p>
      ) : (
        <table aria-label="Grants" className={`${HH_TABLE} w-full`}>
          <thead>
            <tr>
              <th className={HH_TH}>Grantor</th>
              <th className={HH_TH}>Description</th>
              <th className={HH_TH}>Camper</th>
              <th className={HH_TH}>Recorded</th>
              <th className={HH_TH_NUM}>Amount</th>
              <th className={`${HH_TH} w-[110px]`} />
            </tr>
          </thead>
          <tbody>
            {page.grants.map((grant) => (
              <tr key={`${String(grant.transaction_cm_id)}:${grant.commitment_id}`}>
                <td className={HH_TD}>{grant.grantor_name === '' ? '—' : grant.grantor_name}</td>
                <td className={HH_TD}>
                  {grant.description === '' ? <span className={MUTED}>—</span> : grant.description}
                </td>
                <td className={HH_TD}>{grantCamper(grant)}</td>
                <td className={HH_TD}>
                  {grant.recorded_on ? formatShortDate(grant.recorded_on) : '—'}
                </td>
                <td className={HH_TD_NUM}>
                  {grant.is_reversed ? (
                    <ReversedAmount value={grant.amount} reversedOn={grant.reversal_date} />
                  ) : (
                    <Money value={grant.amount} />
                  )}
                </td>
                <td className={HH_TD}>
                  {/* The band counts only live, counted, outside grants with a request share (outside_grants_by_request): say which these aren't. */}
                  {grant.cancelled ? (
                    <StatusPill tone="stone">cancelled</StatusPill>
                  ) : !grant.in_band ? (
                    <StatusPill tone="muted">not counted</StatusPill>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className={EYEBROW}>Postings</div>
      {page.postings.length === 0 ? (
        <p className={HH_NOTE}>No CampMinder aid postings this season.</p>
      ) : (
        <table aria-label="Postings" className={`${HH_TABLE} w-full`}>
          <thead>
            <tr>
              <th className={`${HH_TH} w-[110px]`}>Posted on</th>
              <th className={HH_TH}>Camper</th>
              <th className={HH_TH}>Program</th>
              <th className={HH_TH}>Source</th>
              <th className={HH_TH_NUM}>Aid</th>
            </tr>
          </thead>
          <tbody>
            {page.postings.map((posting) => (
              <tr key={posting.transaction_cm_id}>
                <td className={HH_TD}>{formatShortDate(posting.post_date)}</td>
                <td className={HH_TD}>{camperName(posting.attributed_person_cm_id)}</td>
                <td className={HH_TD}>
                  {posting.program_family === ''
                    ? '—'
                    : programLabel(programNames, posting.program_family)}
                </td>
                <td className={HH_TD}>{codeWords(posting.effective_source_key)}</td>
                <td className={HH_TD_NUM}>
                  {posting.is_reversed ? (
                    <ReversedAmount value={posting.amount} reversedOn={posting.reversal_date} />
                  ) : (
                    <Money value={posting.amount} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Linked households (§6.3 †; Decision 27: read only; N9) ───────────────────

/**
 * The family details #3004 adds to each link. Typed optional here until the restack brings the
 * regenerated types; the lead tightens it then.
 */
type LinkWithFamily = ApiAidHouseholdLink & {
  readonly family_name?: string | undefined
  readonly adults?: readonly string[] | undefined
  readonly city?: string | undefined
}

/** "The Lee Family · Ava Lee, Noah Lee · Riverside, CA", when the page carries them (owner 10-04). */
function familyWords(link: LinkWithFamily): string {
  return [link.family_name ?? '', (link.adults ?? []).join(', '), link.city ?? '']
    .filter(nonEmpty)
    .join(' · ')
}

/** The link itself: "household 1000004 · staff · excluded · <note>". */
function linkDetail(link: ApiAidHouseholdLink): string {
  return [
    `household ${String(link.household_cm_id)}`,
    link.source,
    link.excluded ? 'excluded' : '',
    link.note,
  ]
    .filter(nonEmpty)
    .join(' · ')
}

export function LinksPanel({ page }: { page: ApiAidHouseholdPage }) {
  return (
    <ul className="text-[13px]">
      {page.links.map((link: LinkWithFamily) => {
        const family = familyWords(link)
        return (
          <li key={link.id} className="border-border border-b py-1 last:border-b-0">
            {family === '' ? (
              linkDetail(link)
            ) : (
              <>
                <b>{family}</b>
                <span className={MUTED}> · {linkDetail(link)}</span>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── History (§6.3 item 7; O4; N10) ────────────────────────────────────────────

/** The family's own log in words, oldest first (history.html B's line). Ids stay in the download. */
export function HistoryPanel({ page }: { page: ApiAidHouseholdPage }) {
  const lines = historyLines(page)
  if (lines.length === 0) return <p className={HH_NOTE}>Nothing recorded yet.</p>
  return (
    <div>
      <p className={HH_NOTE}>oldest first</p>
      <div className="mt-1.5">
        {lines.map((line) => (
          <div
            key={line.key}
            data-testid="history-line"
            className="border-border/60 flex items-baseline gap-2 border-b py-[3px] text-[12.5px] last:border-b-0"
          >
            <span>
              {line.parts.map((part, i) =>
                part.strong === true ? (
                  <b key={i} className="tabular-nums">
                    {part.text}
                  </b>
                ) : (
                  <span key={i}>{part.text}</span>
                )
              )}
              <span className={MUTED}> · {line.date}</span>
            </span>
            {line.reason !== null && <span className={MUTED}>“{line.reason}”</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
