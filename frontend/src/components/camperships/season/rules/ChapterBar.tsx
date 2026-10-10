import type { ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidRulesDraft } from '../../../../types/api-types'
import { CS_BADGE_AMBER } from '../../kit/csType'
import { CHAPTERS, chapterMarks } from './rulesLayout'

// final mock season-rules.html (.cf-chapstrip / .cf-chip): a 26px strip of 20px chips at 12px. Local classes, not the
// Requests strip's tokens (CS_STRIP is 34px with 24px lenses and 26px stage chevrons).
const STRIP =
  'border-border flex h-[26px] shrink-0 items-center gap-0.5 rounded-[9px] border bg-[color-mix(in_oklab,var(--color-muted)_55%,transparent)] p-0.5 whitespace-nowrap'
const CHIP =
  'inline-flex h-5 items-center gap-1 rounded-md px-2 text-xs leading-4 whitespace-nowrap no-underline'
const CHIP_IDLE = `${CHIP} text-muted-foreground hover:text-foreground font-medium`
const CHIP_ON = `${CHIP} bg-primary text-primary-foreground font-semibold`
const GROUP_LABEL = 'text-muted-foreground px-[5px] text-[11.5px] font-bold whitespace-nowrap'

/**
 * The chapter bar (spec §6.2 A; rules-v3 "Fix 1"): sticky, two strips (Awards | Setup) on ONE line, 26px strips of
 * 20px chips in every state. It never wraps: past the width it scrolls sideways with no scrollbar (the mock's `.chapbar`).
 * A chip's marks: an amber dot for a draft section, a count of its issues. `children` (the draft / in-effect switch and
 * Open All / Close All) sit at the line's right end.
 */
export function ChapterBar({
  draft,
  inView,
  budgetHref,
  onJump,
  children,
}: {
  /** The draft read, for the marks; null on the version in effect, a receipt or the registrar's view. */
  draft: ApiAidRulesDraft | null
  inView: number | null
  budgetHref: string
  onJump: (n: number) => void
  children?: ReactNode
}) {
  return (
    <nav
      data-testid="chapter-bar"
      className="bg-background sticky top-0 z-10 flex [scrollbar-width:none] flex-nowrap gap-2.5 overflow-x-auto py-[5px]"
    >
      {(['Awards', 'Setup'] as const).map((group) => (
        <div key={group} data-testid="chapter-strip" className={STRIP}>
          <span className={GROUP_LABEL}>{group}</span>
          {CHAPTERS.filter((c) => c.group === group).map((chapter) => {
            const marks = chapterMarks(chapter, draft)
            return (
              <button
                key={chapter.n}
                type="button"
                className={chapter.n === inView ? CHIP_ON : CHIP_IDLE}
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
                  // .cf-chip .cf-pill: 0 5px, 10.5/14, so a badged chip stays 20px like the rest
                  <span
                    className={`${CS_BADGE_AMBER} !px-[5px] !py-0 !text-[10.5px] !leading-[14px]`}
                  >
                    {marks.issues}
                  </span>
                )}
              </button>
            )
          })}
          {group === 'Setup' && (
            <Link to={budgetHref} className={CHIP_IDLE}>
              Budget ›
            </Link>
          )}
        </div>
      ))}
      {/* It shrinks before the strips do: its sentence truncates, the switch and the folds stay. */}
      {children !== undefined && <div className="ml-auto min-w-0 flex-1">{children}</div>}
    </nav>
  )
}
