import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BunkSwapModal from './BunkSwapModal'
import type { BunkWithCampers } from '../types/app-types'

function makeBunk(overrides: Partial<BunkWithCampers>): BunkWithCampers {
  return {
    id: 'bunk-x',
    cm_id: 1001,
    name: 'G-9',
    gender: 'F',
    is_active: true,
    sort_order: 0,
    year: 2026,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    collectionId: 'bunks',
    collectionName: 'bunks',
    campers: [],
    occupancy: 0,
    utilization: 0,
    ...overrides,
  } as BunkWithCampers
}

const sourceG9 = makeBunk({ id: 'g9', name: 'G-9', gender: 'F' })
const candidates: BunkWithCampers[] = [
  makeBunk({ id: 'g3', name: 'G-3', gender: 'F', campers: Array(10).fill({}) as never }),
  makeBunk({ id: 'g5', name: 'G-5', gender: 'F', campers: Array(11).fill({}) as never }),
  makeBunk({ id: 'g10b', name: 'G-10b', gender: 'F', campers: Array(10).fill({}) as never }),
  makeBunk({ id: 'b3', name: 'B-3', gender: 'M', campers: Array(10).fill({}) as never }),
  makeBunk({ id: 'ag7', name: 'AG-7', gender: 'F', campers: Array(8).fill({}) as never }),
  makeBunk({ id: 'removed', name: 'Removed cabin', gender: 'F', campers: [] }),
]

describe('BunkSwapModal', () => {
  it('renders only same-gender, non-AG, non-removed candidates', () => {
    render(
      <BunkSwapModal
        source={sourceG9}
        allBunks={[sourceG9, ...candidates]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    )

    // Eligible — rendered as radio inputs labeled with bunk name
    expect(screen.getByRole('radio', { name: /G-3/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /G-5/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /G-10b/ })).toBeInTheDocument()

    // Filtered out
    expect(screen.queryByRole('radio', { name: /B-3/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /AG-7/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Removed cabin/ })).not.toBeInTheDocument()
    // Source itself never appears as a target
    expect(screen.queryByRole('radio', { name: /^G-9/ })).not.toBeInTheDocument()
  })

  it('renders each candidate with name + camper count', () => {
    render(
      <BunkSwapModal
        source={sourceG9}
        allBunks={[sourceG9, ...candidates]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    expect(screen.getByRole('radio', { name: /G-3.*10 campers/ })).toBeInTheDocument()
  })

  it('Confirm button is disabled until a target is selected', () => {
    render(
      <BunkSwapModal
        source={sourceG9}
        allBunks={[sourceG9, ...candidates]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    const confirm = screen.getByRole('button', { name: /confirm swap/i })
    expect(confirm).toBeDisabled()
  })

  it('clicking a target enables Confirm and shows it as selected', () => {
    render(
      <BunkSwapModal
        source={sourceG9}
        allBunks={[sourceG9, ...candidates]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    const targetRow = screen.getByRole('radio', { name: /G-10b/ })
    fireEvent.click(targetRow)
    expect(targetRow).toBeChecked()
    expect(screen.getByRole('button', { name: /confirm swap/i })).not.toBeDisabled()
  })

  it('clicking Confirm fires onConfirm with the selected bunk', () => {
    const onConfirm = vi.fn()
    render(
      <BunkSwapModal
        source={sourceG9}
        allBunks={[sourceG9, ...candidates]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    )
    fireEvent.click(screen.getByRole('radio', { name: /G-10b/ }))
    fireEvent.click(screen.getByRole('button', { name: /confirm swap/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'g10b', name: 'G-10b' }))
  })

  it('clicking Cancel fires onCancel and does not fire onConfirm', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <BunkSwapModal
        source={sourceG9}
        allBunks={[sourceG9, ...candidates]}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows the empty state when no eligible candidates remain', () => {
    render(
      <BunkSwapModal
        source={sourceG9}
        allBunks={[sourceG9]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    )
    expect(screen.getByText(/no eligible bunks in this session/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm swap/i })).toBeDisabled()
  })
})
