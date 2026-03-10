import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SnapshotDateSelector } from './SnapshotDateSelector'

describe('SnapshotDateSelector', () => {
  const availableDates = ['2025-10-27', '2025-10-20', '2025-10-15']

  it('renders nothing when no dates available', () => {
    const { container } = render(
      <SnapshotDateSelector snapshotDate={null} onDateChange={vi.fn()} availableDates={[]} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows Today as default selection', () => {
    render(
      <SnapshotDateSelector
        snapshotDate={null}
        onDateChange={vi.fn()}
        availableDates={availableDates}
      />
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('__today__')
  })

  it('calls onDateChange with date string when date selected', async () => {
    const onDateChange = vi.fn()
    render(
      <SnapshotDateSelector
        snapshotDate={null}
        onDateChange={onDateChange}
        availableDates={availableDates}
      />
    )
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, '2025-10-20')
    expect(onDateChange).toHaveBeenCalledWith('2025-10-20')
  })

  it('calls onDateChange with null when Today selected', async () => {
    const onDateChange = vi.fn()
    render(
      <SnapshotDateSelector
        snapshotDate="2025-10-20"
        onDateChange={onDateChange}
        availableDates={availableDates}
      />
    )
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, '__today__')
    expect(onDateChange).toHaveBeenCalledWith(null)
  })

  it('shows selected snapshot date as current value', () => {
    render(
      <SnapshotDateSelector
        snapshotDate="2025-10-20"
        onDateChange={vi.fn()}
        availableDates={availableDates}
      />
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('2025-10-20')
  })
})
