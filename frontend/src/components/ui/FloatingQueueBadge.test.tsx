/**
 * The shared corner queue. Summer's unassigned campers and the weekend's
 * unplaced families are the same interaction over different rows, so the
 * chrome lives here once and the two programs cannot drift apart.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FloatingQueueBadge } from './FloatingQueueBadge'

interface Row {
  first: string
  last: string
}

const ROWS: Row[] = [
  { first: 'Olivia', last: 'Johnson' },
  { first: 'Emma', last: 'Chen' },
  { first: 'Liam', last: 'Garcia' },
]

const sortKey = (row: Row) => [row.last, row.first]
const getSearchText = (row: Row) => `${row.first} ${row.last}`

function Harness({
  items = ROWS,
  isPanelOpen = false,
  isDropTarget = false,
  footer,
  dropRef,
}: {
  items?: Row[]
  isPanelOpen?: boolean
  isDropTarget?: boolean
  footer?: ReactNode
  dropRef?: ((node: HTMLElement | null) => void) | undefined
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  return (
    <FloatingQueueBadge
      items={items}
      sortKey={sortKey}
      getSearchText={getSearchText}
      renderList={(visible) => (
        <ul>
          {visible.map((row) => (
            <li key={`${row.first}-${row.last}`} data-testid="row">
              {row.first} {row.last}
            </li>
          ))}
        </ul>
      )}
      label="Unplaced"
      noun="families"
      cardSelector="[data-family-card]"
      emptyState={<p>Everyone has a cabin.</p>}
      footer={footer}
      isExpanded={isExpanded}
      onToggle={() => {
        setIsExpanded((open) => !open)
      }}
      onClose={() => {
        setIsExpanded(false)
      }}
      isPanelOpen={isPanelOpen}
      isDropTarget={isDropTarget}
      {...(dropRef ? { dropRef } : {})}
    />
  )
}

describe('FloatingQueueBadge — collapsed', () => {
  it('shows the count', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: /3 unplaced families/i })).toHaveTextContent('3')
  })

  it('caps the count at 99+', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      first: 'Emma',
      last: `Chen${String(i)}`,
    }))
    render(<Harness items={many} />)
    expect(screen.getByRole('button', { name: /120 unplaced families/i })).toHaveTextContent('99+')
  })

  it('shows no count at all when the queue is empty', () => {
    render(<Harness items={[]} />)
    expect(screen.getByRole('button', { name: /0 unplaced families/i })).not.toHaveTextContent('0')
  })
})

describe('FloatingQueueBadge — expanded', () => {
  it('sorts by the first key token', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    expect(screen.getAllByTestId('row').map((el) => el.textContent)).toEqual([
      'Emma Chen',
      'Liam Garcia',
      'Olivia Johnson',
    ])
  })

  it('breaks a tie on the second key token', async () => {
    render(
      <Harness
        items={[
          { first: 'Olivia', last: 'Chen' },
          { first: 'Emma', last: 'Chen' },
        ]}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    expect(screen.getAllByTestId('row').map((el) => el.textContent)).toEqual([
      'Emma Chen',
      'Olivia Chen',
    ])
  })

  it('filters on the search text and reports m/n', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'garcia')
    expect(screen.getAllByTestId('row')).toHaveLength(1)
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('names the noun when nothing matches', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'zzz')
    expect(screen.getByText(/no families match "zzz"/i)).toBeInTheDocument()
  })

  it('renders the empty state rather than the search box when the queue is empty', async () => {
    render(<Harness items={[]} />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    expect(screen.getByText('Everyone has a cabin.')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/filter by name/i)).not.toBeInTheDocument()
  })

  it('clears the search on the first ESC and closes on the second', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'garcia')

    await userEvent.keyboard('{Escape}')
    expect(screen.getAllByTestId('row')).toHaveLength(3)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('row')).not.toBeInTheDocument()
  })

  it('closes on a click outside', async () => {
    render(
      <>
        <button type="button">elsewhere</button>
        <Harness />
      </>
    )
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByTestId('row')).not.toBeInTheDocument()
  })

  it('stays open on a click outside while a details panel is open', async () => {
    // The panel was opened FROM this list. Closing the list out from under the
    // click that opened the panel is what the shift exists to avoid.
    render(
      <>
        <button type="button">elsewhere</button>
        <Harness isPanelOpen={true} />
      </>
    )
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.getAllByTestId('row')).toHaveLength(3)
  })

  it('stays open when a card OUTSIDE the popover is clicked', async () => {
    // `cardSelector` is what this branch is for, and the "click a row" path
    // cannot reach it: a row sits inside `popoverRef`, so the containment
    // check returns first and the selector is never consulted. The case that
    // needs it is a card on the surface BEHIND the queue — clicked to open
    // something, which is not a reason to dismiss the list.
    render(
      <>
        <button type="button" data-family-card>
          a card on the board
        </button>
        <Harness />
      </>
    )
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.click(screen.getByRole('button', { name: 'a card on the board' }))
    expect(screen.getAllByTestId('row')).toHaveLength(3)
  })
})

describe('FloatingQueueBadge — drop target', () => {
  // Two separate class decisions off one prop: the popover's border and the
  // list's tint. C2's drag phase builds on both.
  it('outlines the popover and tints the list', async () => {
    const { container } = render(<Harness isDropTarget={true} />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    expect(container.querySelector('.card-lodge')).toHaveClass('border-primary')
    expect(container.querySelector('.overflow-y-auto')).toHaveClass('bg-primary/5')
  })

  it('leaves both plain when nothing is being dragged', async () => {
    const { container } = render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    const popover = container.querySelector('.card-lodge')
    expect(popover).toHaveClass('border-border')
    expect(popover).not.toHaveClass('border-primary')
    expect(container.querySelector('.overflow-y-auto')).not.toHaveClass('bg-primary/5')
  })
})

describe('FloatingQueueBadge — footer', () => {
  // `items.length > 0 && footer !== undefined` is two gates, and the count one
  // is the non-obvious half: the footer disappears when the queue drains, so
  // "Drag campers to bunks to assign" is not offered under "All campers
  // assigned!". Summer passes a footer in production (`FOOTER`,
  // `FloatingUnassignedBadge.tsx`), so this branch is live, not decorative.
  const TIP = <p>Drag campers to bunks to assign</p>

  it('renders the footer while the queue has anyone in it', async () => {
    render(<Harness footer={TIP} />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    expect(screen.getByText('Drag campers to bunks to assign')).toBeInTheDocument()
  })

  it('drops the footer once the queue is empty', async () => {
    render(<Harness items={[]} footer={TIP} />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    expect(screen.getByText('Everyone has a cabin.')).toBeInTheDocument()
    expect(screen.queryByText('Drag campers to bunks to assign')).not.toBeInTheDocument()
  })

  it('omits the footer region entirely when no footer is supplied', async () => {
    // The weekend's adapter passes none. Without the `!== undefined` half,
    // an empty bordered strip would sit under every weekend queue.
    const { container } = render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    expect(container.querySelector('.bg-accent\\/10')).not.toBeInTheDocument()
  })
})

describe('FloatingQueueBadge — placement', () => {
  it('shifts out from under an open details panel', () => {
    const { container } = render(<Harness isPanelOpen={true} />)
    const badge = container.querySelector('[data-floating-badge]')
    expect(badge).toHaveStyle({ transform: 'translateX(-28.5rem)' })
  })

  it('sits still when no panel is open', () => {
    const { container } = render(<Harness />)
    const badge = container.querySelector('[data-floating-badge]')
    expect(badge).toHaveStyle({ transform: 'none' })
  })
})

describe('FloatingQueueBadge — the drop target', () => {
  // THE BUG THIS PINS. The droppable ref used to be attached to the LIST,
  // which only renders inside `{isExpanded && …}`. A collapsed badge therefore
  // had no droppable node at all, so dragging a camper or a family onto it did
  // nothing — and collapsed is the default state. The queue is where you drag
  // someone to unassign or unplace them, so that is the whole interaction
  // silently missing until you happen to open the popover first.
  it('is a drop target while collapsed', () => {
    const dropRef = vi.fn()
    render(<Harness dropRef={dropRef} />)
    const attached = dropRef.mock.calls.map((call) => call[0] as HTMLElement | null).filter(Boolean)
    expect(attached.length).toBeGreaterThan(0)
  })

  it('is still a drop target once expanded', async () => {
    const dropRef = vi.fn()
    render(<Harness dropRef={dropRef} />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    const attached = dropRef.mock.calls.map((call) => call[0] as HTMLElement | null).filter(Boolean)
    expect(attached.length).toBeGreaterThan(0)
  })
})
