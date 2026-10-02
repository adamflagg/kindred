import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { RequestViewNav } from './RequestViewNav'
import type { RequestLens } from './strip'
import type { RequestView, RequestViewKey, ViewCount } from './views'

const count = (requests: number): ViewCount => ({ families: requests, requests })

const COUNTS: ReadonlyMap<RequestViewKey, ViewCount> = new Map<RequestViewKey, ViewCount>([
  ['all', count(9)],
  ['pending_approval', count(3)],
  ['needs_offer', count(14)],
  ['not_reconciled', count(0)],
  ['waiting_on_family', count(5)],
  ['holds', count(2)],
  ['duplicates', count(0)],
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

  it('puts the exception badges on the right: Holds, Duplicates, Session not settled, To reverse, Cancelled: give a reason', () => {
    strip()
    expect(names(screen.getByTestId('strip-exceptions'))).toEqual([
      'Holds 2',
      'Duplicates 0',
      'Session not settled 1',
      'To reverse 4',
      'Cancelled: give a reason 1',
    ])
    expect(link('To reverse')).toHaveAttribute('href', '/s/to-reverse')
    expect(link('Cancelled: give a reason')).toHaveAttribute('href', '/s/cancel-reason')
  })

  it('reads "—" for a count it does not have (a past date counts only All, Decision 11)', () => {
    strip({ counts: new Map([['all', count(9)]]), lensCounts: new Map([['all', count(9)]]) })
    expect(link('Holds')).toHaveTextContent('Holds —')
    expect(link('Appeals')).toHaveTextContent('Appeals —')
    expect(link('All')).toHaveTextContent('All 9')
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

  // RULED D-a, revised to option (3): the fifth badge shows only when non-zero, or while picked,
  // so it appears exactly when Today's Open › can link to it. Full label, red like the others.
  it('shows Cancelled: give a reason, red, when its count is non-zero', () => {
    strip()
    expect(link('Cancelled: give a reason').className).toContain('bg-red-100')
    expect(link('Cancelled: give a reason')).not.toHaveAttribute('data-state')
  })

  it('hides Cancelled: give a reason at 0, and while its count is unknown (a past date)', () => {
    const { unmount } = strip({ counts: new Map([...COUNTS, ['cancel_reason', count(0)]]) })
    expect(screen.queryByRole('link', { name: /^Cancelled: give a reason/ })).toBeNull()
    expect(names(screen.getByTestId('strip-exceptions'))).toHaveLength(4)
    unmount()
    strip({ counts: new Map([['all', count(9)]]) })
    expect(screen.queryByRole('link', { name: /^Cancelled: give a reason/ })).toBeNull()
  })

  it('keeps Cancelled: give a reason while it is the picked stage, muted at 0', () => {
    strip({ counts: new Map([...COUNTS, ['cancel_reason', count(0)]]), stage: 'cancel_reason' })
    expect(link('Cancelled: give a reason')).toHaveAttribute('data-state', 'on')
    expect(link('Cancelled: give a reason').className).not.toContain('bg-red-100')
  })

  it('says under the strip how to read it, verbatim, and that only appeals show under that lens', () => {
    const { unmount } = strip()
    const legend =
      'Stages run left to right per round · badges block a request at any stage · the lens on the left narrows every count.'
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
    expect(link('Session not settled').className).toContain('bg-amber-100')
    expect(link('Duplicates').className).not.toContain('bg-red-100')
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
