import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react'

import { useAidEditorPreview } from '../../../hooks/camperships/useAidEditorPreview'
import { useAidKeyAsk, useAidRound3Amount } from '../../../hooks/camperships/useAidWrites'
import type { ApiAidHouseholdPage, ApiAidHouseholdRequest } from '../../../types/api-types'
import { campToday } from '../kit/dates'
import { REASON_POLICY } from '../kit/editor'
import { formatMoney } from '../kit/money'
import type { PreviewHousehold } from '../kit/editorPreview'
import {
  RequestEditor,
  type EditorDraftReport,
  type EditorPreview,
  type EditorSave,
} from '../kit/RequestEditor'
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
 * Under the editor, the card says what the edit makes the round and the request's new total
 * (Decision 40): the card's own line, the grid has its New total cell.
 */
export interface CardEditorHandle {
  /**
   * F2 4/5: every exit the page owns asks here first. Nothing typed: `go` now. Typed but not
   * saveable: the editor shows what is missing and `go` is NOT called. Saveable: the editor's own
   * write saves it (so saving and the error show here) and `go` runs once the save and the refresh
   * land. A failure keeps the editor open with what was typed and never calls `go`. A save already
   * in flight: `go` runs when it succeeds.
   */
  leave(go: () => void): void
}

interface CardEditorProps {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
  kind: CardEditKind
  onClose: () => void
  /** What is typed (null when nothing is), so the page knows an exit has something to save. */
  onDraftChange?: ((report: EditorDraftReport | null) => void) | undefined
  ref?: Ref<CardEditorHandle> | undefined
}

/**
 * Keyed by request and kind, so a change of either starts the mutations, the preview and the
 * typed note afresh: an appeal's note can never become a Round 3 statement of need.
 */
export function CardEditor(props: CardEditorProps) {
  return <CardEditorBody key={`${props.request.row.request_id}:${props.kind}`} {...props} />
}

function CardEditorBody({ request, page, kind, onClose, onDraftChange, ref }: CardEditorProps) {
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
  const lastReport = useRef<EditorDraftReport | null>(null)
  const goAfter = useRef<(() => void) | null>(null)
  const [showProblem, setShowProblem] = useState(false)
  // A save that lands runs the exit waiting on it, else closes; a failure drops the exit.
  const done = {
    onSuccess: () => {
      const go = goAfter.current
      goAfter.current = null
      if (go !== null) go()
      else onClose()
    },
    onError: () => {
      goAfter.current = null
    },
  }

  useImperativeHandle(ref, () => ({
    leave: (go) => {
      const report = lastReport.current
      if (report === null) {
        go()
        return
      }
      if (report.save === null) {
        setShowProblem(true)
        return
      }
      if (goAfter.current !== null) return
      goAfter.current = go
      if (!writing.isPending) doSave(report.save)
    },
  }))

  const doSave = (save: EditorSave) => {
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

  // Only a ready preview of a priced edit (an ask alone prices nothing) with both figures. A Round 3
  // amount waiting on finance is not the award yet, and its total leaves it out: say so.
  const shown = preview.preview
  const totalLine =
    kind !== 'round3_ask' &&
    shown.status === 'ready' &&
    shown.award != null &&
    shown.totalDecided != null
      ? shown.pendingApproval === true
        ? `Round 3 would be ${formatMoney(shown.award)} once finance approves · total stays ${formatMoney(shown.totalDecided)}`
        : `Round ${kind === 'appeal' ? '2' : '3'} now ${formatMoney(shown.award)} (new total ${formatMoney(shown.totalDecided)})`
      : null

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
        onSave={doSave}
        onCancel={onClose}
        showProblem={showProblem}
        onDraftChange={(report) => {
          lastReport.current = report
          onDraftChange?.(report)
        }}
        saving={writing.isPending}
        saveError={writing.error?.message ?? null}
        layout="card"
      />
      {totalLine !== null && <p className="text-muted-foreground mt-2 text-xs">{totalLine}</p>}
    </div>
  )
}
