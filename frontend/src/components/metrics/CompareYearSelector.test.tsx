/**
 * Tests for CompareYearSelector with inactive/active states.
 *
 * TDD: Tests written first to define toggle and clear behavior.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { CompareYearSelector } from './CompareYearSelector'

describe('CompareYearSelector', () => {
  const availableYears = [2025, 2024, 2023, 2022]

  describe('inactive state (compareYear is null)', () => {
    it('renders a "Compare to..." button when no comparison is active', () => {
      render(
        <CompareYearSelector
          primaryYear={2025}
          compareYear={null}
          onCompareYearChange={vi.fn()}
          onClear={vi.fn()}
          availableYears={availableYears}
        />
      )

      expect(screen.getByText(/compare/i)).toBeInTheDocument()
    })

    it('opens dropdown to select a year', () => {
      const onChange = vi.fn()
      render(
        <CompareYearSelector
          primaryYear={2025}
          compareYear={null}
          onCompareYearChange={onChange}
          onClear={vi.fn()}
          availableYears={availableYears}
        />
      )

      // Click the compare button to activate
      const button = screen.getByText(/compare/i)
      fireEvent.click(button)

      // Should show year options (excluding primary year 2025)
      expect(screen.getByText('2024')).toBeInTheDocument()
    })
  })

  describe('active state (compareYear is set)', () => {
    it('shows the selected comparison year', () => {
      render(
        <CompareYearSelector
          primaryYear={2025}
          compareYear={2024}
          onCompareYearChange={vi.fn()}
          onClear={vi.fn()}
          availableYears={availableYears}
        />
      )

      expect(screen.getByText(/2025/)).toBeInTheDocument()
      expect(screen.getByText(/2024/)).toBeInTheDocument()
    })

    it('shows a clear (X) button when comparison is active', () => {
      const onClear = vi.fn()
      render(
        <CompareYearSelector
          primaryYear={2025}
          compareYear={2024}
          onCompareYearChange={vi.fn()}
          onClear={onClear}
          availableYears={availableYears}
        />
      )

      // Find and click the X/clear button
      const clearButton = screen.getByRole('button', { name: /clear|close|remove/i })
      fireEvent.click(clearButton)

      expect(onClear).toHaveBeenCalled()
    })

    it('calls onCompareYearChange when selecting a different year', () => {
      const onChange = vi.fn()
      render(
        <CompareYearSelector
          primaryYear={2025}
          compareYear={2024}
          onCompareYearChange={onChange}
          onClear={vi.fn()}
          availableYears={availableYears}
        />
      )

      // Change the dropdown to 2023
      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: '2023' } })

      expect(onChange).toHaveBeenCalledWith(2023)
    })

    it('excludes primary year from dropdown options', () => {
      render(
        <CompareYearSelector
          primaryYear={2025}
          compareYear={2024}
          onCompareYearChange={vi.fn()}
          onClear={vi.fn()}
          availableYears={availableYears}
        />
      )

      const select = screen.getByRole('combobox')
      const options = Array.from(select.querySelectorAll('option'))
      const optionValues = options.map((o) => o.value)

      expect(optionValues).not.toContain('2025')
      expect(optionValues).toContain('2024')
      expect(optionValues).toContain('2023')
    })
  })
})
