import { Link } from 'react-router'

import type { ApiAidRulesDraft } from '../../../../types/api-types'
import { CS_BADGE_AMBER, CS_CHIP, CS_CHIP_ON, CS_META, CS_STRIP } from '../../kit/csType'
import { CHAPTERS, chapterMarks } from './rulesLayout'

/**
 * The chapter bar (spec §6.2 A; rules-v3 "Fix 1"): sticky, two strips (Awards | Setup) on ONE line, 50px tall at 1440
 * and 1100 in every state. It never wraps: past the width it scrolls sideways with no scrollbar (the mock's `.chapbar`).
 * A chip's marks: an amber dot for a draft section, a count of its issues.
 */
export function ChapterBar({
  draft,
  inView,
  budgetHref,
  onJump,
}: {
  /** The draft read, for the marks; null on the version in effect, a receipt or the registrar's view. */
  draft: ApiAidRulesDraft | null
  inView: number | null
  budgetHref: string
  onJump: (n: number) => void
}) {
  return (
    <nav
      data-testid="chapter-bar"
      className="bg-background sticky top-0 z-10 flex [scrollbar-width:none] flex-nowrap gap-2.5 overflow-x-auto py-1.5"
    >
      {(['Awards', 'Setup'] as const).map((group) => (
        <div key={group} data-testid="chapter-strip" className={`${CS_STRIP} shrink-0`}>
          <span className={`${CS_META} px-1 font-bold`}>{group}</span>
          {CHAPTERS.filter((c) => c.group === group).map((chapter) => {
            const marks = chapterMarks(chapter, draft)
            return (
              <button
                key={chapter.n}
                type="button"
                className={chapter.n === inView ? CS_CHIP_ON : CS_CHIP}
                onClick={() => onJump(chapter.n)}
              >
                {chapter.title}
                {marks.draft && (
                  <span
                    data-testid="chip-dot"
                    className="inline-block size-1.5 rounded-full bg-amber-500 dark:bg-amber-400"
                  />
                )}
                {marks.issues > 0 && (
                  // .chapbar .cs-chip .cs-badge: 0 6px, 11.5/16, so a badged chip is 28px like the rest, not 36px
                  <span className={`${CS_BADGE_AMBER} !px-1.5 !py-0 !text-[11.5px] !leading-4`}>
                    {marks.issues}
                  </span>
                )}
              </button>
            )
          })}
          {group === 'Setup' && (
            <Link to={budgetHref} className={CS_CHIP}>
              Budget ›
            </Link>
          )}
        </div>
      ))}
    </nav>
  )
}
