import { useCallback, type MouseEvent } from 'react'

import { ACTION_LINK } from '../../admin/lodging/lodgingStyles'
import { useAidEditorPreview } from '../../../hooks/camperships/useAidEditorPreview'
import type { ApiAidGridRow } from '../../../types/api-types'
import { campToday } from '../kit/dates'
import { REASON_POLICY } from '../kit/editor'
import type { PreviewHousehold } from '../kit/editorPreview'
import { RequestEditor } from '../kit/RequestEditor'
import type { WalkEditorProps } from '../kit/useEditorWalk'
import { appealTarget } from './gridEditor'
import type { HouseholdLinks } from './RequestsGrid'

function AppealEditor({
  row,
  initialAmount,
  walk,
}: {
  row: ApiAidGridRow
  initialAmount: number | null
  walk: WalkEditorProps
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
      layout="row"
      {...walk}
    />
  )
}

/**
 * The editor row under the highlighted grid row (§4.6; D22; Decision 13): the Round 2 ask, or why
 * none can be keyed here, with the way to the household page, where every other edit lives.
 */
export function GridEditorRow({
  row,
  walk,
  links,
}: {
  row: ApiAidGridRow
  walk: WalkEditorProps
  links: HouseholdLinks
}) {
  const target = appealTarget(row)
  if (target.kind === 'appeal') {
    return (
      <AppealEditor
        key={row.request_id}
        row={row}
        initialAmount={target.initialAmount}
        walk={walk}
      />
    )
  }
  const href = links.href(row)
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    // As RequestsGrid's HouseholdLink (PR 2): before the modifier check, so a ⌘/Ctrl click that
    // opens a new tab doesn't also reach the row or the editor.
    event.stopPropagation()
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    links.open(row, href)
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">{target.why}</span>
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
      <a href={href} onClick={open} className="text-primary font-medium hover:underline">
        Open the household ›
      </a>
    </div>
  )
}
