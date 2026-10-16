import { House } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

/** Design-language §6 "Next-up chips never truncate; they drop": a name that would be cut is not shown, and "+N"
 *  counts everyone not shown. */
export interface NameChip {
  readonly key: string
  readonly label: string
  readonly days?: number | null
  readonly late?: boolean
  readonly href?: string
  readonly title: string
}

// eslint-disable-next-line react-refresh/only-export-components -- pure fit function, exported for its unit tests
export function fitChips(
  widths: readonly number[],
  room: number,
  total: number,
  gap = 4,
  reserve = 34
): number {
  let used = 0
  for (let i = 0; i < widths.length; i++) {
    const w = (widths[i] ?? 0) + gap
    const leftAfter = total - (i + 1)
    if (used + w + (leftAfter > 0 ? reserve : 0) > room) return i
    used += w
  }
  return widths.length
}

/** A name chip: 22px, 12px, bordered, in the kit link ink (primary, 500) as the mock's grid links are (ruling V11). */
const CHIP =
  'inline-flex h-[22px] flex-none items-baseline gap-1 whitespace-nowrap rounded-full border border-border bg-card px-2 text-[12px] leading-5 font-medium text-primary hover:border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))]'

/** The box must sit in a definite-width cell (as Today's table column does). Measuring un-hides every chip, which
 *  would grow a shrink-to-fit parent and make the count oscillate. */
export function AidNameChips({
  chips,
  total,
}: {
  readonly chips: readonly NameChip[]
  readonly total: number
}) {
  const box = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(chips.length)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const kids = [...el.querySelectorAll<HTMLElement>('[data-chip]')]
      kids.forEach((k) => {
        k.style.display = ''
      })
      const n = fitChips(
        kids.map((k) => k.getBoundingClientRect().width),
        el.clientWidth,
        total
      )
      // jsdom reports 0 widths and 0 room: treat an unmeasured box as roomy so tests read every chip
      const shownCount = el.clientWidth === 0 ? chips.length : n
      // visibility is owned here, not by a React style prop, so a re-measure that keeps the count still re-hides
      kids.forEach((k, i) => {
        k.style.display = i < shownCount ? '' : 'none'
      })
      setShown(shownCount)
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [chips, total])
  const rest = total - Math.min(shown, chips.length)
  // "+N" names whom it stands for (audit X1): the chips it hid, then how many more the server did not list.
  const hidden = chips.slice(Math.min(shown, chips.length)).map((c) => c.label)
  const beyond = total - chips.length
  const restTitle = [...hidden, beyond > 0 ? `${String(beyond)} more` : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <span ref={box} className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
      {chips.map((c) => {
        const inner = (
          <>
            {c.label}
            {c.days != null ? (
              <span
                className={
                  c.late
                    ? 'font-bold text-amber-700 dark:text-amber-300'
                    : 'text-muted-foreground tabular-nums'
                }
              >
                {String(c.days)}d
              </span>
            ) : null}
          </>
        )
        return c.href ? (
          <Link key={c.key} data-chip to={c.href} title={c.title} className={CHIP}>
            {inner}
          </Link>
        ) : (
          <span key={c.key} data-chip title={c.title} className={CHIP}>
            {inner}
          </span>
        )
      })}
      {rest > 0 ? (
        <span
          data-testid="chips-more"
          className="text-muted-foreground flex-none text-[12px]"
          title={restTitle}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  )
}

/** The dashed chip of a camper with no household (rule 21): the chip's shape, muted, not a link. */
const CHIP_NONE =
  'inline-flex h-[22px] flex-none cursor-help items-baseline whitespace-nowrap rounded-full border border-dashed border-border bg-card px-2 text-[12px] leading-5 font-medium text-muted-foreground'
const NO_HOUSEHOLD_TITLE =
  'CampMinder links this camper to no household, so there is no household page'

/**
 * ONE household chip in a grid cell (design-language rule 21): ⌂ and the household's label, linking to the household.
 * It never drops, unlike AidNameChips' list; it takes at most 45% of the cell, its label cutting with the full label
 * in its title, and the name beside it keeps the rest (AidNameWithChip). With no household
 * (`href` null) it is the dashed "no household" chip, which is not a link.
 */
export function AidHouseholdChip({
  label,
  href,
  title,
}: {
  readonly label?: string | undefined
  readonly href: string | null
  readonly title?: string | undefined
}) {
  if (href === null)
    return (
      <span className={CHIP_NONE} title={title ?? NO_HOUSEHOLD_TITLE}>
        {label ?? 'no household'}
      </span>
    )
  // At most 45% of the cell (owner-approved polish): a long label cuts, the full label in the title; the name beside
  // it keeps the rest.
  return (
    <Link to={href} title={title ?? label} className={`${CHIP} max-w-[45%] min-w-0`}>
      <House className="text-muted-foreground h-[11px] w-[11px] flex-none self-center" />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  )
}

/**
 * A name that cuts beside a chip that never does (rule 21; the mock's CF.nc): the name shrinks with an ellipsis, the
 * chip keeps its width. The cell's title (AidColumn.title) carries the full name.
 */
export function AidNameWithChip({
  name,
  chip,
}: {
  readonly name: ReactNode
  readonly chip: ReactNode
}) {
  return (
    <span className="flex max-w-full min-w-0 items-center gap-[5px]">
      <span className="min-w-0 truncate">{name}</span>
      {chip}
    </span>
  )
}
