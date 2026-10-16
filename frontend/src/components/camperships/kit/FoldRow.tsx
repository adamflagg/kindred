import type { ReactNode } from 'react'

import { CS_FOLD_PANEL } from './csType'

/**
 * A fold line's toggle (design-language rule 23): the budget table's pool-row grammar, a muted 10px caret and the
 * bold label, as one button. Put it in the line's first cell; the page owns `open`.
 */
export function AidFoldToggle({
  open,
  onToggle,
  title,
  children,
}: {
  readonly open: boolean
  readonly onToggle: () => void
  readonly title?: string | undefined
  readonly children: ReactNode
}) {
  return (
    <button
      type="button"
      className="cursor-pointer text-left"
      aria-expanded={open}
      title={title}
      onClick={onToggle}
    >
      <span className="text-muted-foreground inline-block w-3 text-left text-[10px] leading-5">
        {open ? '▾' : '▸'}
      </span>
      <b>{children}</b>
    </button>
  )
}

/**
 * The line opened in place (rule 23; owner Q4-A, "as the pool rows open into their rounds"): the row straight under
 * the line, one cell across the table, holding a kit table (AidTable `hideToolbar`, its rows' own actions via
 * `aidActionColumn`). Render it only while open. Never a modal.
 */
export function AidFoldPanel({
  span,
  children,
}: {
  readonly span: number
  readonly children: ReactNode
}) {
  return (
    <tr data-aid-fold-panel="">
      <td colSpan={span} className={CS_FOLD_PANEL}>
        {children}
      </td>
    </tr>
  )
}
