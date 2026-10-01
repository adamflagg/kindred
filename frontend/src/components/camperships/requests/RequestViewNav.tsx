import type { MouseEvent } from 'react'
import { Link } from 'react-router'

import { TAB_NAV, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from '../../admin/lodging/lodgingStyles'
import { countWords, type RequestView, type RequestViewKey, type ViewCount } from './views'

/**
 * The views as links, each with its count of families · requests (§6.2), in SessionTabs' pill grammar.
 * `onOpen` lets the page save what is typed first (Decision 4; PR 3 passes it); a modified click
 * still opens a new tab.
 */
export function RequestViewNav({
  views,
  current,
  counts,
  hrefOf,
  onOpen,
}: {
  views: readonly RequestView[]
  current: RequestViewKey
  counts: ReadonlyMap<RequestViewKey, ViewCount> | null
  hrefOf: (view: RequestView) => string
  onOpen?: ((href: string) => void) | undefined
}) {
  const open = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (onOpen === undefined || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    onOpen(href)
  }
  return (
    <nav className={`${TAB_NAV} flex flex-wrap gap-1`}>
      {views.map((view) => {
        const href = hrefOf(view)
        return (
          <Link
            key={view.key}
            to={href}
            onClick={open(href)}
            className={view.key === current ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
          >
            {view.label}{' '}
            <span className="text-xs tabular-nums opacity-80">
              {countWords(counts?.get(view.key) ?? null)}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
