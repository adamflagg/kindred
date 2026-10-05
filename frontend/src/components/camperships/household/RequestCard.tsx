import type { ReactNode } from 'react'

import type { ApiAidHouseholdPage, ApiAidHouseholdRequest } from '../../../types/api-types'
import { ExternalLink } from 'lucide-react'

import { CampMinderIcon } from '../../icons'
import type { AidView } from '../kit/asOf'
import { Money } from '../kit/MoneyText'
import { AttentionChip } from '../kit/NeedsAttentionCell'
import { ConfirmationState, HouseholdChip, StatusPill } from '../kit/Pills'
import { requestStage } from '../requests/stage'
import { DecisionPanel } from './DecisionPanel'
import {
  appliedBy,
  campMinderPersonUrl,
  camperOf,
  cancellationWords,
  cardCost,
  householdChipName,
  requestStatusWords,
  roundLines,
  shareConfirmation,
  unreachedRounds,
  type RoundLine,
  householdLabel,
  type HouseholdLabel,
} from './householdModel'
import { HouseholdLabelText } from './HouseholdLabel'
import { HH_AMBER_NOTE, HH_CARD, HH_LINK_CM, HH_NOTE } from './householdStyles'
import { ReceiptDetailsButton, ReceiptVersions } from './ReceiptVersions'
import { useReceiptDetails } from './useReceiptDetails'

/**
 * A CampMinder link (N7): "Person" in Title Case (CampMinder has no household record; Decision 2), drawn as the summer camper panel
 * draws its CampMinder link (CamperDetailsPanel: the CM icon, the label, the external-link glyph).
 * It opens CampMinder in a new tab.
 */
export function CampMinderLink({ href, label }: { href: string; label: 'Person' }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={HH_LINK_CM}>
      {/* Hidden from the link's name, so it reads as its label alone. */}
      <span aria-hidden="true" className="inline-flex">
        <CampMinderIcon className="h-4 w-4" />
      </span>
      <span>{label}</span>
      <ExternalLink className="h-3 w-3 opacity-60" />
    </a>
  )
}

/**
 * A chip for a household on the page; a household outside it (chip 0) is its plain name (M6). Beside
 * the chip, which is unchanged, the server's label names the household (#3025), its tie-break muted.
 */
function PayerLabel({
  chip,
  name,
  label = null,
}: {
  chip: number
  name: string
  label?: HouseholdLabel | null
}) {
  if (chip <= 0) return <span className="text-xs">{name}</span>
  return (
    <>
      <HouseholdChip index={chip} name={name} />
      {label !== null && (
        <span className="text-[12.5px]">
          {' '}
          <HouseholdLabelText label={label} />
        </span>
      )}
    </>
  )
}

function MoneyLine({
  request,
  page,
}: {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
}) {
  const row = request.row
  const payer = request.shares[0]
  const other = payer !== undefined && payer.household_cm_id !== row.household_cm_id ? payer : null
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px]">
      {other && (
        <span className="inline-flex items-center gap-1.5">
          <span className={HH_NOTE}>paid by</span>
          <PayerLabel
            chip={other.chip}
            name={householdChipName(page, other.household_cm_id)}
            label={householdLabel(page, other.household_cm_id)}
          />
        </span>
      )}
      {/* D13: the mock's "Decided $X · Posted $Y". */}
      <span>
        Decided <Money value={row.total_decided} className="font-bold" /> · Posted{' '}
        <Money value={row.total_posted} className="font-bold" />
      </span>
      {row.confirmation && <ConfirmationState confirmation={row.confirmation} />}
    </div>
  )
}

/** The mock's .sharet: 13px, padding 4/6, bottom rules. */
const SHARE_TH =
  'text-muted-foreground border-border border-b px-1.5 py-1 text-left text-xs font-semibold'
const SHARE_TD = 'border-border border-b px-1.5 py-1'

