import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SortableColumnHeader } from './SortableColumnHeader'

/** `<th>` requires a `<table><thead><tr>` ancestor for its `columnheader` role
 *  to resolve the way real browsers and testing-library agree on. */
function renderInTable(ui: React.ReactElement) {
  return render(
    <table>
      <thead>
        <tr>{ui}</tr>
      </thead>
    </table>
  )
}

describe('SortableColumnHeader', () => {
  it('renders a real button', () => {
    renderInTable(<SortableColumnHeader label="Sleeps" direction={null} onSort={() => {}} />)
    expect(screen.getByRole('button', { name: 'Sleeps' })).toBeInTheDocument()
  })

  it('omits aria-sort entirely on an inactive column', () => {
    renderInTable(<SortableColumnHeader label="Sleeps" direction={null} onSort={() => {}} />)
    expect(screen.getByRole('columnheader')).not.toHaveAttribute('aria-sort')
  })

  it('sets aria-sort="ascending" when active ascending', () => {
    renderInTable(<SortableColumnHeader label="Sleeps" direction="ascending" onSort={() => {}} />)
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sets aria-sort="descending" when active descending', () => {
    renderInTable(<SortableColumnHeader label="Sleeps" direction="descending" onSort={() => {}} />)
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending')
  })

  it('puts aria-sort on the cell, not the button', () => {
    renderInTable(<SortableColumnHeader label="Sleeps" direction="ascending" onSort={() => {}} />)
    expect(screen.getByRole('button', { name: 'Sleeps' })).not.toHaveAttribute('aria-sort')
  })

  it('fires onSort once on click', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn()
    renderInTable(<SortableColumnHeader label="Sleeps" direction={null} onSort={onSort} />)
    await user.click(screen.getByRole('button', { name: 'Sleeps' }))
    expect(onSort).toHaveBeenCalledTimes(1)
  })

  it('fires onSort on Enter', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn()
    renderInTable(<SortableColumnHeader label="Sleeps" direction={null} onSort={onSort} />)
    screen.getByRole('button', { name: 'Sleeps' }).focus()
    await user.keyboard('{Enter}')
    expect(onSort).toHaveBeenCalledTimes(1)
  })

  it('fires onSort on Space', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn()
    renderInTable(<SortableColumnHeader label="Sleeps" direction={null} onSort={onSort} />)
    screen.getByRole('button', { name: 'Sleeps' }).focus()
    await user.keyboard(' ')
    expect(onSort).toHaveBeenCalledTimes(1)
  })

  it('excludes the indicator from the accessible name', () => {
    renderInTable(<SortableColumnHeader label="Sleeps" direction="ascending" onSort={() => {}} />)
    // Exact string match proves the arrow is aria-hidden, not appended to the name.
    expect(screen.getByRole('button', { name: 'Sleeps' })).toBeInTheDocument()
  })

  it('renders as a div when as="div", still containing the button', () => {
    render(<SortableColumnHeader as="div" label="Camper" direction={null} onSort={() => {}} />)
    const header = screen.getByRole('columnheader')
    expect(header.tagName).toBe('DIV')
    expect(screen.getByRole('button', { name: 'Camper' })).toBeInTheDocument()
  })

  it('renders a custom indicator, aria-hidden, without affecting the accessible name', () => {
    renderInTable(
      <SortableColumnHeader
        label="Status"
        direction={null}
        onSort={() => {}}
        indicator={<span data-testid="ind">X</span>}
      />
    )
    expect(screen.getByTestId('ind')).toBeInTheDocument()
    expect(screen.getByTestId('ind').parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument()
  })
})
