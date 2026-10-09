import type { ReactNode } from 'react'

import { DefRef } from '../kit/DefinitionNotes'
import { Does, Effects, type EffectItem } from '../kit/Effects'
import type { DoesLine, EffectLine, GroupDoes } from './toPlaceModel'
import { GROUP_CARET, GROUP_HEADING, GROUP_HEADING_ROW } from './toPlaceStyles'
import type { NoteMark } from './useToPlaceNotes'

/**
 * A group's heading row (design-language §16, §19; mock `heading`): the heading in bold with its fold
 * caret, a muted count, and (right) the group's own bulk button. `onToggle` makes the heading a fold.
 */
export function GroupHeading({
  title,
  meta,
  folded = false,
  onToggle,
  right,
}: {
  title: string
  meta: ReactNode
  folded?: boolean
  onToggle?: (() => void) | undefined
  right?: ReactNode
}) {
  return (
    <div data-group-heading-row="" className={GROUP_HEADING_ROW}>
      {onToggle === undefined ? (
        <span className={GROUP_HEADING}>{title}</span>
      ) : (
        <button
          type="button"
          className={`${GROUP_HEADING} cursor-pointer`}
          title={`${folded ? 'Show' : 'Hide'} this group`}
          onClick={onToggle}
        >
          <span className={GROUP_CARET}>{folded ? '▸' : '▾'}</span>
          <span>{title}</span>
        </button>
      )}
      <span className="text-muted-foreground text-xs">{meta}</span>
      {right !== undefined && <span className="ml-auto flex items-center gap-2">{right}</span>}
    </div>
  )
}

function doesLine(line: DoesLine, posted: NoteMark | null | undefined): ReactNode {
  return (
    <>
      {line.pre}
      {line.lead !== undefined && <b className="font-bold">{line.lead}</b>}
      {line.text}
      {line.posted === true && posted !== null && posted !== undefined && (
        <DefRef n={posted.n} title={posted.title} />
      )}
      {line.ok === true && ' ✓'}
    </>
  )
}

/** A group's callout: a bold lead, then → and the result, on its own line under a 3px rule (§16). */
export function GroupDoes({
  spec,
  posted,
}: {
  spec: GroupDoes
  posted?: NoteMark | null | undefined
}) {
  return <Does tone={spec.tone} lines={spec.lines.map((line) => doesLine(line, posted))} />
}

/** The effects, one per line, with ✓ ○ ⚠ and the → next step under their words (§16). */
export function EffectList({ lines }: { lines: readonly EffectLine[] }) {
  const items: EffectItem[] = lines.map((l) => ({
    sym: l.sym,
    text: (
      <>
        {l.lead !== undefined && <b className="font-bold">{l.lead}</b>}
        {l.text}
      </>
    ),
    ...(l.then === undefined ? {} : { then: l.then }),
  }))
  return <Effects items={items} />
}
