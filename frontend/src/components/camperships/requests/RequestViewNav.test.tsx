import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STRIP_BADGE_ON } from '../kit/kitStyles'
import { RequestViewNav } from './RequestViewNav'
import { EXCEPTION_BADGES, STRIP_LEGEND, type RequestLens } from './strip'
import { REQUEST_VIEWS, type RequestView, type RequestViewKey, type ViewCount } from './views'

const count = (requests: number): ViewCount => ({ families: requests, requests })

const COUNTS: ReadonlyMap<RequestViewKey, ViewCount> = new Map<RequestViewKey, ViewCount>([
  ['all', count(9)],
  ['pending_approval', count(3)],
  ['needs_offer', count(14)],
  ['not_reconciled', count(0)],
  ['waiting_on_family', count(5)],
  ['holds', count(2)],
  ['duplicates', count(3)],
  ['session_not_settled', count(1)],
  ['to_reverse', count(4)],
  ['appeals', count(6)],
  ['cancel_reason', count(1)],
])
const LENS_COUNTS: ReadonlyMap<RequestLens, ViewCount> = new Map<RequestLens, ViewCount>([
  ['all', count(186)],
  ['appeals', count(24)],
])

function strip(
  props: {
    lens?: RequestLens
    stage?: RequestViewKey | null
    counts?: ReadonlyMap<RequestViewKey, ViewCount> | null
    lensCounts?: ReadonlyMap<RequestLens, ViewCount> | null
    onOpen?: (href: string) => void
  } = {}
) {
  return render(
    <MemoryRouter>
      <RequestViewNav
        lens={props.lens ?? 'all'}
        stage={props.stage ?? null}
        counts={props.counts === undefined ? COUNTS : props.counts}
        lensCounts={props.lensCounts === undefined ? LENS_COUNTS : props.lensCounts}
        hrefOf={(view: RequestView) => `/s/${view.slug}`}
        lensHrefOf={(lens: RequestLens) => `/l/${lens}`}
        onOpen={props.onOpen}
      />
    </MemoryRouter>
  )
}

