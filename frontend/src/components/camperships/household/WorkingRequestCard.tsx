import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { useAidCancellation, useAidManualHold } from '../../../hooks/camperships/useAidWrites'
import type { ApiAidHouseholdPage, ApiAidHouseholdRequest } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { CancelForm } from './CancelForm'
import { CardEditor, type CardEditorHandle } from './CardEditor'
import { CARD_EDIT_LABEL, cardEdits, type CardEditKind } from './cardEdits'
import { usePrefetchCardPreviews } from './cardPreviews'
import { caseworkOffers } from './caseworkModel'
import { DuplicateForm, HeadcountForm, SessionForm, ShareForm } from './CaseworkForms'
import { isLiveRequest } from '../requests/gridEditor'
import type { EditorExits } from './editorExits'
import { ReleasedHolds } from './HoldActions'
import { staffNames } from './historyWords'
import { HH_BUTTON } from './householdStyles'
import { ReasonForm } from './ReasonForm'
import { RequestCard } from './RequestCard'
import { RoundChecklist, RoundNextAction } from './RoundActions'

type Open =
  | { readonly kind: 'edit'; readonly edit: CardEditKind }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'reopen' }
  | { readonly kind: 'hold' }
  | { readonly kind: 'shares' }
  | { readonly kind: 'session' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'headcount' }
  | null

/**
 * A request card with its casework (§6.3; D22, D50, D51, D79, D101; Decisions 22–25): the money
 * edits in place, Put on Hold…, the cancel form, the round checklist and next actions, and holds
 * released before. Without `casework` it is the plain card.
 *
 * The card's `actions` buttons (the money edits, hold, cancel, reopen) go through `switchTo`, which
 * first leaves the open money editor (saving what is typed), and then the one open on any other
 * card (`exits`): one money editor per page. The round checklist and next actions do not: while this
 * card's money editor is open they are disabled instead (`editing`), since Mark Posted would lock the
 * figure being edited. The hold banners' Lift/Release/Put back are wired straight to their writes
 * and cross an open editor (a known limit). The cancel, hold, reopen and casework forms (Payer
 * Shares…, Settle Session…, Keep the Other Request…, Headcount…) don't register: saving them on
 * leave would act without confirmation, so leaving one of them drops what was typed. Each casework
 * button is offered as the server gates its write (`caseworkOffers`), and its form closes if a
 * refetch takes that offer away.
 */
