import type { ReactNode } from 'react'

import { CS_CARD, CS_CARD_TITLE, CS_LINK_SM, CS_PILL } from '../../kit/csType'
import type { ChapterDef, SummaryPill } from './rulesLayout'

/** A chapter card is the kit's .cf-chap: CS_CARD with 9px top and bottom padding (ux3 chrome-7). */
const CHAPTER_CARD = CS_CARD.replace('py-3', 'py-[9px]')

/** A chapter (spec §6.2 C): one card of section cards; folded, its summary pills. */
export function Chapter({
  chapter,
  open,
  summary,
  onToggle,
  onJumpGrid,
  children,
}: {
  chapter: ChapterDef
  open: boolean
  summary: readonly SummaryPill[]
  onToggle: () => void
  onJumpGrid?: (() => void) | undefined
  children: ReactNode
}) {
  return (
    <section
      id={`chap-${String(chapter.n)}`}
      data-chapter={chapter.n}
      className={`${CHAPTER_CARD} scroll-mt-[56px]`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <button type="button" className={CS_CARD_TITLE} onClick={onToggle}>
          {open ? '▾ ' : '▸ '}
          <span className="text-muted-foreground mr-1">{chapter.n}</span>
          {chapter.title}
        </button>
        {chapter.key === 'awards' && onJumpGrid !== undefined && (
          <button type="button" className={`${CS_LINK_SM}`} onClick={onJumpGrid}>
            Round 1 % by tier: in the tier grid ›
          </button>
        )}
        {!open && (
          <span className="flex flex-wrap gap-1">
            {summary.map((pill) => (
              <span key={pill.text} className={CS_PILL[pill.tone]}>
                {pill.text}
              </span>
            ))}
          </span>
        )}
      </div>
      {open && <div className="mt-2 space-y-3">{children}</div>}
    </section>
  )
}