function ShareTable({
  request,
  page,
}: {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
}) {
  return (
    <table aria-label="Payer shares" className="mt-1.5 w-full border-collapse text-[13px]">
      <thead>
        <tr>
          <th className={SHARE_TH}>Payer</th>
          <th className={`${SHARE_TH} text-right`}>Share</th>
          <th className={`${SHARE_TH} text-right`}>Decided</th>
          <th className={`${SHARE_TH} text-right`}>Posted</th>
          {/* D12: the mock's header. */}
          <th className={SHARE_TH}>Confirmation</th>
        </tr>
      </thead>
      <tbody>
        {request.shares.map((share) => {
          const confirmation = shareConfirmation(share)
          return (
            <tr key={share.household_cm_id}>
              <td className={SHARE_TD}>
                <PayerLabel
                  chip={share.chip}
                  name={householdChipName(page, share.household_cm_id)}
                  label={householdLabel(page, share.household_cm_id)}
                />
              </td>
              <td
                className={`${SHARE_TD} text-right tabular-nums`}
              >{`${String(share.share_pct)}%`}</td>
              <td className={`${SHARE_TD} text-right tabular-nums`}>
                <Money value={share.decided} />
              </td>
              <td className={`${SHARE_TD} text-right tabular-nums`}>
                <Money value={share.posted} />
              </td>
              <td className={SHARE_TD}>
                {confirmation ? <ConfirmationState confirmation={confirmation} /> : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface RequestCardProps {
  readonly request: ApiAidHouseholdRequest
  readonly page: ApiAidHouseholdPage
  /** The season the receipts' rules links carry (Decision 9); live (Decision 36). */
  readonly view: AidView
  readonly checklist?: ((line: RoundLine) => ReactNode) | undefined
  readonly nextAction?: ((line: RoundLine) => ReactNode) | undefined
  /** The card's own actions (PR 8): Edit…, Round 3…, Put on Hold…, Cancel… */
  readonly actions?: ReactNode | undefined
  /** The shared editor, opened in place on the card (§4.6). */
  readonly editor?: ReactNode | undefined
}

/**
 * One request's card (§6.3 item 4; D32, D34, D50, D59, D81; decision-panel.html, round7.html): its
 * header, the receipt folded under its sentence with a switcher across its versions (opening by
 * itself on a hold), the per-round decision panel, and its money: one line for one payer, a share table with
 * each share's own confirmation for several.
 */
export function RequestCard({
  request,
  page,
  view,
  checklist,
  nextAction,
  actions,
  editor,
}: RequestCardProps) {
  const row = request.row
  const stage = requestStage(row)
  const applied = appliedBy(request, page)
  const lines = roundLines(request)
  const statusWords = requestStatusWords(row.request_status)
  const cost = cardCost(request)
  const details = useReceiptDetails(request)
  return (
    <div id={`request-${row.request_id}`} className={`${HH_CARD} space-y-1.5`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <b>{camperOf(request)}</b>
        <span className="text-muted-foreground">
          {`· ${row.session_name}${row.person_cm_id > 0 ? ' ·' : ''}`}
        </span>
        {row.person_cm_id > 0 && (
          <CampMinderLink href={campMinderPersonUrl(row.person_cm_id, page.year)} label="Person" />
        )}
        {stage && !row.cancellation && <StatusPill tone={stage.tone}>{stage.text}</StatusPill>}
        {statusWords !== null && <StatusPill tone="stone">{statusWords}</StatusPill>}
        {applied && (
          <>
            <span className={HH_NOTE}>applied by</span>
            <PayerLabel
              chip={applied.chip}
              name={applied.name}
              label={householdLabel(page, row.household_cm_id)}
            />
          </>
        )}
        {/* household-v4 section 1 (B): the receipt opens from beside the cost. */}
        <span className={`${HH_NOTE} ml-auto`}>
          cost <Money value={cost} />
        </span>
        <ReceiptDetailsButton request={request} open={details.open} onToggle={details.toggle} />
      </div>
      {row.cancellation && (
        <div>
          <StatusPill tone="stone">{cancellationWords(row.cancellation)}</StatusPill>
        </div>
      )}
      {/* Round 3 (B): the chip line on top; opened, a switcher across its versions, each diffed against the one before. */}
      <ReceiptVersions request={request} view={view} open={details.open} />
      {/* The server's notes (calculator warnings, D81's "not yet marked posted"), as the grid's attention cell words them. */}
      {(row.notes ?? []).map((issue, index) => (
        <p key={`${issue.code}:${String(index)}`} className={HH_AMBER_NOTE}>
          {issue.message}
        </p>
      ))}
      {/* B21 (ruled 10-04 late): a round the overnight tick passed over carries the grid's Not
          reconciled reason pill beside the server's own sentence for it. */}
      {(row.unticked ?? []).map((money) => (
        <p
          key={`unticked:${String(money.round)}:${money.code}`}
          className={`${HH_AMBER_NOTE} flex flex-wrap items-center gap-x-2 gap-y-1`}
        >
          <AttentionChip item={{ level: 'note', pill: money.label, fact: money.message }} />
          <span>{money.message}</span>
        </p>
      ))}
      {lines.length > 0 && (
        <div className="pt-1">
          <DecisionPanel
            lines={lines}
            unreached={unreachedRounds(request)}
            total={row.total_decided}
            checklist={checklist}
            nextAction={nextAction}
          />
        </div>
      )}
      {/* #2941 merged: shares.length matches the grid's payer_count (the same payers; one implied 100% line for none). */}
      {request.shares.length > 1 ? (
        <ShareTable request={request} page={page} />
      ) : // D26: a withdrawn or duplicate request with nothing decided draws no "Decided — Posted —".
      statusWords !== null && lines.length === 0 ? null : (
        <MoneyLine request={request} page={page} />
      )}
      {editor && <div className="pt-1">{editor}</div>}
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>
      )}
    </div>
  )
}
