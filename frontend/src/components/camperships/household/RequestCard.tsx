import { useState, type ReactNode } from 'react'

import type {
  ApiAidHouseholdPage,
  ApiAidHouseholdRequest,
  ApiAidReceipt,
} from '../../../types/api-types'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import type { AidView } from '../kit/asOf'
import { formatMoney } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { ConfirmationState, HouseholdChip, StatusPill } from '../kit/Pills'
import { Receipt } from '../kit/Receipt'
import { requestStage } from '../requests/stage'
import { DecisionPanel } from './DecisionPanel'
import {
  appliedBy,
  camperOf,
  cancellationWords,
  earlierReceipts,
  householdName,
  latestReceipt,
  opensByItself,
  requestStatusWords,
  roundLines,
  shareConfirmation,
  type RoundLine,
} from './householdModel'

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
            <button
              type="button"
              className="text-primary text-xs hover:underline"
              onClick={() => toggle(receipt.round)}
            >
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {other && (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">paid by</span>
          <PayerLabel chip={other.chip} name={householdName(page, other.household_cm_id)} />
        </span>
      )}
      <span>
        Decided <Money value={row.total_decided} className="font-semibold" />
      </span>
      <span>
        Posted <Money value={row.total_posted} className="font-semibold" />
      </span>
      {row.confirmation && <ConfirmationState confirmation={row.confirmation} />}
    </div>
  )
}

function ShareTable({
  request,
  page,
}: {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
}) {
  return (
    <table aria-label="Payer shares" className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-xs">
          <th className="py-1 text-left font-semibold">Payer</th>
          <th className="py-1 text-right font-semibold">Share</th>
          <th className="py-1 text-right font-semibold">Decided</th>
          <th className="py-1 text-right font-semibold">Posted</th>
          <th className="py-1 pl-3 text-left font-semibold">Confirmed by the ledger</th>
        </tr>
      </thead>
      <tbody>
        {request.shares.map((share) => {
          const confirmation = shareConfirmation(share)
          return (
            <tr key={share.household_cm_id} className="border-border border-t">
              <td className="py-1">
                <PayerLabel chip={share.chip} name={householdName(page, share.household_cm_id)} />
              </td>
              <td className="py-1 text-right tabular-nums">{`${String(share.share_pct)}%`}</td>
              <td className="py-1 text-right">
                <Money value={share.decided} />
              </td>
              <td className="py-1 text-right">
                <Money value={share.posted} />
              </td>
              <td className="py-1 pl-3">
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
  return (
    <div id={`request-${row.request_id}`} className="card-lodge space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <b>{camperOf(request)}</b>
        <span className="text-muted-foreground">
          {`· ${row.session_name}${row.person_cm_id > 0 ? ` · person ${String(row.person_cm_id)}` : ''}`}
        </span>
        {stage && !row.cancellation && <StatusPill tone={stage.tone}>{stage.text}</StatusPill>}
        {statusWords !== null && <StatusPill tone="stone">{statusWords}</StatusPill>}
        {applied && (
          <>
            <span className="text-muted-foreground text-xs">applied by</span>
            <PayerLabel chip={applied.chip} name={applied.name} />
          </>
        )}
        <span className="text-muted-foreground ml-auto text-xs">
          cost <Money value={row.cost} />
        </span>
      </div>
      {row.cancellation && (
        <StatusPill tone="stone">{cancellationWords(row.cancellation)}</StatusPill>
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
          <p key={line.round} className={AMBER_NOTE}>
            {wouldChangeSentence(line)}
          </p>
        ))}
      {/* The server's notes (calculator warnings, D81's "not yet ticked"), as the grid's attention cell words them. */}
      {(row.notes ?? []).map((issue, index) => (
        <p key={`${issue.code}:${String(index)}`} className={AMBER_NOTE}>
          {issue.message}
        </p>
      ))}
      {lines.length > 0 && (
        <DecisionPanel
          lines={lines}
          total={row.total_decided}
          checklist={checklist}
          nextAction={nextAction}
        />
      )}
      {/* #2941 merged: shares.length matches the grid's payer_count (the same payers; one implied 100% line for none). */}
      {request.shares.length > 1 ? (
        <ShareTable request={request} page={page} />
      ) : (
        <MoneyLine request={request} page={page} />
      )}
      {editor}
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
