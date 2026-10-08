import type { MouseEvent, ReactNode } from 'react'

import type { ApiAidGridRow } from '../../../types/api-types'

/** How a row reaches its household page (slice 1 Decision 1): the link, and the surface's way to go there. */
export interface HouseholdLinks {
  readonly href: (row: ApiAidGridRow) => string
  readonly open: (row: ApiAidGridRow, href: string) => void
  /**
   * Money › To place for the row's family (owner ruling C, 10-06), opened the same way as the
   * household page (`open`: what is typed is saved first, and Back lands on the row). Without it,
   * the "Place It in Money › To Place ›" step draws nothing.
   */
  readonly toPlace?: ((row: ApiAidGridRow) => string) | undefined
}

/**
 * A link to the row's household page, at a place on it when `hash` is given (the detail line's
 * next step, batch 4: "#income", "#request-<id>"), or to another page for the row (`to`: To place,
 * ruling C), opened the same way.
 */
export function HouseholdLink({
  row,
  links,
  className,
  hash,
  to,
  children,
}: {
  row: ApiAidGridRow
  links: HouseholdLinks
  className: string
  hash?: string | undefined
  to?: string | undefined
  children: ReactNode
}) {
  const page = to ?? links.href(row)
  const href = hash === undefined ? page : `${page}#${hash}`
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