export function WorkingRequestCard({
  request,
  page,
  view,
  canWork,
  canApprove,
  exits,
}: {
  request: ApiAidHouseholdRequest
  page: ApiAidHouseholdPage
  view: AidView
  canWork: boolean
  canApprove: boolean
  /** The page's coordinator for its one open editor; absent, the card stands alone. */
  exits?: EditorExits | undefined
}) {
  const cancellation = useAidCancellation()
  const manual = useAidManualHold()
  const [open, setOpen] = useState<Open>(null)
  const editorRef = useRef<CardEditorHandle>(null)
  const requestId = request.row.request_id
  const leaveOwn = useCallback((go: () => void) => {
    if (editorRef.current) editorRef.current.leave(go)
    else go()
  }, [])
  // An editor is shown only while the row still offers its edit: a refetch that takes the edit away
  // (Posted undone, Round 3 posted elsewhere, the request no longer live) closes it, instead of
  // leaving a draft that can only be refused and would block every exit. No current save removes its
  // own kind (a Round 3 amount stays offered while pending), so this never unmounts an in-flight save.
  // The casework forms below are the exception: a Settle session or Keep-the-other save removes its own
  // offer (the refetch it awaits moves the status), so its form unmounts while the save is still
  // pending. That is benign: the form's late state is dropped, and its `closeIfStill` then clears `open`.
  const edit =
    open?.kind === 'edit' && cardEdits(request.row).includes(open.edit) ? open.edit : null
  const editing = edit !== null
  const offers = caseworkOffers(request.row)
  // Like `edit`: a form shows only while the request still takes it, so a refetch that moves the
  // status (Settle session saved elsewhere, the request withdrawn) cannot leave a form that is refused.
  const form =
    (open?.kind === 'shares' && offers.shares) ||
    (open?.kind === 'session' && offers.session) ||
    (open?.kind === 'duplicate' && offers.duplicate) ||
    (open?.kind === 'headcount' && offers.headcount)
      ? open.kind
      : null
  useEffect(() => {
    if (exits === undefined || !editing) return undefined
    // Left on another card's account, this editor closes once it has saved.
    return exits.register(requestId, (go) =>
      leaveOwn(() => {
        setOpen(null)
        go()
      })
    )
  }, [exits, editing, requestId, leaveOwn])
  // R2: the preview each offered money editor would open on, read while the card rests.
  usePrefetchCardPreviews(request.row, canWork ? cardEdits(request.row) : [])
  if (!canWork) return <RequestCard request={request} page={page} view={view} />

  const row = request.row
  const year = page.year
  const c = row.cancellation
  // The server's `_live`: a withdrawn or duplicate request takes no cancellation or hold.
  const live = isLiveRequest(row)
  const manualHeld = row.holds.some((hold) => hold.code === 'manual_hold')
  const switchTo = (next: Open) => {
    // Re-clicking the open editor's own button would save it and leave it open on the same draft.
    if (next?.kind === 'edit' && edit === next.edit) return
    // The same for a casework form (m1): a re-click would swap `open` for a new object under a form
    // that is still saving, and the save's own close would then find it no longer the open one.
    if (next !== null && next.kind !== 'edit' && open?.kind === next.kind) return
    leaveOwn(() => {
      if (exits === undefined) setOpen(next)
      else exits.leaveOthers(requestId, () => setOpen(next))
    })
  }
  // A form that saved closes itself only if it is still the one open: an exit in between is not undone.
  const closeIfStill = (mine: Open) => () => setOpen((now) => (now === mine ? null : now))
  const button = (label: string, next: Open) => (
    <button key={label} type="button" className={HH_BUTTON} onClick={() => switchTo(next)}>
      {label}
    </button>
  )

  const actions = (
    <>
      {cardEdits(row).map((edit) => button(CARD_EDIT_LABEL[edit], { kind: 'edit', edit }))}
      {live && !c && !manualHeld && button('Put on Hold…', { kind: 'hold' })}
      {live && !c && button('Cancel Request…', { kind: 'cancel' })}
      {live &&
        c?.by === 'campminder' &&
        button(c.reason === null ? 'Give a Reason…' : 'Change the Reason…', { kind: 'cancel' })}
      {live && c?.by === 'kindred' && button('Change the Reason…', { kind: 'cancel' })}
      {live && c?.by === 'kindred' && button('Reopen…', { kind: 'reopen' })}
      {offers.shares && button('Payer Shares…', { kind: 'shares' })}
      {offers.session && button('Settle Session…', { kind: 'session' })}
      {offers.duplicate && button('Keep the Other Request…', { kind: 'duplicate' })}
      {offers.headcount && button('Headcount…', { kind: 'headcount' })}
      <ReleasedHolds request={request} names={staffNames(page)} />
    </>
  )

  const close = closeIfStill(open)
  let editor: ReactNode = undefined
  if (edit !== null) {
    editor = (
      <CardEditor ref={editorRef} request={request} page={page} kind={edit} onClose={close} />
    )
  } else if (form === 'shares') {
    editor = <ShareForm request={request} page={page} onDone={close} />
  } else if (form === 'session') {
    editor = <SessionForm request={request} onDone={close} />
  } else if (form === 'duplicate') {
    editor = <DuplicateForm request={request} page={page} onDone={close} />
  } else if (form === 'headcount') {
    editor = <HeadcountForm request={request} page={page} onDone={close} />
  } else if (open?.kind === 'cancel') {
    editor = (
      <CancelForm
        head={c ? 'Changing the reason' : 'Cancelling the request'}
        initial={c ? { reason: c.reason, note: c.note } : null}
        submitLabel={c ? 'Save the Reason' : 'Cancel the Request'}
        onSubmit={(reason, note) =>
          cancellation
            .mutateAsync({ requestId, body: { cancelled: true, reason, note } })
            .then(close)
        }
        onCancel={close}
      />
    )
  } else if (open?.kind === 'reopen') {
    editor = (
      <ReasonForm
        head="Reopening the request"
        label="Why reopen"
        submitLabel="Reopen"
        onSubmit={(note) =>
          cancellation.mutateAsync({ requestId, body: { cancelled: false, note } }).then(close)
        }
        onCancel={close}
      />
    )
  } else if (open?.kind === 'hold') {
    editor = (
      <ReasonForm
        head="Putting on hold"
        hint="The request stays on hold until someone lifts it."
        label="Reason for the hold"
        submitLabel="Put on Hold"
        onSubmit={(note) =>
          manual.mutateAsync({ requestId, body: { held: true, note } }).then(close)
        }
        onCancel={close}
      />
    )
  }

  return (
    <RequestCard
      request={request}
      page={page}
      view={view}
      actions={actions}
      editor={editor}
      checklist={(line) => (
        <RoundChecklist request={request} line={line} year={year} editing={editing} />
      )}
      nextAction={(line) => (
        <RoundNextAction
          request={request}
          line={line}
          year={year}
          canApprove={canApprove}
          editing={editing}
        />
      )}
    />
  )
}
