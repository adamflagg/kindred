/**
 * The Requests picker (approved final mock reports-statistics.html, "picker form", owner rev 10-09): one
 * white picker holds the two real choices, All requests and Through the R1 deadline, and its last row is
 * the product's own date field. No preset dates. The button reads short so the controls row keeps its
 * room; its title has the full words and the count of later requests left out.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AidRequestSet } from '../../../services/camperships/aidApi'
import { RequestSetPicker } from './RequestSetPicker'

const NOTE = {
  basis: 'date' as const,
  through: '2027-03-10',
  label: 'requests received through Mar 10, 2027',
  left_out: 4,
  unknown: 0,
}

function renderPicker(value: AidRequestSet, note: typeof NOTE | null = null) {
  const onChange = vi.fn<(next: AidRequestSet) => void>()
  render(<RequestSetPicker value={value} note={note} onChange={onChange} />)
  return onChange
}
const button = (name: RegExp | string) => screen.getByRole('button', { name })

describe('RequestSetPicker', () => {
  it('reads short on the button, and says the full words in its title', () => {
    renderPicker({ kind: 'all' })
    expect(button('Requests: All requests')).toHaveAttribute(
      'title',
      'Which requests count: every request'
    )
  })

  it.each<[AidRequestSet, string]>([
    [{ kind: 'deadline' }, 'By the R1 deadline'],
    [{ kind: 'date', date: '2027-03-10' }, 'Through Mar 10'],
  ])('reads %j as "%s"', (value, words) => {
    renderPicker(value)
    expect(button(`Requests: ${words}`)).toBeInTheDocument()
  })

  it('adds how many later requests the set leaves out to the title', () => {
    renderPicker({ kind: 'date', date: '2027-03-10' }, NOTE)
    expect(button(/^Requests: /)).toHaveAttribute(
      'title',
      'Which requests count: requests received through Mar 10, 2027 4 later requests left out.'
    )
  })

  it('lists All requests, Through the R1 deadline and, last, a real date field with no presets', async () => {
    renderPicker({ kind: 'all' })
    await userEvent.click(button(/^Requests: /))
    const pop = screen.getByTestId('request-set-popover')
    // the picked row carries a ✓ before its words
    const rows = Array.from(pop.children).map((c) => c.textContent.replace('✓', ''))
    expect(rows).toEqual(['All requests', 'Through the R1 deadline', 'Received through'])
    const date = within(pop).getByLabelText('Received through')
    expect(date).toHaveAttribute('type', 'date')
    expect(pop.lastElementChild?.contains(date)).toBe(true)
  })

  it('chooses the deadline and closes', async () => {
    const onChange = renderPicker({ kind: 'all' })
    await userEvent.click(button(/^Requests: /))
    await userEvent.click(screen.getByRole('button', { name: 'Through the R1 deadline' }))
    expect(onChange).toHaveBeenCalledWith({ kind: 'deadline' })
    expect(screen.queryByTestId('request-set-popover')).toBeNull()
  })

  it('chooses All requests', async () => {
    const onChange = renderPicker({ kind: 'deadline' })
    await userEvent.click(button(/^Requests: /))
    await userEvent.click(screen.getByRole('button', { name: 'All requests' }))
    expect(onChange).toHaveBeenCalledWith({ kind: 'all' })
  })

  it('takes a typed day, and clearing it returns to all', () => {
    const onChange = renderPicker({ kind: 'date', date: '2027-03-10' })
    fireEvent.click(button(/^Requests: /))
    const date = screen.getByLabelText('Received through')
    expect(date).toHaveValue('2027-03-10')
    fireEvent.change(date, { target: { value: '2027-04-01' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'date', date: '2027-04-01' })
    fireEvent.change(date, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'all' })
  })

  it('keeps the popover open while a day is typed, and closes on Escape or a press outside', async () => {
    renderPicker({ kind: 'all' })
    await userEvent.click(button(/^Requests: /))
    fireEvent.change(screen.getByLabelText('Received through'), { target: { value: '2027-04-01' } })
    expect(screen.getByTestId('request-set-popover')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('request-set-popover')).toBeNull()
    await userEvent.click(button(/^Requests: /))
    await userEvent.click(document.body)
    expect(screen.queryByTestId('request-set-popover')).toBeNull()
  })

  it('draws the 26px white picker face', () => {
    renderPicker({ kind: 'all' })
    expect(button(/^Requests: /)).toHaveClass('h-[26px]', 'bg-card')
  })
})
