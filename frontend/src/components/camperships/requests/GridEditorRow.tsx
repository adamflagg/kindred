import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { ACTION_LINK } from '../../admin/lodging/lodgingStyles'
import { useAidEditorPreview } from '../../../hooks/camperships/useAidEditorPreview'
import type { ApiAidGridRow } from '../../../types/api-types'
import { campToday } from '../kit/dates'
import { REASON_POLICY } from '../kit/editor'
import type { PreviewHousehold } from '../kit/editorPreview'
import { isTypingAttempt } from '../kit/keyboard'
import { RequestEditor } from '../kit/RequestEditor'
import type { WalkEditorProps } from '../kit/useEditorWalk'
import { appealTarget } from './gridEditor'

function AppealEditor({
  row,
  initialAmount,
  walk,
  step,
}: {
  row: ApiAidGridRow
  initialAmount: number | null
  walk: WalkEditorProps
  step: ReactNode
}) {
  // The grid knows only the row's own household by name; another payer reads "Another household".
  const householdOf = useCallback(
    (householdCmId: number): PreviewHousehold =>
      householdCmId === row.household_cm_id
        ? { chip: null, name: row.family_name }
        : { chip: null, name: null },
    [row.household_cm_id, row.family_name]
  )
  const { preview, onAmountChange } = useAidEditorPreview(row.request_id, 2, householdOf)
  return (
    <RequestEditor
      familyName={row.family_name}
      householdCmId={row.household_cm_id}
      personCmId={row.person_cm_id}
      amountLabel="Round 2 ask"
      initialAmount={initialAmount}
      policy={REASON_POLICY.appeal_ask}
      today={campToday()}
      preview={preview}
      onAmountChange={onAmountChange}
      layout="panel"
      trailing={step}
      {...walk}
    />
  )
}

/**
 * Why no ask can be keyed on this row, in the server's words (#2997), shown only once someone tries
 * to type on it (owner fast-follow (a), 10-03; `isTypingAttempt`), not every time it opens. A save
 * refused on a row that can no longer be keyed always shows, with Dismiss.
 */
function Refusal({ why, walk }: { why: string; walk: WalkEditorProps }) {
  const [tried, setTried] = useState(false)
  const sentenceRef = useRef<HTMLSpanElement>(null)
  // The sentence grows the opened row after AidTable scrolled it into view on opening, so a row
  // walked to with ↓ (flush with the box's bottom) would show it out of sight (scan K2, #3000).
  useEffect(() => {
    if (tried) sentenceRef.current?.scrollIntoView({ block: 'nearest' })
  }, [tried])
  useEffect(() => {
    if (tried) return
    const onKey = (event: KeyboardEvent) => {
      if (isTypingAttempt(event)) setTried(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tried])
  if (!tried && walk.saveError === null) return null
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {tried && (
        <span ref={sentenceRef} className="text-muted-foreground">
          {why}
        </span>
      )}
      {walk.saveError !== null && (
        // A refused save can leave a row nothing can be keyed on (posted or cancelled meanwhile):
        // with no editor to clear it, "Dismiss" does (Esc's clear), so it can't hold every exit.
        <>
          <span className="text-amber-700 dark:text-amber-400">{`Couldn't save: ${walk.saveError}`}</span>
          <button type="button" className={ACTION_LINK} onClick={walk.onCancel}>
            Dismiss
          </button>
        </>
      )}
    </div>
  )
}

/**
 * The opened row's editing part (§4.6; D22; Decision 13): the Round 2 ask as the right-hand panel
 * beside the detail text, with the row's next step at the end of its line (owner fast-follow,
 * opened-row-options.html arrangement 3), or why none can be keyed here. The detail line beside it
 * names and links the household, once.
 */
export function GridEditorRow({
  row,
  walk,
  step,
}: {
  row: ApiAidGridRow
  walk: WalkEditorProps
  /** The detail line's next step: drawn at the end of the editor's line when there is an editor. */
  step: ReactNode
}) {
  const target = appealTarget(row)
  if (target.kind === 'appeal') {
    return (
      <AppealEditor
        key={row.request_id}
        row={row}
        initialAmount={target.initialAmount}
        walk={walk}
        step={step}
      />
    )
  }
  return <Refusal key={row.request_id} why={target.why} walk={walk} />
}
