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

describe('FloatingQueueBadge — whitespace-only filter', () => {
  // A whitespace-only term reads as "no filter" everywhere it is judged.
  // Four sites in the shell branch on the search term, and they must agree:
  // the filter predicate, the ESC handler, the header count, and the
  // empty-state message. Fixing only one leaves the others disagreeing with
  // what's on screen, which is worse than the original bug.

  it('does not filter the list on a whitespace-only term', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), '   ')
    expect(screen.getAllByTestId('row')).toHaveLength(3)
  })

  it('shows the plain count, not a filtered count, on a whitespace-only term', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), '   ')
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText('3/3')).not.toBeInTheDocument()
    expect(screen.queryByText('0/3')).not.toBeInTheDocument()
  })

  it('closes on the first ESC when the term is whitespace-only, same as if it were empty', async () => {
    // There's no active filter to clear, so the first press should behave
    // like the "already empty" case in the ESC test above and close
    // immediately rather than spending a press clearing an inert space.
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), '   ')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('row')).not.toBeInTheDocument()
  })

  it('quotes the trimmed term in the empty-state message, not the padded raw input', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), '  zzz  ')
    const message = screen.getByText(/No families match/)
    expect(message.textContent).toBe('No families match "zzz"')
  })

  it('still shows the inline clear button on a whitespace-only term — there is text to clear, even though it is not filtering', async () => {
    // Deliberately NOT one of the four coupled sites: this button answers
    // "is there literal text in the box to clear", not "is a filter active",
    // so it stays keyed to the raw (untrimmed) search term.
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), '   ')
    expect(screen.getByTitle('Clear')).toBeInTheDocument()
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

/**
 * The caller-owned filter seam (kindred#2480). Summer passes none of these and
 * must be unaffected — need-based filtering is a weekend concept, and baking
 * it into the shell would put dead controls on the camper queue.
 */
describe('the optional filter seam', () => {
  const rows = ['Alvarez', 'Bennett', 'Castillo']
  function shell(extra: Record<string, unknown> = {}) {
    return (
      <FloatingQueueBadge<string>
        items={rows}
        sortKey={(i) => [i]}
        getSearchText={(i) => i}
        renderList={(visible) => (
          <ul>
            {visible.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        label="Unplaced"
        noun="parties"
        cardSelector="[data-row]"
        emptyState={<p>nothing queued</p>}
        isExpanded={true}
        onToggle={() => {}}
        onClose={() => {}}
        {...extra}
      />
    )
  }

  it('renders no filter row and filters nothing when the props are omitted', () => {
    render(shell())
    expect(screen.getByText('Alvarez')).toBeInTheDocument()
    expect(screen.getByText('Castillo')).toBeInTheDocument()
    expect(screen.queryByTestId('row')).not.toBeInTheDocument()
  })

  it('applies itemFilter and the name search together', async () => {
    render(
      shell({
        itemFilter: (i: string) => i !== 'Castillo',
        filterRow: <div data-testid="row">chips</div>,
      })
    )
    expect(screen.getByTestId('row')).toBeInTheDocument()
    expect(screen.queryByText('Castillo')).not.toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'Alv')
    expect(screen.getByText('Alvarez')).toBeInTheDocument()
    expect(screen.queryByText('Bennett')).not.toBeInTheDocument()
  })

  it('shows filterEmptyState when the predicate empties the list, but the SEARCH miss still wins', async () => {
    // Two different dead ends. A name-search miss names the term; a filter
    // miss names the group. Whichever the staff member just did is the one
    // that should explain itself.
    render(
      shell({
        itemFilter: () => false,
        filterEmptyState: <p>no parties in that group</p>,
      })
    )
    expect(screen.getByText('no parties in that group')).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'zzz')
    expect(screen.getByText(/No parties match "zzz"/)).toBeInTheDocument()
    expect(screen.queryByText('no parties in that group')).not.toBeInTheDocument()
  })

  it('counts N/M in the header while a group filter is active, with no search term', () => {
    render(shell({ itemFilter: (i: string) => i === 'Alvarez' }))
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })
})
