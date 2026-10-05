import { useState, type ReactNode } from 'react'

import type {
  ApiAidHouseholdPage,
  ApiAidHouseholdRequest,
  ApiAidReceipt,
} from '../../../types/api-types'
import { ExternalLink } from 'lucide-react'

import { CampMinderIcon } from '../../icons'
import type { AidView } from '../kit/asOf'
import { formatMoney } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { AttentionChip } from '../kit/NeedsAttentionCell'
import { ConfirmationState, HouseholdChip, StatusPill } from '../kit/Pills'
import { Receipt } from '../kit/Receipt'
import { requestStage } from '../requests/stage'
import { DecisionPanel } from './DecisionPanel'
import {
  appliedBy,
  campMinderPersonUrl,
  camperOf,
  cancellationWords,
  cardCost,
  earlierReceipts,
  householdName,
  latestReceipt,
  opensByItself,
  requestStatusWords,
  roundLines,
  shareConfirmation,
  unreachedRounds,
  type RoundLine,
} from './householdModel'
import { HH_AMBER_NOTE, HH_CARD, HH_LINK_CM, HH_NOTE, HH_TOGGLE } from './householdStyles'

/**
 * A CampMinder link (N7): "Person" or "Household" in Title Case, drawn as the summer camper panel
 * draws its CampMinder link (CamperDetailsPanel: the CM icon, the label, the external-link glyph).
 * It opens CampMinder in a new tab.
 */
export function CampMinderLink({ href, label }: { href: string; label: 'Person' | 'Household' }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={HH_LINK_CM}>
      {/* Hidden from the link's name, so it reads as its label alone. */}
      <span aria-hidden="true" className="inline-flex">
        <CampMinderIcon className="h-4 w-4" />
      </span>
      <span>{label}</span>
      <ExternalLink aria-hidden="true" className="h-3 w-3 opacity-60" />
    </a>
  )
}

/**
 * A locked round that today's rules price differently. Once an amount is offered or posted it stands,
 * and a later change never reduces it (owner ruling 2026-10-01 S1 Q1; D43), so a lower figure is
 * never worded as a change to the family's aid.
 */
function wouldChangeSentence(line: RoundLine): string {
  const by = line.wouldChangeBy ?? 0
  const n = String(line.round)
  const posted = formatMoney(line.amount)
  return by < 0
    ? `Today's rules would lower Round ${n} by ${formatMoney(-by)}. The posted ${posted} stands; nothing is clawed back.`
    : `Today's rules would raise Round ${n} by ${formatMoney(by)}. The posted ${posted} stands; this is information only.`
}

function EarlierReceipts({
  receipts,
  view,
}: {
  receipts: readonly ApiAidReceipt[]
  view: AidView
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())
  if (receipts.length === 0) return null
  const toggle = (round: number) =>
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(round)) next.delete(round)
      else next.add(round)
      return next
    })
  return (
    <div className="space-y-1">
      {receipts.map((receipt) => {
        const n = String(receipt.round)
        const shown = open.has(receipt.round)
        // M18: a 2026 receipt is reproduced from the sheet, not what was posted.
        const as =
          receipt.label.kind === 'live'
            ? 'worked out now'
            : receipt.label.kind === 'reproduced'
              ? `reproduced from the ${String(receipt.label.season)} sheet`
              : 'posted'
        return (
          <div key={receipt.round}>
            <button type="button" className={HH_TOGGLE} onClick={() => toggle(receipt.round)}>
              {shown ? `Hide Round ${n}'s receipt ▴` : `Round ${n} as ${as} ▾`}
            </button>
            {shown && <Receipt trace={receipt.trace} label={receipt.label} view={view} />}
          </div>
        )
      })}
    </div>
  )
}

/** A chip for a household on the page; a household outside it (chip 0) is its plain name (M6). */
function PayerLabel({ chip, name }: { chip: number; name: string }) {
  return chip > 0 ? (
    <HouseholdChip index={chip} name={name} />
  ) : (
    <span className="text-xs">{name}</span>
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
          <PayerLabel chip={other.chip} name={householdName(page, other.household_cm_id)} />
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
                <PayerLabel chip={share.chip} name={householdName(page, share.household_cm_id)} />
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
 * header, the latest receipt folded under its sentence (opening by itself on a hold or a would-change
 * flag), the per-round decision panel, and its money: one line for one payer, a share table with
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
  const latest = latestReceipt(request)
  const lines = roundLines(request)
  const statusWords = requestStatusWords(row.request_status)
  const cost = cardCost(request)
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
            <PayerLabel chip={applied.chip} name={applied.name} />
          </>
        )}
        <span className={`${HH_NOTE} ml-auto`}>
          cost <Money value={cost} />
        </span>
      </div>
      {row.cancellation && (
        <div>
          <StatusPill tone="stone">{cancellationWords(row.cancellation)}</StatusPill>
        </div>
      )}
      {latest && (
        <Receipt
          trace={latest.trace}
          label={latest.label}
          view={view}
          folded
          openByItself={opensByItself(request)}
        />
      )}
      <EarlierReceipts
        // The server gives every unposted round the same live receipt: shown once, under the sentence (M8).
        receipts={earlierReceipts(request).filter(
          (receipt) => !(receipt.label.kind === 'live' && latest?.label.kind === 'live')
        )}
        view={view}
      />
      {lines
        .filter((line) => line.wouldChangeBy !== null && line.posted)
        .map((line) => (
          <p key={line.round} className={HH_AMBER_NOTE}>
            {wouldChangeSentence(line)}
          </p>
        ))}
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
