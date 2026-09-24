/**
 * The slide-in panel's row grammar (kindred#2759), extracted from
 * `ShareRequestPanel` so the adult Jotform section composes the SAME rows
 * instead of re-creating them: a 22px icon chip, a bold 13.5px label, an
 * optional uppercase provenance tag, and an indented italic paragraph under
 * it. Output is byte-identical to what `ShareRequestPanel` drew inline
 * (pinned by `ShareRequestPanel.golden.test.tsx`).
 *
 * `NoteRow`'s fold state is the CALLER's, never keyed here: the family panel
 * keys it on CampMinder `source_field`s, the adult panel on its own rows.
 */
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { CAP_CLASSES, clusterCap } from './shareMarks'

/** 22px icon-chip frame (mockup `.mkic`). No rounding: callers supply `CAP_CLASSES`. */
export const ROW_ICON_FRAME =
  'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center'
/** 13px glyph inside every chip (mockup `.mkic svg`). */
export const MARK_ICON = 'h-[13px] w-[13px]'
/** The muted, always-solo note chip's tone. */
export const NOTE_CHIP_CLASS = 'rounded-full bg-muted text-muted-foreground'
export const NOTE_ICON_FRAME = `${ROW_ICON_FRAME} ${NOTE_CHIP_CLASS}`
/** Every text under a row (mockup `.mksay`). See ShareRequestPanel's history for `break-words`. */
export const MK_SAY =
  'text-foreground pl-[30px] text-[13px] italic whitespace-pre-wrap break-words opacity-[.85]'
/** The small uppercase provenance tag (mockup `.who`). */
export const WHO_TAG = 'text-muted-foreground text-[9.5px] tracking-[.07em] uppercase opacity-75'
/** A muted caption line under a row's text ("Changed · Aug 7 → Sep 8"). */
export const ROW_CAPTION = 'text-muted-foreground pl-[30px] text-[11px] tabular-nums'

export function RowText({ text, testId = 'request-entry' }: { text: string; testId?: string }) {
  return (
    <p data-testid={testId} className={MK_SAY}>
      {text}
    </p>
  )
}

export function ProvenanceTag({
  children,
  hidden = false,
}: {
  children: ReactNode
  hidden?: boolean
}) {
  return (
    <span className={WHO_TAG} aria-hidden={hidden ? 'true' : undefined}>
      {children}
    </span>
  )
}

export function RowChip({
  Icon,
  className,
  testId,
}: {
  Icon: LucideIcon
  className: string
  testId?: string | undefined
}) {
  return (
    <span data-testid={testId} className={`${ROW_ICON_FRAME} ${className}`}>
      <Icon className={MARK_ICON} />
    </span>
  )
}

export interface CapsuleChip {
  readonly key: string
  readonly Icon: LucideIcon
  readonly className: string
  readonly testId?: string | undefined
}

export function ChipCapsule({ chips }: { chips: readonly CapsuleChip[] }) {
  return (
    <div className="flex items-center">
      {chips.map((chip, index) => (
        <RowChip
          key={chip.key}
          Icon={chip.Icon}
          testId={chip.testId}
          className={`${chip.className} ${CAP_CLASSES[clusterCap(index, chips.length)]}`}
        />
      ))}
    </div>
  )
}

/** A choice row: chip + label, no text underneath (the family radio row). */
export function ChoiceRow({
  chip,
  label,
  tag,
}: {
  chip: ReactNode
  label: string
  tag?: string | undefined
}) {
  return (
    <li className="flex flex-col gap-[3px]">
      <div className="flex items-center gap-1.5 text-[13.5px]">
        {chip}
        <span className="ml-0.5 font-semibold">{label}</span>
        {tag !== undefined && <ProvenanceTag>{tag}</ProvenanceTag>}
      </div>
    </li>
  )
}

/**
 * A note row: the WHOLE ROW is the fold button (mockup `.mk.note .mkbtn`).
 * `aria-expanded` is the fold handle tests assert on, not a11y scaffolding —
 * see ShareRequestPanel's own note. The tag is `aria-hidden` so a query by the
 * exact label text still finds the button.
 */
export function NoteRow({
  chip,
  label,
  tag,
  expanded,
  onToggle,
  rowProps,
  children,
}: {
  chip: ReactNode
  label: string
  tag?: string | undefined
  expanded: boolean
  onToggle: () => void
  rowProps?: Readonly<Record<`data-${string}`, string>> | undefined
  children: ReactNode
}) {
  return (
    <li {...rowProps} className="flex flex-col gap-[3px]">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-left text-[13.5px] transition-colors"
      >
        {chip}
        <span className="ml-0.5 font-semibold">{label}</span>
        {tag !== undefined && <ProvenanceTag hidden>{tag}</ProvenanceTag>}
        <ChevronRight
          className={`ml-auto h-3 w-3 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && children}
    </li>
  )
}
