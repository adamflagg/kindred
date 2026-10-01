import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { AMBER_NOTE, FIELD, FIELD_INLINE } from '../../admin/lodging/lodgingStyles'
import { STATUS_TONE } from './aidStyles'
import { initialReason, parseMoneyInput, reasonMissing, type TextReasonPolicy } from './editor'
import { Money } from './MoneyText'
import { HouseholdChip, StatusPill } from './Pills'
import { ReceiptSentence } from './Receipt'
import type { AidTraceStep } from './receiptModel'

export interface EditorShare {
  readonly householdIndex: 1 | 2 | 3
  readonly householdName: string
  readonly pct: number
  readonly amount: number
}

/** What the server worked out for the amount typed (§"What waits on slice 1's reads" item 4). */
export interface EditorPreview {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly award?: number | null | undefined
  readonly trace?: readonly AidTraceStep[] | undefined
  readonly stageChange?: string | null | undefined
  readonly shares?: readonly EditorShare[] | undefined
  readonly pendingApproval?: boolean | undefined
  readonly error?: string | undefined
}

export interface EditorSave {
  readonly amount: number
  readonly reason: string
}

interface RequestEditorProps {
  readonly familyName: string
  readonly householdCmId: number
  readonly personCmId: number
  /** What is typed: "Round 2 ask" (staff type the family's ask; the award is computed, D22). */
  readonly amountLabel: string
  readonly initialAmount: number | null
  readonly policy: TextReasonPolicy
  /** Today on camp time, for the pre-filled note. */
  readonly today: string
  readonly preview: EditorPreview
  /** Every readable amount typed (null when unreadable); the surface debounces and fetches the preview. */
  readonly onAmountChange: (amount: number | null) => void
  readonly onSave: (save: EditorSave) => void
  /**
   * Grid only (Decision 6, RULED 2026-10-01): ↓ saves and moves on (D22), or just moves when
   * nothing was typed (save = null); ↑ just moves back, and only when nothing was typed (D31).
   */
  readonly onMove?: ((direction: 1 | -1, save: EditorSave | null) => void) | undefined
  readonly onCancel: () => void
  readonly saving?: boolean | undefined
  /** 'row' under the highlighted grid row; 'card' in place on the household page's request card (D22). */
  readonly layout?: 'row' | 'card' | undefined
}

function EditorResult({ preview }: { preview: EditorPreview }) {
  if (preview.status === 'idle') return null
  if (preview.status === 'loading')
    return <span className="text-muted-foreground text-xs">Working it out…</span>
  if (preview.status === 'error') {
    return <span className={AMBER_NOTE}>{preview.error ?? "Couldn't work out the award"}</span>
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        Award <Money value={preview.award ?? null} className="font-semibold" />
      </span>
      {preview.pendingApproval === true && (
        <StatusPill tone={STATUS_TONE.round3}>Pending approval</StatusPill>
      )}
      {preview.trace !== undefined && preview.trace.length > 0 && (
        <ReceiptSentence trace={preview.trace} className="text-muted-foreground text-xs" />
      )}
      {preview.stageChange ? (
        <span className="text-muted-foreground text-xs">Stage → {preview.stageChange}</span>
      ) : null}
      {preview.shares?.map((share) => (
        <span key={share.householdIndex} className="inline-flex items-center gap-1 text-xs">
          <HouseholdChip index={share.householdIndex} name={share.householdName} /> {share.pct}% ·{' '}
          <Money value={share.amount} />
        </span>
      ))}
    </span>
  )
}

/**
 * The one shared request editor (§4.6; D22): an editor row under the highlighted grid row, or in
 * place on the household page's request card.
 * - While typing it shows the computed award, the limit that bound it (the receipt's one-line
 *   form), the stage change, the recomputed payer shares and both CampMinder ids (D27).
 * - Enter saves, once (Ruling 2026-10-01 (plan review)). ↓ saves and moves on. Esc cancels.
 * - A Round 3 above the registrar's limit says it goes to finance (D79).
 */
export function RequestEditor(props: RequestEditorProps) {
  const initialRaw = props.initialAmount === null ? '' : String(props.initialAmount)
  const [raw, setRaw] = useState(initialRaw)
  const [reason, setReason] = useState(() => initialReason(props.policy, props.today))
  const [initialNote] = useState(() => initialReason(props.policy, props.today))
  const [tried, setTried] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  // Set by a save; cleared by an edit or by a save finishing. A second Enter before either is
  // ignored, re-render or not.
  const submitted = useRef(false)
  const wasSaving = useRef(false)
  const parsed = parseMoneyInput(raw)

  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  useEffect(() => {
    if (wasSaving.current && props.saving !== true) submitted.current = false
    wasSaving.current = props.saving === true
  }, [props.saving])

  const untouched = raw === initialRaw && reason === initialNote
  const problem =
    parsed.kind === 'invalid'
      ? parsed.reason
      : parsed.kind === 'empty'
        ? `Enter the ${props.amountLabel.toLowerCase()}`
        : props.policy.kind === 'required' && reasonMissing(props.policy, reason)
          ? `${props.policy.label} is required`
          : null

  /** The save, once: null when it isn't valid yet or one is already on its way. */
  const takeSave = (): EditorSave | null => {
    setTried(true)
    if (problem !== null || parsed.kind !== 'ok' || props.saving === true || submitted.current)
      return null
    submitted.current = true
    return { amount: parsed.amount, reason: reason.trim() }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.repeat) return
      const save = takeSave()
      if (save) props.onSave(save)
    } else if (event.key === 'ArrowDown' && props.onMove) {
      event.preventDefault()
      if (untouched) {
        props.onMove(1, null)
        return
      }
      if (event.repeat) return
      const save = takeSave()
      if (save) props.onMove(1, save)
    } else if (event.key === 'ArrowUp' && props.onMove && untouched) {
      event.preventDefault()
      props.onMove(-1, null)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      props.onCancel()
    }
  }

  return (
    <div
      className={
        props.layout === 'card'
          ? 'space-y-2 text-sm'
          : 'flex flex-wrap items-center gap-x-5 gap-y-2 text-sm'
      }
    >
      <span className="text-muted-foreground text-xs">
        {props.familyName} · household {props.householdCmId} · person {props.personCmId}
      </span>
      <label className="flex items-center gap-2">
        {props.amountLabel}
        <input
          ref={amountRef}
          type="text"
          inputMode="decimal"
          value={raw}
          onChange={(event) => {
            submitted.current = false
            setRaw(event.target.value)
            const next = parseMoneyInput(event.target.value)
            props.onAmountChange(next.kind === 'ok' ? next.amount : null)
          }}
          onKeyDown={onKeyDown}
          className={`${FIELD_INLINE} w-28 text-right tabular-nums`}
        />
      </label>
      <EditorResult preview={props.preview} />
      {props.policy.kind !== 'none' && (
        <label className="flex min-w-[16rem] flex-1 items-center gap-2">
          {props.policy.label}
          <input
            type="text"
            value={reason}
            onChange={(event) => {
              submitted.current = false
              setReason(event.target.value)
            }}
            onKeyDown={onKeyDown}
            className={FIELD}
          />
        </label>
      )}
      <span className="text-muted-foreground text-xs">
        Enter saves{props.onMove ? ' · ↓ saves and moves on' : ''} · Esc cancels
      </span>
      {tried && problem !== null && <span className={AMBER_NOTE}>{problem}</span>}
    </div>
  )
}
