import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RuleControl } from './RuleControl'
import type { EditContext } from './sectionEdit'

const CONTEXT: EditContext = {
  classes: ['camp', 'teen', 'family'],
  classLabels: new Map(),
  pools: [{ key: 'pool_a', label: 'Pool A' }],
  sessions: [
    { id: 1000101, name: 'Session 1' },
    { id: 1000102, name: 'Session 2' },
    { id: 1000103, name: 'Session 3' },
  ],
  programs: [
    { key: 'summer', label: 'Summer' },
    { key: 'weekend', label: 'Weekend' },
  ],
  claimed: new Set([1000101]),
}

describe('RuleControl', () => {
  it('draws a choice as the field-size white picker, and sends the picked value', async () => {
    const onChange = vi.fn()
    render(
      <RuleControl
        path={['income', 'basis']}
        value="gross"
        spec={{ kind: 'choice', options: ['gross', 'agi'] }}
        raw="gross"
        problem={null}
        onChange={onChange}
      />
    )
    expect(document.querySelector('select')).toBeNull()
    const face = screen.getByRole('button', { name: /Prior-year income measure/ })
    expect(face).toHaveClass('h-[30px]')
    await userEvent.click(face)
    await userEvent.click(screen.getAllByRole('option')[1] as HTMLElement)
    expect(onChange).toHaveBeenLastCalledWith('agi')
  })

  it("offers the season's unclaimed sessions in Add a session, and removes a chip with ×", async () => {
    const onChange = vi.fn()
    render(
      <RuleControl
        path={['summer', 'session_cm_ids']}
        value={[1000102]}
        spec={{ kind: 'sessions', options: CONTEXT.sessions, claimed: CONTEXT.claimed }}
        raw="1000102"
        problem={null}
        onChange={onChange}
      />
    )
    expect(screen.getByText('Session 2')).toBeInTheDocument()
    // The white picker, never a native select (§3): its button reads "Add a session".
    expect(document.querySelector('select')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Add a session/ }))
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Session 3'])
    await userEvent.click(screen.getByRole('option', { name: 'Session 3' }))
    expect(onChange).toHaveBeenLastCalledWith('1000102,1000103')
    await userEvent.click(screen.getByRole('button', { name: '×' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('checks a program on and off for the grants offset', async () => {
    const onChange = vi.fn()
    render(
      <RuleControl
        path={['offset_programs']}
        value={['summer']}
        spec={{ kind: 'programs', options: CONTEXT.programs }}
        raw="summer"
        problem={null}
        onChange={onChange}
      />
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Weekend' }))
    expect(onChange).toHaveBeenLastCalledWith('summer,weekend')
  })

  it('boxes a date and a picker', () => {
    render(
      <RuleControl
        path={['r1_run']}
        value={null}
        spec={{ kind: 'date' }}
        raw=""
        problem={null}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Round 1 run')).toHaveAttribute('type', 'date')
  })

  it('shows a fraction as a percent and sends it back as a fraction', () => {
    const onChange = vi.fn()
    render(
      <RuleControl
        path={['income', 'weights', 'prior_year']}
        value="0.75"
        spec={{ kind: 'number', unit: 'plain', whole: false, nullable: false, fraction: true }}
        raw="0.75"
        problem={null}
        onChange={onChange}
      />
    )
    const box = screen.getByRole('textbox')
    expect(box).toHaveValue('75')
    fireEvent.change(box, { target: { value: '7.5' } })
    expect(onChange).toHaveBeenLastCalledWith('0.075')
    fireEvent.change(box, { target: { value: '100' } })
    expect(onChange).toHaveBeenLastCalledWith('1')
  })

  it('names a box problem in amber', () => {
    render(
      <RuleControl
        path={['r1_run']}
        value={null}
        spec={{ kind: 'date' }}
        raw="x"
        problem="Not a date"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText('Not a date')).toBeInTheDocument()
  })
})
