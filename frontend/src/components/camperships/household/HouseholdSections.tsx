import { Download } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ApiAidAnswer, ApiAidHouseholdPage, ApiAidIncome } from '../../../types/api-types'
import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import { AMBER_NOTE, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { withLinkLine } from '../kit/csv'
import { formatShortDate } from '../kit/dates'
import { Money, ReversedAmount } from '../kit/MoneyText'
import { HouseholdChip, StatusPill } from '../kit/Pills'
import { codeWords } from '../requests/attention'
import {
  answerValue,
  answerWords,
  expectedWords,
  historyCsv,
  historyLine,
  householdChip,
  householdCsvName,
  householdName,
  linkWords,
  multiHousehold,
  noteWords,
  postingsCsv,
  type CsvTable,
} from './householdModel'
import { SECTION_TITLE } from './householdStyles'

function download(table: CsvTable, filename: string) {
  downloadCsv(
    buildCsvContent(table.headers, withLinkLine(table.rows, window.location.href)),
    filename
  )
}

type Grant = ApiAidHouseholdPage['grants'][number]

/** The server's band rule for a grant (outside_grants_by_request): counted, outside, and a request share. */
const countsInBand = (grant: Grant) =>
  grant.counts && grant.funder_type === 'outside' && grant.requests.length > 0

/** An unplaced line (person 0) is "the household" only by the household basis; otherwise it needs a camper. */
function grantCamper(grant: Grant): string {
  if (grant.camper_basis === 'household') return 'the household'
  if (grant.person_cm_id === 0) return 'needs a camper'
  return grant.camper_name === '' ? `person ${String(grant.person_cm_id)}` : grant.camper_name
}

const TH = 'py-1 text-left font-semibold'
const TH_RIGHT = 'py-1 text-right font-semibold'

function Section({
  id,
  title,
  action,
  children,
}: {
  id?: string | undefined
  title: string
  action?: ReactNode | undefined
  children: ReactNode
}) {
  return (
    <section id={id} className="card-lodge space-y-3 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className={SECTION_TITLE}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * Household income (§6.3 item 5; main spec §9.1, §9.3): each answer as the form sent it and as
 * pricing uses it, a correction beside the original, the family's free text for staff, and the
 * information-only notes. `correct` puts PR 9's "Correct…" on each answer.
 */
export function IncomeSection({
  page,
  correct,
}: {
  page: ApiAidHouseholdPage
  correct?: ((income: ApiAidIncome, answer: ApiAidAnswer) => ReactNode) | undefined
}) {
  if (page.incomes.length === 0) return null
  const multi = multiHousehold(page)
  return (
    <Section id="income" title="Household income">
      {page.incomes.map((income) => (
        <div key={income.household_cm_id} className="space-y-2">
          {multi && (
            <HouseholdChip
              index={householdChip(page, income.household_cm_id) ?? 0}
              name={householdName(page, income.household_cm_id)}
            />
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs">
                <th className={TH}>Answer</th>
                <th className={TH_RIGHT}>On the form</th>
                <th className={TH_RIGHT}>Used</th>
                <th className={`${TH} pl-3`} />
              </tr>
            </thead>
            <tbody>
              {income.answers.map((answer) => (
                <tr key={answer.field} className="border-border border-t">
                  <td className="py-1">{answerWords(answer.field)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {answerValue(answer.field, answer.synced)}
                  </td>
                  <td
                    className={
                      answer.corrected
                        ? 'py-1 text-right font-semibold tabular-nums'
                        : 'py-1 text-right tabular-nums'
                    }
                  >
                    {answerValue(answer.field, answer.effective)}
                  </td>
                  <td className="py-1 pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {answer.corrected && <StatusPill tone="amber">corrected</StatusPill>}
                      {answer.changed_since_correction && (
                        <span className={AMBER_NOTE}>the form changed since</span>
                      )}
                      {correct?.(income, answer)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {Object.entries(income.notes)
            .filter(([, text]) => text.trim() !== '')
            .map(([key, text]) => (
              <div key={key}>
                <div className="text-muted-foreground text-xs font-semibold">{noteWords(key)}</div>
                <p className="whitespace-pre-line">{text}</p>
              </div>
            ))}
          {income.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {income.flags.map((flag) => (
                <StatusPill key={flag.code} tone="amber">
                  {codeWords(flag.code)}
                </StatusPill>
              ))}
            </div>
          )}
        </div>
      ))}
    </Section>
  )
}

/**
 * Grants and postings (§6.3 item 6; D55, D56, D74, D127): the household's grants with the Expected
 * chip, then every CampMinder aid posting, live and reversed. A reversed line stays one row, struck
 * through and dated, so "posted $X, reversed, reposted $Y" reads top to bottom. It downloads (§11).
 */
export function GrantsPostingsSection({ page }: { page: ApiAidHouseholdPage }) {
  const camperName = (personCmId: number) =>
    page.requests.find((r) => r.row.person_cm_id === personCmId)?.row.camper_name ??
    (personCmId > 0 ? `person ${String(personCmId)}` : 'the household')
  return (
    <Section
      title="Grants and postings"
      action={
        <button
          type="button"
          className={BUTTON_SECONDARY}
          onClick={() => download(postingsCsv(page), householdCsvName(page, 'postings'))}
        >
          <Download className="h-4 w-4" />
          Download postings
        </button>
      }
    >
      {page.expected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {page.expected.map((expected) => (
            <StatusPill key={`${String(expected.household_cm_id)}:${expected.kind}`} tone="sky">
              {expectedWords(expected)}
            </StatusPill>
          ))}
        </div>
      )}
      {page.grants.length === 0 ? (
        <p className="text-muted-foreground">No outside grants.</p>
      ) : (
        <table aria-label="Grants" className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className={TH}>Grantor</th>
              <th className={TH}>Description</th>
              <th className={TH}>Camper</th>
              <th className={TH}>Recorded</th>
              <th className={TH_RIGHT}>Amount</th>
              <th className={`${TH} pl-3`} />
            </tr>
          </thead>
          <tbody>
            {page.grants.map((grant) => (
              <tr
                key={`${String(grant.transaction_cm_id)}:${grant.commitment_id}`}
                className="border-border border-t"
              >
                <td className="py-1">{grant.grantor_name === '' ? '—' : grant.grantor_name}</td>
                <td className="py-1">{grant.description}</td>
                <td className="py-1">{grantCamper(grant)}</td>
                <td className="py-1">
                  {grant.recorded_on ? formatShortDate(grant.recorded_on) : '—'}
                </td>
                <td className="py-1 text-right">
                  {grant.is_reversed ? (
                    <ReversedAmount value={grant.amount} reversedOn={grant.reversal_date} />
                  ) : (
                    <Money value={grant.amount} />
                  )}
                </td>
                <td className="py-1 pl-3">
                  {/* The band counts only live, counted, outside grants with a request share (outside_grants_by_request): say which these aren't. */}
                  {grant.cancelled ? (
                    <StatusPill tone="stone">cancelled</StatusPill>
                  ) : !countsInBand(grant) ? (
                    <StatusPill tone="muted">not counted</StatusPill>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {page.postings.length === 0 ? (
        <p className="text-muted-foreground">No CampMinder aid postings this season.</p>
      ) : (
        <table aria-label="Postings" className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className={TH}>Posted on</th>
              <th className={TH}>Camper</th>
              <th className={TH}>Program</th>
              <th className={TH}>Source</th>
              <th className={TH_RIGHT}>Aid</th>
            </tr>
          </thead>
          <tbody>
            {page.postings.map((posting) => (
              <tr key={posting.transaction_cm_id} className="border-border border-t">
                <td className="py-1">{formatShortDate(posting.post_date)}</td>
                <td className="py-1">{camperName(posting.attributed_person_cm_id)}</td>
                <td className="py-1">
                  {posting.program_family === '' ? '—' : posting.program_family}
                </td>
                <td className="py-1">{posting.effective_source_key}</td>
                <td className="py-1 text-right">
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
    </Section>
  )
}

/** Linked CampMinder households, attribution data (§6.3 †; Decision 27: read only in slice 1). */
export function LinksSection({ page }: { page: ApiAidHouseholdPage }) {
  if (page.links.length === 0) return null
  return (
    <Section title="Linked households">
      <ul className="space-y-0.5">
        {page.links.map((link) => (
          <li key={link.id}>{linkWords(link)}</li>
        ))}
      </ul>
    </Section>
  )
}

/** The family's own log, oldest first (§6.3 item 7; main spec §14.4). It downloads (§11). */
export function HistorySection({ page }: { page: ApiAidHouseholdPage }) {
  return (
    <Section
      title="History"
      action={
        page.history.length === 0 ? undefined : (
          <button
            type="button"
            className={BUTTON_SECONDARY}
            onClick={() => download(historyCsv(page), householdCsvName(page, 'history'))}
          >
            <Download className="h-4 w-4" />
            Download history
          </button>
        )
      }
    >
      {page.history.length === 0 ? (
        <p className="text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="space-y-1 text-xs">
          {page.history.map((entry, index) => (
            <li
              key={`${entry.operation_id}:${entry.entity}:${entry.entity_id}:${entry.at}:${String(index)}`}
            >
              <span className="text-muted-foreground mr-2 tabular-nums">
                {formatShortDate(entry.at)}
              </span>
              {historyLine(entry)}
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}