const link = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name} `) })
const names = (container: HTMLElement) =>
  within(container)
    .getAllByRole('link')
    .map((a) => a.textContent)

describe('RequestViewNav: the views strip (T4; mock v=f, ls=b, po=b, rv=todo)', () => {
  it('draws the lenses on the left, each with its own count, as links', () => {
    strip()
    expect(names(screen.getByTestId('strip-lenses'))).toEqual(['All 186', 'Appeals 24'])
    expect(link('All')).toHaveAttribute('href', '/l/all')
    expect(link('Appeals')).toHaveAttribute('href', '/l/appeals')
  })

  it('runs the pipeline in order (b), each stage a link with its count', () => {
    strip()
    expect(names(screen.getByTestId('strip-pipeline'))).toEqual([
      'Pending approval 3',
      'Needs an offer 14',
      'Not reconciled 0',
      'Waiting on the family 5',
    ])
    expect(link('Needs an offer')).toHaveAttribute('href', '/s/needs-offer')
  })

  it('puts the exception badges on the right: Holds, Duplicates, Session unclear, To reverse, Cancelled: give a reason', () => {
    strip()
    expect(names(screen.getByTestId('strip-exceptions'))).toEqual([
      'Holds 2',
      'Duplicates 3',
      'Session unclear 1',
      'To reverse 4',
      'Cancelled: give a reason 1',
    ])
    expect(link('To reverse')).toHaveAttribute('href', '/s/to-reverse')
    expect(link('Cancelled: give a reason')).toHaveAttribute('href', '/s/cancel-reason')
  })

  // Owner 2026-10-04: a badge it cannot count is not due, so it is not drawn; the picked one reads "—".
  it('reads "—" for a count it does not have (a past date counts only All, Decision 11)', () => {
    const { unmount } = strip({
      counts: new Map([['all', count(9)]]),
      lensCounts: new Map([['all', count(9)]]),
    })
    expect(link('Needs an offer')).toHaveTextContent('Needs an offer —')
    expect(link('Appeals')).toHaveTextContent('Appeals —')
    expect(link('All')).toHaveTextContent('All 9')
    expect(within(screen.getByTestId('strip-exceptions')).queryAllByRole('link')).toEqual([])
    unmount()
    strip({ counts: new Map([['all', count(9)]]), stage: 'holds' })
    expect(link('Holds')).toHaveTextContent('Holds —')
  })

  it('draws no badge while the counts load (no flash of zeros), but keeps the picked one', () => {
    const { unmount } = strip({ counts: null })
    expect(within(screen.getByTestId('strip-exceptions')).queryAllByRole('link')).toEqual([])
    unmount()
    strip({ counts: null, stage: 'to_reverse' })
    expect(names(screen.getByTestId('strip-exceptions'))).toEqual(['To reverse —'])
  })

  it('fills the picked lens when no stage is picked', () => {
    strip({ lens: 'appeals' })
    expect(link('Appeals')).toHaveAttribute('data-state', 'on')
    expect(link('All')).not.toHaveAttribute('data-state')
  })

  it('outlines the lens and fills the stage once one is picked', () => {
    strip({ lens: 'appeals', stage: 'needs_offer' })
    expect(link('Appeals')).toHaveAttribute('data-state', 'lens')
    expect(link('Needs an offer')).toHaveAttribute('data-state', 'on')
    expect(link('Holds')).not.toHaveAttribute('data-state')
  })

  it('marks a picked badge', () => {
    strip({ stage: 'holds' })
    expect(link('Holds')).toHaveAttribute('data-state', 'on')
    expect(link('All')).toHaveAttribute('data-state', 'lens')
  })

  // Owner 2026-10-04 (generalising RULED D-a option 3 from the fifth badge to every badge): a badge
  // shows only when something is in it, or while it is picked. Full label, red unless amber.
  it('shows Cancelled: give a reason, red, when its count is non-zero', () => {
    strip()
    expect(link('Cancelled: give a reason').className).toContain('bg-red-100')
    expect(link('Cancelled: give a reason')).not.toHaveAttribute('data-state')
  })

  const labelOf = (key: RequestViewKey) => REQUEST_VIEWS.find((v) => v.key === key)?.label ?? key
  const badgeLink = (key: RequestViewKey) =>
    screen.queryByRole('link', { name: new RegExp(`^${labelOf(key)} `) })

  it.each(EXCEPTION_BADGES)('hides the %s badge at 0, leaving the others', (key) => {
    strip({ counts: new Map([...COUNTS, [key, count(0)]]) })
    expect(badgeLink(key)).toBeNull()
    expect(names(screen.getByTestId('strip-exceptions'))).toHaveLength(EXCEPTION_BADGES.length - 1)
  })

  it.each(EXCEPTION_BADGES)(
    'keeps the %s badge at 0 while it is the picked stage, muted',
    (key) => {
      strip({ counts: new Map([...COUNTS, [key, count(0)]]), stage: key })
      expect(badgeLink(key)).toHaveAttribute('data-state', 'on')
      expect(badgeLink(key)).toHaveTextContent(`${labelOf(key)} 0`)
      expect(badgeLink(key)?.className).not.toMatch(/bg-(red|amber)-100/)
    }
  )

  it.each(EXCEPTION_BADGES)('shows the %s badge when its count is above 0', (key) => {
    const zero = new Map(EXCEPTION_BADGES.map((k) => [k, count(0)] as const))
    strip({ counts: new Map([...COUNTS, ...zero, [key, count(1)]]) })
    expect(names(screen.getByTestId('strip-exceptions'))).toEqual([`${labelOf(key)} 1`])
  })

  it('keeps normal-width badges with their full labels', () => {
    strip()
    expect(link('Session unclear').className).toContain('px-2')
    expect(link('Session unclear').className).not.toContain('px-[6px]')
  })

  it('says under the strip how to read it, verbatim, and that only appeals show under that lens', () => {
    const { unmount } = strip()
    const legend =
      'Stages run left to right per round · badges block a request at any stage · the lens on the left narrows every count · Session unclear: no one enrolled session matches the request yet.'
    expect(STRIP_LEGEND).toBe(legend)
    expect(screen.getByTestId('strip-legend')).toHaveTextContent(legend, {
      normalizeWhitespace: true,
    })
    expect(screen.queryByText('Showing appeals only.')).toBeNull()
    unmount()
    strip({ lens: 'appeals' })
    expect(screen.getByTestId('strip-legend')).toHaveTextContent(`${legend} Showing appeals only.`)
    expect(screen.getByText('Showing appeals only.').tagName).toBe('B')
  })

  it('keeps to one line: nothing wraps', () => {
    strip()
    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('whitespace-nowrap')
    expect(nav.className).not.toContain('flex-wrap')
  })

  it('tones a to-do count amber and a zero one muted; Waiting on the family is watched, not to do', () => {
    strip()
    expect(within(link('Needs an offer')).getByText('14').className).toContain('bg-amber-100')
    expect(within(link('Not reconciled')).getByText('0').className).not.toContain('bg-amber-100')
    expect(within(link('Waiting on the family')).getByText('5').className).not.toContain(
      'bg-amber-100'
    )
    expect(link('Holds').className).toContain('bg-red-100')
    expect(link('Session unclear').className).toContain('bg-amber-100')
  })

  it('hands a plain click to onOpen, and leaves a modified click to the browser (new tab)', () => {
    const onOpen = vi.fn()
    strip({ onOpen })
    fireEvent.click(link('Holds'))
    expect(onOpen).toHaveBeenCalledWith('/s/holds')
    fireEvent.click(link('Appeals'))
    expect(onOpen).toHaveBeenCalledWith('/l/appeals')
    onOpen.mockClear()
    fireEvent.click(link('Holds'), { metaKey: true })
    expect(onOpen).not.toHaveBeenCalled()
  })
})

/**
 * jsdom has no layout, so the strip's widths are stubbed: the nav's own width, the lenses and the
 * pipeline, and the measuring copy's badges and chip (`data-measure`). Padding, borders and gaps
 * read as 0 here (jsdom computes no Tailwind), which keeps the arithmetic plain: the badges get the
 * nav's width less the lenses (150) and the pipeline (500).
 */
describe('RequestViewNav: the +N overflow chip (owner 2026-10-04)', () => {
  let navWidth = 0
  const observers: Array<() => void> = []

  beforeEach(() => {
    navWidth = 1150
    observers.length = 0
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.tagName === 'NAV' ? navWidth : 0
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const width =
        this.dataset['testid'] === 'strip-lenses'
          ? 150
          : this.dataset['testid'] === 'strip-pipeline'
            ? 500
            : this.dataset['measure'] === 'badge'
              ? 100
              : this.dataset['measure'] === 'chip'
                ? 40
                : 0
      return { x: 0, y: 0, top: 0, left: 0, bottom: 30, right: width, width, height: 30 } as DOMRect
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const shownBadges = () => names(screen.getByTestId('strip-exceptions'))
  const chip = () => screen.queryByRole('button', { name: /^\+\d+$/ })
  const resize = (width: number) => {
    navWidth = width
    act(() => {
      for (const notify of observers) notify()
    })
  }

  it('draws every badge and no chip when they all fit', () => {
    strip()
    expect(shownBadges()).toHaveLength(5)
    expect(chip()).toBeNull()
  })

  it('folds the trailing badges into +N when they do not fit (To reverse before Session unclear)', () => {
    navWidth = 1000 // 350 for badges: three of them (300) and the chip (40)
    strip()
    expect(shownBadges()).toEqual(['Holds 2', 'Duplicates 3', 'Session unclear 1'])
    expect(chip()).toHaveTextContent('+2')
  })

  it('folds again when the strip is resized, and unfolds when it grows back', () => {
    strip()
    expect(chip()).toBeNull()
    resize(900) // 250: two badges and the chip
    expect(shownBadges()).toEqual(['Holds 2', 'Duplicates 3'])
    expect(chip()).toHaveTextContent('+3')
    resize(1150)
    expect(shownBadges()).toHaveLength(5)
    expect(chip()).toBeNull()
  })

  it('opens the folded badges on a click, each with its count and a link into its view', () => {
    navWidth = 1000
    strip()
    expect(screen.queryByTestId('strip-folded')).toBeNull()
    fireEvent.click(chip() as HTMLElement)
    const list = screen.getByTestId('strip-folded')
    expect(names(list)).toEqual(['To reverse 4', 'Cancelled: give a reason 1'])
    expect(within(list).getByRole('link', { name: /^To reverse/ })).toHaveAttribute(
      'href',
      '/s/to-reverse'
    )
    expect(within(list).getByRole('link', { name: /^To reverse/ }).className).toContain(
      'bg-red-100'
    )
  })

  it('does not open on hover', () => {
    navWidth = 1000
    strip()
    fireEvent.mouseEnter(chip() as HTMLElement)
    fireEvent.mouseOver(chip() as HTMLElement)
    expect(screen.queryByTestId('strip-folded')).toBeNull()
  })

  it('closes the list on Escape, on a click outside it, and on a second click of the chip', () => {
    navWidth = 1000
    strip()
    fireEvent.click(chip() as HTMLElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('strip-folded')).toBeNull()
    fireEvent.click(chip() as HTMLElement)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('strip-folded')).toBeNull()
    fireEvent.click(chip() as HTMLElement)
    fireEvent.mouseDown(chip() as HTMLElement)
    fireEvent.click(chip() as HTMLElement)
    expect(screen.queryByTestId('strip-folded')).toBeNull()
  })

  it('opens a folded view through onOpen like any badge, and closes the list', () => {
    const onOpen = vi.fn()
    navWidth = 1000
    strip({ onOpen })
    fireEvent.click(chip() as HTMLElement)
    const list = screen.getByTestId('strip-folded')
    fireEvent.click(within(list).getByRole('link', { name: /^Cancelled: give a reason/ }))
    expect(onOpen).toHaveBeenCalledWith('/s/cancel-reason')
    expect(screen.queryByTestId('strip-folded')).toBeNull()
  })

  it('rings the chip when the picked stage is among the folded badges, and rings it in the list', () => {
    navWidth = 1000
    strip({ stage: 'to_reverse' })
    expect(chip()).toHaveAttribute('data-state', 'on')
    expect(chip()?.className).toContain(STRIP_BADGE_ON)
    fireEvent.click(chip() as HTMLElement)
    expect(
      within(screen.getByTestId('strip-folded')).getByRole('link', { name: /^To reverse/ })
    ).toHaveAttribute('data-state', 'on')
  })

  it('leaves the chip unringed when the picked stage is still on the line', () => {
    navWidth = 1000
    strip({ stage: 'holds' })
    expect(chip()).not.toHaveAttribute('data-state')
    expect(chip()?.className).not.toContain(STRIP_BADGE_ON)
  })

  it('tones the chip red when a folded red badge has requests', () => {
    navWidth = 1000
    strip()
    expect(chip()?.className).toContain('bg-red-100')
  })

  it('tones the chip amber when only an amber badge is folded', () => {
    navWidth = 900 // three badges shown: two fit beside the chip, Session unclear folds
    strip({
      counts: new Map([...COUNTS, ['to_reverse', count(0)], ['cancel_reason', count(0)]]),
    })
    expect(shownBadges()).toEqual(['Holds 2', 'Duplicates 3'])
    expect(chip()).toHaveTextContent('+1')
    expect(chip()?.className).toContain('bg-amber-100')
  })

  it('tones the chip muted when the only folded badge is a picked one at 0', () => {
    navWidth = 1000
    strip({
      counts: new Map([...COUNTS, ['to_reverse', count(0)], ['cancel_reason', count(0)]]),
      stage: 'cancel_reason',
    })
    // Holds, Duplicates, Session unclear, Cancelled (picked, 0): Cancelled folds alone.
    expect(chip()).toHaveTextContent('+1')
    expect(chip()?.className).not.toMatch(/bg-(red|amber)-100/)
  })

  it('does not fold before the strip has a width (jsdom, or a hidden strip)', () => {
    navWidth = 0
    strip()
    expect(shownBadges()).toHaveLength(5)
    expect(chip()).toBeNull()
  })
})
