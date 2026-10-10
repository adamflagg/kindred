import type { ReactNode } from 'react'

import { CS_CARD_HEADING } from './csType'

/**
 * A section's heading row (design-language §19; mock `CF.thead`): a bold (700) title, its footnote mark, then the muted
 * one-line summary straight after, and a right slot. With `onToggle` the title is a caret button that folds the
 * section's table; without it the title is a plain h2. One row, never wrapping: the summary truncates (full words in
 * its title).
 */
export function AidSectionHead({
  title,
  note,
  description,
  right,
  open = false,
  onToggle,
  testId,
}: {
  readonly title: string
  readonly note?: ReactNode
  readonly description?: string | undefined
  readonly right?: ReactNode
  readonly open?: boolean
  readonly onToggle?: (() => void) | undefined
  readonly testId?: string | undefined
}) {
  return (
    <div
      data-testid={testId}
      className="mt-4 mb-1.5 ml-0.5 flex min-h-[28px] flex-nowrap items-center gap-2.5"
    >
      {onToggle === undefined ? (
        <h2 className={`${CS_CARD_HEADING} min-w-0 truncate whitespace-nowrap`}>{title}</h2>
      ) : (
        // The title's run (mock: the fold link, then S(n)): the note mark sits inline straight after the title, raised
        // at 0.72em of 13.5px, never a flex item 10px away (a flex item can't be raised).
        <span className="text-foreground text-[13.5px] leading-[20px] font-bold whitespace-nowrap">
          <button
            type="button"
            aria-expanded={open}
            className="cursor-pointer font-bold hover:underline"
            onClick={onToggle}
          >
            {/* text-left: a button centres its text, which pushed the caret against the title */}
            <span className="text-muted-foreground inline-block w-3.5 text-left no-underline">
              {open ? '▾' : '▸'}
            </span>
            {title}
          </button>
          {note}
        </span>
      )}
      {onToggle === undefined && note}
      {description !== undefined && description !== '' && (
        <span
          title={description}
          className="text-muted-foreground min-w-0 truncate text-xs leading-4 whitespace-nowrap"
        >
          {description}
        </span>
      )}
      {right !== undefined && (
        <span className="ml-auto flex flex-none items-center gap-2">{right}</span>
      )}
    </div>
  )
}
