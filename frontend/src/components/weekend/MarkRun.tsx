/**
 * Draws one `MarkRunSpec` (kindred#2759) — the markup that used to live
 * inline in `ShareMarks.tsx`, byte for byte (pinned by
 * `ShareMarks.golden.test.tsx`).
 *
 * `VEHICLE`'s `rounded-full` is load-bearing: the halo is a box-shadow on this
 * wrapper and follows its radius, so without it a capsule would wear a
 * rectangular glow. Caps come from each mark's POSITION IN THE LIST, never CSS
 * tree position — `ui/Tooltip` nests each glyph in its own trigger, which
 * defeats `:only-child` (the half-pill trap in `shareMarks.ts`).
 */
import { Tooltip } from '../ui/Tooltip'
import type { MarkRunSpec } from './markSpec'
import { SHARE_GLOW_CLASS } from './shareEmphasis'
import { CAP_CLASSES, clusterCap } from './shareMarks'

/** 20px frame, matching `NeedGlyphMark`'s `GLYPH_BASE` grid. */
export const FRAME = 'flex h-5 w-5 items-center justify-center'
/** The halo/transform vehicle. */
export const VEHICLE = 'inline-flex rounded-full'
/**
 * Not inlined as a plain `' relative'` string: prettier-plugin-tailwindcss
 * fully parses a static string segment's own class list and trims its
 * surrounding whitespace, which silently fuses it onto the segment before it
 * (`rounded-fullrelative`) when there is no space char left to separate them.
 * An interpolated segment survives untouched — the same reason `SHARE_GLOW_CLASS`
 * below is spelled `` ` ${SHARE_GLOW_CLASS}` `` rather than a bare literal.
 */
const RELATIVE = 'relative'
/** The amber "changed" dot on a mark's corner. */
export const CHANGED_DOT_CLASS =
  'ring-background pointer-events-none absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 dark:bg-amber-400'

export function MarkRun({ run }: { run: MarkRunSpec }) {
  if (run.marks.length === 0) return null
  const withDot = run.dotTestId !== undefined
  return (
    <span
      className={`${VEHICLE}${withDot ? ` ${RELATIVE}` : ''}${run.hot ? ` ${SHARE_GLOW_CLASS}` : ''}`}
      data-testid={run.testId}
      data-share-emphasis-motion={run.hot ? '' : undefined}
    >
      {run.marks.map((mark, index) => {
        const Icon = mark.Icon
        return (
          <Tooltip
            key={mark.key}
            content={mark.tooltip}
            aria-label={mark.ariaLabel}
            className={`${FRAME} ${mark.className} ${CAP_CLASSES[clusterCap(index, run.marks.length)]}`}
          >
            <Icon className="h-3 w-3" />
          </Tooltip>
        )
      })}
      {withDot && <span data-testid={run.dotTestId} className={CHANGED_DOT_CLASS} />}
    </span>
  )
}

export function MarkRuns({ runs }: { runs: readonly MarkRunSpec[] }) {
  return (
    <>
      {runs.map((run) => (
        <MarkRun key={run.key} run={run} />
      ))}
    </>
  )
}
