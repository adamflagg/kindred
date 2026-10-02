import { useCallback } from 'react'

import { useAidEditorPreview } from '../../../hooks/camperships/useAidEditorPreview'
import { useAidKeyAsk, useAidRound3Amount } from '../../../hooks/camperships/useAidWrites'
import type { ApiAidHouseholdPage, ApiAidHouseholdRequest } from '../../../types/api-types'
import { campToday } from '../kit/dates'
import { REASON_POLICY } from '../kit/editor'
import type { PreviewHousehold } from '../kit/editorPreview'
import { formatMoney } from '../kit/money'
import { RequestEditor, type EditorPreview, type EditorSave } from '../kit/RequestEditor'
import { roundOf } from '../requests/stage'
import type { CardEditKind } from './cardEdits'
import { householdChip, householdName } from './householdModel'

const KIND = {
  appeal: { label: 'Round 2 ask', policy: REASON_POLICY.appeal_ask },
  round3_ask: { label: 'Round 3 ask', policy: REASON_POLICY.round3_ask },
  round3_amount: { label: 'Round 3 amount', policy: REASON_POLICY.round3_amount },
} as const

const IDLE: EditorPreview = { status: 'idle' }
const ignore = () => undefined

/**
 * The shared editor opened in place on a request card (§4.6; D22; Decision 23): the appeal's ask,
 * Round 3's ask with its statement of need, or Round 3's amount. While typing, the appeal and the
 * Round 3 amount show the preview (an ask alone prices nothing). Enter saves; Esc closes. A failed
 * save keeps the editor open with what was typed (the kit's editor holds it) and shows the error.
 * ⚠ Decision 40: on Round 2/3 work the round's amount shows beside the request's new total.
 */
export function CardEditor({
  request,
  page,
  kind,
  onClose,
}: {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
  kind: CardEditKind
  onClose: () => void
}) {
  const row = request.row
  const ask = useAidKeyAsk()
  const amount = useAidRound3Amount()
  const householdOf = useCallback(
    (id: number): PreviewHousehold => ({
      chip: householdChip(page, id),
      name: householdName(page, id),
    }),
    [page]
  )
  const preview = useAidEditorPreview(row.request_id, kind === 'appeal' ? 2 : 3, householdOf)
  const r2 = roundOf(row, 2)
  const r3 = roundOf(row, 3)
  const initial =
    kind === 'appeal'
      ? (r2?.ask ?? null)
      : kind === 'round3_ask'
        ? (r3?.ask ?? null)
        : (r3?.pending_approval ?? r3?.decided ?? null)
  const writing = kind === 'round3_amount' ? amount : ask
  const done = { onSuccess: onClose }
  const standing = kind === 'appeal' ? r2 : kind === 'round3_amount' ? r3 : undefined

  const onSave = (save: EditorSave) => {
    const requestId = row.request_id
    if (kind === 'round3_amount') {
      amount.mutate({ requestId, body: { amount: save.amount, note: save.reason } }, done)
    } else if (kind === 'round3_ask') {
      ask.mutate(
        {
          requestId,
          body: {
            round: 3,
            amount: save.amount,
            asked_on: campToday(),
            statement_of_need: save.reason,
          },
        },
        done
      )
    } else {
      ask.mutate(
        {
          requestId,
          body: { round: 2, amount: save.amount, asked_on: campToday(), note: save.reason },
        },
        done
      )
    }
  }

  return (
    <div data-aid-editor="" className="border-border rounded-lg border p-3">
      <RequestEditor
        familyName={householdName(page, row.household_cm_id)}
        householdCmId={row.household_cm_id}
        personCmId={row.person_cm_id}
        amountLabel={KIND[kind].label}
        initialAmount={initial}
        policy={KIND[kind].policy}
        today={campToday()}
        preview={kind === 'round3_ask' ? IDLE : preview.preview}
        onAmountChange={kind === 'round3_ask' ? ignore : preview.onAmountChange}
        onSave={onSave}
        onCancel={onClose}
        saving={writing.isPending}
        saveError={writing.error?.message ?? null}
        layout="card"
      />
      {standing?.decided != null && (
        <p className="text-muted-foreground mt-2 text-xs">
          {`Round ${String(standing.round)} now ${formatMoney(standing.decided)} (new total ${formatMoney(row.total_decided)})`}
        </p>
      )}
    </div>
  )
}
