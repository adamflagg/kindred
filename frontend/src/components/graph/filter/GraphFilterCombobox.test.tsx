import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GraphFilterCombobox from './GraphFilterCombobox'
import type { BunkSummary } from '../graphFilter'

const ALL_BUNKS: BunkSummary[] = [
  { cmId: 1, name: 'B-3' }, // Galil
  { cmId: 2, name: 'G-3' }, // Galil
  { cmId: 5, name: 'B-5' }, // Eilat
  { cmId: 9, name: 'B-9' }, // Chalutzim 1
]

function renderCombobox(props: Partial<React.ComponentProps<typeof GraphFilterCombobox>> = {}) {
  return render(
    <GraphFilterCombobox
      selectedUnits={props.selectedUnits ?? []}
      selectedBunkIds={props.selectedBunkIds ?? []}
      allBunks={ALL_BUNKS}
      onAddUnit={props.onAddUnit ?? vi.fn()}
      onRemoveUnit={props.onRemoveUnit ?? vi.fn()}
      onAddBunk={props.onAddBunk ?? vi.fn()}
      onRemoveBunk={props.onRemoveBunk ?? vi.fn()}
    />
  )
}

describe('GraphFilterCombobox', () => {
  it('renders selected units and bunks as chips', () => {
    renderCombobox({ selectedUnits: ['Galil'], selectedBunkIds: [9] })
    expect(screen.getByRole('button', { name: /Remove Galil/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove B-9/i })).toBeInTheDocument()
  })

  it('typing filters the dropdown to matching units and bunks', async () => {
    const user = userEvent.setup()
    renderCombobox()
    await user.type(screen.getByRole('combobox'), 'ga')
    expect(screen.getByRole('option', { name: /Galil/i })).toBeInTheDocument()
    // Galil bunks should still match because their unit name matches "ga"
    expect(screen.queryByRole('option', { name: /Haifa/i })).not.toBeInTheDocument()
  })

  it('selecting a unit row calls onAddUnit', async () => {
    const onAddUnit = vi.fn()
    const user = userEvent.setup()
    renderCombobox({ onAddUnit })
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /Galil/i }))
    expect(onAddUnit).toHaveBeenCalledWith('Galil')
  })

  it('selecting a bunk row calls onAddBunk with cm_id', async () => {
    const onAddBunk = vi.fn()
    const user = userEvent.setup()
    renderCombobox({ onAddBunk })
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /B-9/i }))
    expect(onAddBunk).toHaveBeenCalledWith(9)
  })

  it('Backspace on empty input removes the last chip', async () => {
    const onRemoveBunk = vi.fn()
    const user = userEvent.setup()
    renderCombobox({ selectedUnits: ['Galil'], selectedBunkIds: [9], onRemoveBunk })
    const input = screen.getByRole('combobox')
    input.focus()
    await user.keyboard('{Backspace}')
    expect(onRemoveBunk).toHaveBeenCalledWith(9)
  })

  it('clicking the chip ✕ removes the chip', () => {
    const onRemoveUnit = vi.fn()
    renderCombobox({ selectedUnits: ['Galil'], onRemoveUnit })
    fireEvent.click(screen.getByLabelText(/Remove Galil/i))
    expect(onRemoveUnit).toHaveBeenCalledWith('Galil')
  })

  it('does not show selected items in the dropdown', async () => {
    const user = userEvent.setup()
    renderCombobox({ selectedUnits: ['Galil'] })
    await user.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('option', { name: /^Galil$/ })).not.toBeInTheDocument()
  })

  it('Arrow Down + Enter selects the highlighted option', async () => {
    const onAddUnit = vi.fn()
    const user = userEvent.setup()
    renderCombobox({ onAddUnit })
    const input = screen.getByRole('combobox')
    input.focus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onAddUnit).toHaveBeenCalled()
  })
})
