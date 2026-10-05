import { useState, type ReactNode } from 'react'

import type {
  ApiAidAnswer,
  ApiAidHouseholdLink,
  ApiAidHouseholdPageLink,
  ApiAidHouseholdPage,
  ApiAidIncome,
} from '../../../types/api-types'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import { formatShortDate } from '../kit/dates'
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
  householdChipName,
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
  HH_NOTES_ROW,
  HH_NOTES_STACKED,
  HH_TOGGLE,
} from './householdStyles'
import {
  conflictsOf,
  conflictWords,
  exceptionsOf,
  moreWords,
  lastYearWords,
  otherFlags,
  pricedFacts,
  type FieldConflict,
} from './incomeModel'

/**
 * The household page's lower card's panels (§6.3 items 5–7; household-v2.html tabsE). HouseholdTabs
 * holds the strip and shows one at a time; these draw what is inside.
 */

/** Whether one answer's "Correct…" form is open. The panel holds it, so the form gets its own row. */
export interface CorrectOpening {
  open: boolean
  setOpen: (open: boolean) => void
}

/**
 * The casework "Correct…" on one answer: closed, the link in the answer's row; open, the form, which
 * the panel puts in a row of its own under the answer, across the answers table (owner bug B30).
 */
export type CorrectRender = (
  income: ApiAidIncome,
  answer: ApiAidAnswer,
  opening: CorrectOpening
) => ReactNode

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

/**
 * The family's free text, for staff (main spec §9.1; round 3 (E)): full width under the answers,
 * each note under its own name, in columns when there is room; one column in a household's half.
 */
function IncomeNotes({ income, stacked }: { income: ApiAidIncome; stacked: boolean }) {
  const notes = notesOf(income)
  if (notes.length === 0) return null
  return (
    <div className={stacked ? HH_NOTES_STACKED : HH_NOTES_ROW}>
      {notes.map(([key, text]) => (
        <div key={key} className="min-w-0">
          <div className="text-muted-foreground text-xs font-semibold">{noteWords(key)}</div>
          <p className="max-w-[72ch] whitespace-pre-line">{text}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * Last year's confirmed income as one quiet line atop the tab (round 3 (E), where "What priced it"
 * was), against this year's adjusted income. Nothing without last year.
 */
function LastYearLine({ page, income }: { page: ApiAidHouseholdPage; income: ApiAidIncome }) {
  const facts = pricedFacts(page, income)
  const words = lastYearWords(facts.adjusted, facts.confirmed)
  if (words === null) return null
  return (
    <p data-testid="last-year" className={`${HH_NOTE} mb-2`}>
      Last year: <b className="text-foreground tabular-nums">{words.confirmed}</b> confirmed
      {words.compare !== null && ` · ${words.compare}`}
    </p>
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
  const [correcting, setCorrecting] = useState(false)
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
            {!correcting && correct?.(income, answer, { open: false, setOpen: setCorrecting })}
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
      {correcting && correct !== undefined && (
        // B30: in the answer's own row the form's width set the answers column's. Here it spans the
        // table, which runs the tab's full width (round 3 (E)), and the box adds no width of its own
        // (0 wide, at least the cell's), so the form wraps to the answers' width.
        <tr>
          <td colSpan={4} className={`${HH_TD} whitespace-normal`}>
            <div className="w-0 min-w-full">
              {correct(income, answer, { open: true, setOpen: setCorrecting })}
            </div>
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
}: {
  page: ApiAidHouseholdPage
  income: ApiAidIncome
  correct: CorrectRender | undefined
  /** The mock's sized columns (210 / 104 / 104): always for one household; halves only from xl, fitting below. */
  fixed: boolean
}) {
  const [all, setAll] = useState(false)
  const exceptions = exceptionsOf(income)
  const conflicts = conflictsOf(income)
  const shown = all ? income.answers : exceptions
  const others = otherFlags(income)
  return (
    <div className="min-w-0">
      {shown.length === 0 ? (
        // Another flag shows as a pill below, so the note never claims there are none.
        <p className={`${HH_NOTE} py-1`}>
          {others.length > 0 ? 'No corrections.' : 'No corrections and no flags.'}
        </p>
      ) : (
        <table className={`${HH_TABLE} w-full`}>
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
    </div>
  )
}

const MUTED = 'text-muted-foreground'

/**
 * Household income, the exceptions only (owner pick 10-04: income (e); N8, O9), with no "What
 * priced it" (round 3, section 4 (E)): last year's line on top, the answers and the Correct… row
 * full width, the family's notes under them. Two or more households: equal halves, each with its
 * chip, its own last-year line and notes, the notes at the foot so the halves end level; they
 * stack only when the window is narrow. `correct` puts the casework "Correct…" on each answer shown.
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
            name={householdChipName(page, first.household_cm_id)}
          />
        )}
        <LastYearLine page={page} income={first} />
        <Exceptions page={page} income={first} correct={correct} fixed />
        <div className="pt-1.5">
          <IncomeNotes income={first} stacked={false} />
        </div>
      </div>
    )
  }
  return (
    <div className="grid items-stretch gap-x-7 gap-y-4 lg:grid-cols-2">
      {page.incomes.map((income) => (
        <div
          key={income.household_cm_id}
          data-testid="income-household"
          className="flex min-w-0 flex-col"
        >
          <div className="mb-1">
            <HouseholdChip
              index={householdChip(page, income.household_cm_id) ?? 0}
              name={householdChipName(page, income.household_cm_id)}
            />
          </div>
          <LastYearLine page={page} income={income} />
          <Exceptions page={page} income={income} correct={correct} fixed={false} />
          {/* The notes sit at the half's foot, so both halves end level (the mock's .halves.eq). */}
          <div className="mt-auto pt-2.5">
            <IncomeNotes income={income} stacked />
          </div>
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

/** "The Lee Family · Ava Lee, Noah Lee · Riverside, CA"; blank when the page carries no family name (owner 10-04). */
function familyWords(link: ApiAidHouseholdPageLink): string {
  // The server defaults family_name and city to "" and adults to []: test for blank, never `??`.
  const name = link.family_name ?? ''
  if (!nonEmpty(name)) return ''
  return [name, (link.adults ?? []).join(', '), link.city ?? ''].filter(nonEmpty).join(' · ')
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
      {page.links.map((link) => {
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
