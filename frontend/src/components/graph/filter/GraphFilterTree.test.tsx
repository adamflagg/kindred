/**
 * Tests for GraphFilterTree — the nested tree picker locked in the
 * 2026-04-30 redesign (Option 4: checkbox by label + caret to expand).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import GraphFilterTree from './GraphFilterTree'
import type { BunkSummary } from '../graphFilter'

const ALL_BUNKS: BunkSummary[] = [
  { cmId: 1, name: 'B-3' }, // Galil
  { cmId: 2, name: 'G-3' }, // Galil
  { cmId: 3, name: 'B-4' }, // Galil
  { cmId: 4, name: 'G-4' }, // Galil
  { cmId: 5, name: 'B-5' }, // Eilat
  { cmId: 6, name: 'G-6' }, // Eilat
  { cmId: 9, name: 'B-9' }, // Chalutzim 1
  { cmId: 10, name: 'G-10' }, // Chalutzim 1
]

function defaultProps() {
  return {
    selectedUnits: [] as string[],
    selectedBunks: [] as string[],
    allBunks: ALL_BUNKS,
    onAddUnit: vi.fn(),
    onRemoveUnit: vi.fn(),
    onAddBunk: vi.fn(),
    onRemoveBunk: vi.fn(),
    onClear: vi.fn(),
  }
}

describe('GraphFilterTree', () => {
  describe('rendering', () => {
    it('shows only units with bunks present in allBunks', () => {
      render(<GraphFilterTree {...defaultProps()} />)
      // Galil, Eilat, Chalutzim 1 have bunks in the roster
      expect(screen.getByText('Galil')).toBeInTheDocument()
      expect(screen.getByText('Eilat')).toBeInTheDocument()
      expect(screen.getByText('Chalutzim 1')).toBeInTheDocument()
      // Carmel/Haifa/Chalutzim 2 have no bunks in roster — not rendered
      expect(screen.queryByText('Carmel')).not.toBeInTheDocument()
      expect(screen.queryByText('Haifa')).not.toBeInTheDocument()
    })

    it('shows bunk count next to each unit', () => {
      render(<GraphFilterTree {...defaultProps()} />)
      const galilRow = screen.getByText('Galil').closest('li')
      expect(galilRow).toBeTruthy()
      expect(within(galilRow!).getByText(/4 bunks?/)).toBeInTheDocument()
    })

    it('does not show child bunks until unit is expanded', () => {
      render(<GraphFilterTree {...defaultProps()} />)
      expect(screen.queryByText('B-3')).not.toBeInTheDocument()
    })
  })

  describe('expansion', () => {
    it('clicking the caret expands the unit to show its bunks', () => {
      render(<GraphFilterTree {...defaultProps()} />)
      const galilRow = screen.getByText('Galil').closest('li')!
      const caret = within(galilRow).getByRole('button', { name: /expand galil/i })
      fireEvent.click(caret)
      expect(screen.getByText('B-3')).toBeInTheDocument()
      expect(screen.getByText('G-4')).toBeInTheDocument()
    })

    it('clicking the caret a second time collapses', () => {
      render(<GraphFilterTree {...defaultProps()} />)
      const galilRow = screen.getByText('Galil').closest('li')!
      const caret = within(galilRow).getByRole('button', { name: /expand galil/i })
      fireEvent.click(caret) // expand
      fireEvent.click(caret) // collapse
      expect(screen.queryByText('B-3')).not.toBeInTheDocument()
    })
  })

  describe('selection', () => {
    it('clicking the unit checkbox calls onAddUnit', () => {
      const props = defaultProps()
      render(<GraphFilterTree {...props} />)
      const checkbox = screen.getByRole('checkbox', { name: /^select galil/i })
      fireEvent.click(checkbox)
      expect(props.onAddUnit).toHaveBeenCalledWith('Galil')
    })

    it('clicking the unit checkbox when already selected calls onRemoveUnit', () => {
      const props = { ...defaultProps(), selectedUnits: ['Galil'] }
      render(<GraphFilterTree {...props} />)
      const checkbox = screen.getByRole('checkbox', { name: /^select galil/i })
      fireEvent.click(checkbox)
      expect(props.onRemoveUnit).toHaveBeenCalledWith('Galil')
    })

    it('when a unit is selected, expanding it shows children with disabled checkboxes and Included pill', () => {
      const props = { ...defaultProps(), selectedUnits: ['Galil'] }
      render(<GraphFilterTree {...props} />)
      // 'Galil' appears in both the chip rail and the tree row — use the
      // tree-only checkbox to navigate up to the row's <li>.
      const galilCheckbox = screen.getByRole('checkbox', { name: /^select galil/i })
      const galilRow = galilCheckbox.closest('li')!
      const caret = within(galilRow).getByRole('button', { name: /expand galil/i })
      fireEvent.click(caret)
      const bunkCheckbox = screen.getByRole('checkbox', { name: /^select b-3/i })
      expect(bunkCheckbox).toBeDisabled()
      expect(screen.getAllByText('Included').length).toBeGreaterThan(0)
    })

    it('clicking a bunk checkbox calls onAddBunk with the lowercase code', () => {
      const props = defaultProps()
      render(<GraphFilterTree {...props} />)
      const galilRow = screen.getByText('Galil').closest('li')!
      const caret = within(galilRow).getByRole('button', { name: /expand galil/i })
      fireEvent.click(caret)
      const bunkCheckbox = screen.getByRole('checkbox', { name: /^select b-3/i })
      fireEvent.click(bunkCheckbox)
      expect(props.onAddBunk).toHaveBeenCalledWith('b-3')
    })

    it('clicking a checked bunk checkbox calls onRemoveBunk', () => {
      const props = { ...defaultProps(), selectedBunks: ['b-9'] }
      render(<GraphFilterTree {...props} />)
      const chalutzimRow = screen.getByText('Chalutzim 1').closest('li')!
      const caret = within(chalutzimRow).getByRole('button', { name: /expand chalutzim 1/i })
      fireEvent.click(caret)
      const bunkCheckbox = screen.getByRole('checkbox', { name: /^select b-9/i })
      fireEvent.click(bunkCheckbox)
      expect(props.onRemoveBunk).toHaveBeenCalledWith('b-9')
    })
  })

  describe('chip rail', () => {
    it('renders a chip per selected unit', () => {
      const props = { ...defaultProps(), selectedUnits: ['Galil', 'Eilat'] }
      render(<GraphFilterTree {...props} />)
      expect(screen.getByRole('button', { name: /remove galil/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /remove eilat/i })).toBeInTheDocument()
    })

    it('renders a chip per selected bunk with parent unit hint', () => {
      const props = { ...defaultProps(), selectedBunks: ['b-9'] }
      render(<GraphFilterTree {...props} />)
      expect(screen.getByRole('button', { name: /remove b-9/i })).toBeInTheDocument()
    })

    it('clicking the unit chip × calls onRemoveUnit', () => {
      const props = { ...defaultProps(), selectedUnits: ['Galil'] }
      render(<GraphFilterTree {...props} />)
      fireEvent.click(screen.getByRole('button', { name: /remove galil/i }))
      expect(props.onRemoveUnit).toHaveBeenCalledWith('Galil')
    })

    it('clicking the bunk chip × calls onRemoveBunk', () => {
      const props = { ...defaultProps(), selectedBunks: ['b-9'] }
      render(<GraphFilterTree {...props} />)
      fireEvent.click(screen.getByRole('button', { name: /remove b-9/i }))
      expect(props.onRemoveBunk).toHaveBeenCalledWith('b-9')
    })
  })

  describe('search', () => {
    it('typing in search filters units to those whose name matches', () => {
      render(<GraphFilterTree {...defaultProps()} />)
      const search = screen.getByRole('searchbox')
      fireEvent.change(search, { target: { value: 'Gal' } })
      expect(screen.getByText('Galil')).toBeInTheDocument()
      expect(screen.queryByText('Eilat')).not.toBeInTheDocument()
    })

    it('typing a bunk name auto-expands the parent unit', () => {
      render(<GraphFilterTree {...defaultProps()} />)
      const search = screen.getByRole('searchbox')
      fireEvent.change(search, { target: { value: 'B-9' } })
      // Chalutzim 1 contains B-9, should auto-expand and show it
      expect(screen.getByText('Chalutzim 1')).toBeInTheDocument()
      expect(screen.getByText('B-9')).toBeInTheDocument()
    })

    it('search hides units with no matching bunks or unit name', () => {
      render(<GraphFilterTree {...defaultProps()} />)
      const search = screen.getByRole('searchbox')
      fireEvent.change(search, { target: { value: 'B-9' } })
      // Galil has no B-9 — should not render
      expect(screen.queryByText('Galil')).not.toBeInTheDocument()
    })
  })

  describe('disableUnitSelect (gender mode)', () => {
    const GIRL_BUNKS: BunkSummary[] = [
      { cmId: 3, name: 'G-3' },
      { cmId: 4, name: 'G-4' },
    ]

    function genderProps(overrides = {}) {
      return {
        selectedUnits: [] as string[],
        selectedBunks: ['g-3', 'g-4'],
        allBunks: GIRL_BUNKS,
        onAddUnit: vi.fn(),
        onRemoveUnit: vi.fn(),
        onAddBunk: vi.fn(),
        onRemoveBunk: vi.fn(),
        onClear: vi.fn(),
        ...overrides,
      }
    }

    it('does not render a unit-select checkbox when disableUnitSelect is true', () => {
      render(<GraphFilterTree {...genderProps({ disableUnitSelect: true })} />)
      // Unit rows should have no "Select <unit>" checkboxes — only bunk-level
      // checkboxes (if expanded).
      // Unit select checkboxes have aria-label "Select Galil" (not "Select G-3").
      expect(screen.queryByRole('checkbox', { name: /^select galil/i })).toBeNull()
    })

    it('renders selected-bunk chips with remove buttons and fires onRemoveBunk with the code', async () => {
      const onRemoveBunk = vi.fn()
      render(<GraphFilterTree {...genderProps({ disableUnitSelect: true, onRemoveBunk })} />)
      // Chip rail is always visible when selectedBunks is non-empty.
      // display = bunk.name = 'G-3'; aria-label = 'Remove G-3'
      const removeBtn = screen.getByRole('button', { name: /remove g-3/i })
      fireEvent.click(removeBtn)
      expect(onRemoveBunk).toHaveBeenCalledWith('g-3')
    })

    it('still renders unit-select checkboxes in normal (manual) mode', () => {
      render(<GraphFilterTree {...genderProps({ disableUnitSelect: false })} />)
      // In manual mode the "Select Galil" checkbox must appear (G-3/G-4 → Galil)
      expect(screen.getByRole('checkbox', { name: /^select galil/i })).toBeInTheDocument()
    })

    it('shows bunk chip for each selected bunk in gender mode', () => {
      render(<GraphFilterTree {...genderProps({ disableUnitSelect: true })} />)
      expect(screen.getByRole('button', { name: /remove g-3/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /remove g-4/i })).toBeInTheDocument()
    })
  })

  describe('footer', () => {
    it('shows Clear filter link when filter is active', () => {
      const props = { ...defaultProps(), selectedUnits: ['Galil'] }
      render(<GraphFilterTree {...props} />)
      expect(screen.getByRole('button', { name: /clear filter/i })).toBeInTheDocument()
    })

    it('hides Clear filter link when filter is empty', () => {
      render(<GraphFilterTree {...defaultProps()} />)
      expect(screen.queryByRole('button', { name: /clear filter/i })).not.toBeInTheDocument()
    })

    it('clicking Clear filter calls onClear', () => {
      const props = { ...defaultProps(), selectedUnits: ['Galil'] }
      render(<GraphFilterTree {...props} />)
      fireEvent.click(screen.getByRole('button', { name: /clear filter/i }))
      expect(props.onClear).toHaveBeenCalled()
    })
  })
})
