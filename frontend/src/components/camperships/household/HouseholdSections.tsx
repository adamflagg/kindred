import { Fragment, useState, type ReactNode } from 'react'

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
  householdLabel,
  labelOf,
  multiHousehold,
  noteWords,
} from './householdModel'
import { HouseholdLabelText } from './HouseholdLabel'
import {
  HH_DIFF_DEL,
  HH_EYEBROW,
  HH_FORMS_DONE,
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
  answerState,
  formColumns,
  formFigure,
  usingNote,
  whyWords,
  type FormColumn,
  type FormFigure,
} from './incomeColumns'
import {
  conflictsOf,
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

/** The Use X's Form strip above a household's disagreeing answers (round 3, section 3). */
export type FormStripRender = (income: ApiAidIncome) => ReactNode

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

/**
 * An open disagreement's band (household-v5 option D): its answer row and its why line share one
 * amber tint with rounded corners, no rule and no edge inside. Chrome clips a row's background to its
 * cells' radii, so the tint stays on the row.
 */
const BAND_ROW = 'bg-amber-50 dark:bg-amber-900/20'
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

/** The muted note in its own slot right of "Using" (the mock's td.un): "· on hold", "· 2 of 3 forms". */
const NOTE_TD = 'pr-2 pl-0 text-muted-foreground text-[11.5px]'
/**
 * A cell that wraps. Appending `whitespace-normal` to HH_TD does nothing: Tailwind emits
 * `whitespace-nowrap` after it, so HH_TD's nowrap wins and a long why line widened the table past a
 * household's half. Swap the class instead.
 */
const WRAP_TD = HH_TD.replace('whitespace-nowrap', 'whitespace-normal')
/** A form's header (the mock's th.fc): it may wrap ("Olivia's / form"), so a household's half fits. */
const FORM_TH = `${HH_TH_NUM.replace('whitespace-nowrap', 'whitespace-normal')} leading-tight align-bottom`
/**
 * The income table: separate borders, because a band's rounded corners only draw on separated cells.
 * One household (`fixed`) gets the mock's fixed grid, so no cell's content can move a column.
 */
const answersTable = (fixed: boolean) =>
  `${HH_TABLE.replace('border-collapse', 'border-separate')} border-spacing-0 w-full ${fixed ? 'table-fixed' : ''}`

/** One form's figure in its column, struck in red once a correction used another (the weekend diff's DEL). */
function FormFigureCell({ figure, className }: { figure: FormFigure; className: string }) {
  return (
    <td className={className}>
      {figure.struck ? <del className={HH_DIFF_DEL}>{figure.text}</del> : figure.text}
    </td>
  )
}

/**
 * One answer's row (household-v5 option D): its name, each form's figure (one "Family's answer" with
 * one form), the figure used, its muted note, then its casework link and pills. An answer the forms
 * still disagree on sits on a rounded amber band with its why tight under it; a settled one strikes
 * the unused figures in their columns. Correct… opens in a row of its own (B30). `ruleBelow`: the
 * grey rule under the answer, dropped inside a band and above one, where the band's gap gives the air.
 */
function AnswerRows({
  page,
  income,
  answer,
  conflict,
  columns,
  correct,
  ruleBelow,
}: {
  page: ApiAidHouseholdPage
  income: ApiAidIncome
  answer: ApiAidAnswer
  conflict: FieldConflict | undefined
  /** The household's forms, two or more; null for the one-form table. */
  columns: readonly FormColumn[] | null
  correct: CorrectRender | undefined
  ruleBelow: boolean
}) {
  const [correcting, setCorrecting] = useState(false)
  const band = answerState(answer, conflict) === 'open'
  const why = whyWords(page, income, answer, conflict)
  const note = usingNote(page, answer, conflict)
  const span = (columns?.length ?? 1) + 4
  const unruled = (classes: string) => `${classes} border-b-0`
  const lastRule = (classes: string) => (ruleBelow ? classes : unruled(classes))
  const cell = why === null ? lastRule(HH_TD) : unruled(HH_TD)
  const num = why === null ? lastRule(HH_TD_NUM) : unruled(HH_TD_NUM)
  return (
    <>
      <tr className={band ? BAND_ROW : ''}>
        <td className={`${cell} ${band ? 'rounded-tl-lg' : ''}`}>{answerWords(answer.field)}</td>
        {columns === null ? (
          <td className={num}>{answerValue(answer.field, answer.synced)}</td>
        ) : conflict === undefined ? (
          // Owner ruling 10-05 (the final design): per-form figures are only for the answers the
          // forms disagree on. An answer no flag disputes shows once across the form columns, never
          // repeated under each form: the household's answer is not each form's (Yes if any form
          // says Yes; blanks skipped). It right-aligns to the last form's edge with a faint dotted
          // leader from the first, so it reads as every form's figure, not the last form's.
          <td colSpan={columns.length} className={num}>
            <span className="flex items-baseline">
              <span
                data-leader
                className="border-muted-foreground/45 mr-2 ml-1 flex-1 -translate-y-[3px] border-b border-dotted"
              />
              <span>{answerValue(answer.field, answer.synced)}</span>
            </span>
          </td>
        ) : (
          columns.map((column) => (
            <FormFigureCell
              key={column.personCmId}
              figure={formFigure(answer, conflict, column.personCmId)}
              className={num}
            />
          ))
        )}
        <td className={`${num} ${answer.corrected ? 'font-bold' : ''}`}>
          {answerValue(answer.field, answer.effective)}
        </td>
        <td className={`${cell.replace('px-2', '')} ${NOTE_TD}`}>
          {note === null ? '' : `· ${note}`}
        </td>
        <td className={`${cell} ${band ? 'rounded-tr-lg' : ''}`}>
          {/* The link first, in a fixed slot, so every link starts at the same x; pills after it. */}
          <div className="flex items-center gap-2">
            {!correcting && correct !== undefined && (
              <span className="inline-block min-w-[136px]">
                {correct(income, answer, { open: false, setOpen: setCorrecting })}
              </span>
            )}
            {answer.corrected && <StatusPill tone="amber">corrected</StatusPill>}
            {answer.changed_since_correction && (
              <span className={AMBER_NOTE}>the form changed since</span>
            )}
          </div>
        </td>
      </tr>
      {why !== null && (
        <tr className={band ? BAND_ROW : ''}>
          <td
            colSpan={span}
            className={`${band ? `${unruled(WRAP_TD)} rounded-b-lg ${WHY_FLAGGED}` : `${lastRule(WRAP_TD)} ${WHY_SETTLED}`} pt-0 text-[12.5px]`}
          >
            {why}
          </td>
        </tr>
      )}
      {correcting && correct !== undefined && (
        // B30: in the answer's own row the form's width set the answers column's. Here it spans the
        // table, which runs the tab's full width (round 3 (E)), and the box adds no width of its own
        // (0 wide, at least the cell's), so the form wraps to the answers' width.
        <tr>
          <td colSpan={span} className={lastRule(WRAP_TD)}>
            <div className="w-0 min-w-full">
              {correct(income, answer, { open: true, setOpen: setCorrecting })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/** The small gap before, between and after the bands (the mock's tr.sp): one between two bands. */
function BandGap({ span }: { span: number }) {
  return (
    <tr data-band-gap>
      <td colSpan={span} className="h-1 p-0" />
    </tr>
  )
}

/**
 * The mock's fixed grid (household-v5): Answer 190 · each form 112 · Using 104 · note 124 · actions
 * the rest. A household's half leaves its columns to fit the half.
 */
function AnswerColumns({ forms }: { forms: number }) {
  return (
    <colgroup>
      <col className="w-[190px]" />
      {Array.from({ length: forms }, (_, i) => (
        <col key={i} className="w-[112px]" />
      ))}
      <col className="w-[104px]" />
      <col className="w-[124px]" />
      <col />
    </colgroup>
  )
}

/** One household's exceptions, its "N more answers match" toggle, and its other flags. */
function Exceptions({
  page,
  income,
  correct,
  formStrip,
  fixed,
}: {
  page: ApiAidHouseholdPage
  income: ApiAidIncome
  correct: CorrectRender | undefined
  formStrip: FormStripRender | undefined
  /** The mock's fixed column grid: one household; a household's half leaves its columns to fit. */
  fixed: boolean
}) {
  const [all, setAll] = useState(false)
  const exceptions = exceptionsOf(income)
  const conflicts = conflictsOf(income)
  const shown = all ? income.answers : exceptions
  const others = otherFlags(income)
  const forms = formColumns(page, income)
  const columns = forms.length > 1 ? forms : null
  const span = (columns?.length ?? 1) + 4
  const rows = shown.map((answer) => {
    const conflict = conflicts.find((c) => c.field === answer.field)
    return { answer, conflict, band: answerState(answer, conflict) === 'open' }
  })
  return (
    <div className="min-w-0">
      {formStrip?.(income)}
      {shown.length === 0 ? (
        // Another flag shows as a pill below, so the note never claims there are none.
        <p className={`${HH_NOTE} py-1`}>
          {others.length > 0 ? 'No corrections.' : 'No corrections and no flags.'}
        </p>
      ) : (
        <table className={answersTable(fixed)}>
          {fixed && <AnswerColumns forms={columns?.length ?? 1} />}
          <thead>
            <tr>
              <th className={HH_TH}>Answer</th>
              {columns === null ? (
                <th className={HH_TH_NUM}>Family&apos;s answer</th>
              ) : (
                columns.map((column) => (
                  <th key={column.personCmId} className={FORM_TH}>
                    {column.head}
                  </th>
                ))
              )}
              <th className={HH_TH_NUM}>Using</th>
              <th className={HH_TH} />
              <th className={HH_TH} />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ answer, conflict, band }, i) => {
              const gapBefore = band && rows[i - 1]?.band !== true
              return (
                <Fragment key={answer.field}>
                  {gapBefore && <BandGap span={span} />}
                  <AnswerRows
                    page={page}
                    income={income}
                    answer={answer}
                    conflict={conflict}
                    columns={columns}
                    correct={correct}
                    ruleBelow={!band && rows[i + 1]?.band !== true}
                  />
                  {band && <BandGap span={span} />}
                </Fragment>
              )
            })}
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
/** A household's income heading: its chip, then its label (#3025), the tie-break muted. */
function IncomeHead({
  page,
  householdCmId,
  className = '',
}: {
  page: ApiAidHouseholdPage
  householdCmId: number
  className?: string
}) {
  const label = householdLabel(page, householdCmId)
  return (
    <div className={`flex flex-wrap items-baseline gap-x-1.5 ${className}`}>
      <HouseholdChip
        index={householdChip(page, householdCmId) ?? 0}
        name={householdChipName(page, householdCmId)}
      />
      {label !== null && (
        <span className="text-[13px]">
          <HouseholdLabelText label={label} />
        </span>
      )}
    </div>
  )
}

export function IncomePanel({
  page,
  correct,
  formStrip,
}: {
  page: ApiAidHouseholdPage
  correct?: CorrectRender | undefined
  /** The Use X's Form strip, put above each household's answers (round 3, section 3). */
  formStrip?: FormStripRender | undefined
}) {
  if (page.incomes.length === 0) {
    return <p className={HH_NOTE}>No income form on file.</p>
  }
  const [first] = page.incomes
  if (page.incomes.length === 1 && first !== undefined) {
    return (
      <div className="space-y-1">
        {multiHousehold(page) && <IncomeHead page={page} householdCmId={first.household_cm_id} />}
        <LastYearLine page={page} income={first} />
        <Exceptions page={page} income={first} correct={correct} formStrip={formStrip} fixed />
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
          <IncomeHead page={page} householdCmId={income.household_cm_id} className="mb-1" />
          <LastYearLine page={page} income={income} />
          <Exceptions
            page={page}
            income={income}
            correct={correct}
            formStrip={formStrip}
            fixed={false}
          />
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
 * A grant form's opening on the household page (rulings:340), as `CorrectOpening`: closed, the
 * button; open, the form. `done` hands the panel what the write did, to show above the grants.
 */
export interface GrantFormOpening extends CorrectOpening {
  done: (words: string) => void
}

/**
 * The household page's two grant buttons (rulings:340), for casework: "Add a Commitment…" beside the
 * Grants heading, "Place on a Camper…" on a line Grants lists as needing a camper. Each opens slice
 * 3's grant form pre-filled with the household; the panel puts an open form in a row of its own.
 * The grants stay ledger-built and read-only otherwise.
 */
export interface HouseholdGrantForms {
  readonly addCommitment: (opening: GrantFormOpening) => ReactNode
  readonly placeOnCamper: (grant: Grant, opening: GrantFormOpening) => ReactNode
}

const grantKey = (grant: Grant) => `${String(grant.transaction_cm_id)}:${grant.commitment_id}`

/**
 * The household's grants with the Expected chips first, then every CampMinder aid posting, live and
 * reversed. A reversed line stays one row, struck through and dated, so "posted $X, reversed,
 * reposted $Y" reads top to bottom. Program in the rules' words (D31); the source in sentence case.
 * `grantForms` (casework, rulings:340) adds the two grant buttons.
 */
export function GrantsPostingsPanel({
  page,
  programNames,
  grantForms,
}: {
  page: ApiAidHouseholdPage
  programNames: Readonly<Record<string, string>>
  grantForms?: HouseholdGrantForms | undefined
}) {
  const [adding, setAdding] = useState(false)
  const [placing, setPlacing] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const camperName = (personCmId: number) =>
    page.requests.find((r) => r.row.person_cm_id === personCmId)?.row.camper_name ??
    (personCmId > 0 ? `person ${String(personCmId)}` : 'the household')
  const placeOpening = (grant: Grant): GrantFormOpening => ({
    open: placing === grantKey(grant),
    setOpen: (open) => setPlacing(open ? grantKey(grant) : null),
    done: setSaid,
  })
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
      {said !== null && <p className={HH_FORMS_DONE}>✓ {said}</p>}
      <div className="flex items-end justify-between gap-2">
        <div className={EYEBROW}>Grants</div>
        {grantForms !== undefined &&
          !adding &&
          grantForms.addCommitment({ open: false, setOpen: setAdding, done: setSaid })}
      </div>
      {grantForms !== undefined && adding && (
        <div className="my-1.5">
          {grantForms.addCommitment({ open: true, setOpen: setAdding, done: setSaid })}
        </div>
      )}
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
              <Fragment key={grantKey(grant)}>
                <tr>
                  <td className={HH_TD}>{grant.grantor_name === '' ? '—' : grant.grantor_name}</td>
                  <td className={HH_TD}>
                    {grant.description === '' ? (
                      <span className={MUTED}>—</span>
                    ) : (
                      grant.description
                    )}
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
                    <div className="flex items-center gap-2">
                      {/* The band counts only live, counted, outside grants with a request share (outside_grants_by_request): say which these aren't. */}
                      {grant.cancelled ? (
                        <StatusPill tone="stone">cancelled</StatusPill>
                      ) : !grant.in_band ? (
                        <StatusPill tone="muted">not counted</StatusPill>
                      ) : null}
                      {grantForms !== undefined &&
                        placing !== grantKey(grant) &&
                        grantForms.placeOnCamper(grant, placeOpening(grant))}
                    </div>
                  </td>
                </tr>
                {grantForms !== undefined && placing === grantKey(grant) && (
                  <tr>
                    <td colSpan={6} className={HH_TD}>
                      {grantForms.placeOnCamper(grant, placeOpening(grant))}
                    </td>
                  </tr>
                )}
              </Fragment>
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
        // #3025: the server's label names the household (its adults); the city follows unless it is the tie-break.
        const label = labelOf(link)
        if (label !== null) {
          const city = link.city ?? ''
          const rest = [city === label.tiebreak ? '' : city, linkDetail(link)].filter(nonEmpty)
          return (
            <li key={link.id} className="border-border border-b py-1 last:border-b-0">
              <HouseholdLabelText label={label} className="font-bold" />
              <span className={MUTED}> · {rest.join(' · ')}</span>
            </li>
          )
        }
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
