import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SnapshotDateSelector } from './SnapshotDateSelector'
import type { WeekOption } from '../../types/forecast'

function weekOption(overrides: Partial<WeekOption> = {}): WeekOption {
  return {
    week_number: 5,
    day_offset: 35,
    label: 'Week 5 · Nov 19',
    is_today: false,
    ...overrides,
  }
}

describe('SnapshotDateSelector', () => {
  const weekOptions: WeekOption[] = [
    weekOption({ week_number: 22, day_offset: 154, label: 'Week 22 (Today)', is_today: true }),
    weekOption({ week_number: 21, day_offset: 147, label: 'Week 21 · Mar 2' }),
    weekOption({ week_number: 20, day_offset: 140, label: 'Week 20 · Feb 23' }),
  ]

  it('renders nothing when no week options available', () => {
    const { container } = render(
      <SnapshotDateSelector dayOffset={null} onOffsetChange={vi.fn()} weekOptions={[]} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows today option as default selection', () => {
    render(
      <SnapshotDateSelector dayOffset={null} onOffsetChange={vi.fn()} weekOptions={weekOptions} />
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('__today__')
  })

  it('calls onOffsetChange with day_offset when week selected', async () => {
    const onOffsetChange = vi.fn()
    render(
      <SnapshotDateSelector
        dayOffset={null}
        onOffsetChange={onOffsetChange}
        weekOptions={weekOptions}
      />
    )
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, '147')
    expect(onOffsetChange).toHaveBeenCalledWith(147)
  })

  it('calls onOffsetChange with null when Today selected', async () => {
    const onOffsetChange = vi.fn()
    render(
      <SnapshotDateSelector
        dayOffset={147}
        onOffsetChange={onOffsetChange}
        weekOptions={weekOptions}
      />
    )
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, '__today__')
    expect(onOffsetChange).toHaveBeenCalledWith(null)
  })

  it('shows selected day offset as current value', () => {
    render(
      <SnapshotDateSelector dayOffset={147} onOffsetChange={vi.fn()} weekOptions={weekOptions} />
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('147')
  })
})
