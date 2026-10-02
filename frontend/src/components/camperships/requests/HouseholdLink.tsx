import type { MouseEvent, ReactNode } from 'react'

import type { ApiAidGridRow } from '../../../types/api-types'

/** How a row reaches its household page (slice 1 Decision 1): the link, and the surface's way to go there. */
export interface HouseholdLinks {
  readonly href: (row: ApiAidGridRow) => string
  readonly open: (row: ApiAidGridRow, href: string) => void
}

/**
 * A link to the row's household page, at a place on it when `hash` is given (the detail line's
 * next step, batch 4: "#income", "#request-<id>").
 */
export function HouseholdLink({
  row,
  links,
  className,
  hash,
  children,
}: {
  row: ApiAidGridRow
  links: HouseholdLinks
  className: string
  hash?: string | undefined
  children: ReactNode
}) {
  const href = hash === undefined ? links.href(row) : `${links.href(row)}#${hash}`
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Opening the family is not a click on the row: no highlight, so no save-then-move (ruling B).
    // Before the modifier check, so a modified click does not bubble to the row either.
    event.stopPropagation()
    // A modified click opens a new tab, as any link does (Decision 1).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    links.open(row, href)
  }
  return (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  )
}
