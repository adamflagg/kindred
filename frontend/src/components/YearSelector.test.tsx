/**
 * Tests for YearSelector - loading state when years are unavailable
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { CurrentYearContext, type CurrentYearContextType } from '../hooks/useCurrentYear'
import YearSelector from './YearSelector'

function renderWithContext(contextValue: CurrentYearContextType) {
  return render(
    createElement(CurrentYearContext.Provider, { value: contextValue }, createElement(YearSelector))
  )
}

describe('YearSelector', () => {
  it('should show loading spinner when year is not ready', () => {
    renderWithContext({
      currentYear: 0,
      setCurrentYear: vi.fn(),
      availableYears: [],
      isTransitioning: false,
      isYearReady: false,
    })

    // Should show a loading spinner, not the year dropdown
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })

  it('should show year dropdown when year is ready', () => {
    renderWithContext({
      currentYear: 2026,
      setCurrentYear: vi.fn(),
      availableYears: [2026, 2025, 2024],
      isTransitioning: false,
      isYearReady: true,
    })

    // Should display the current year
    expect(screen.getByText('2026')).toBeTruthy()
  })

  it('should show loading spinner when availableYears is empty', () => {
    renderWithContext({
      currentYear: 0,
      setCurrentYear: vi.fn(),
      availableYears: [],
      isTransitioning: false,
      isYearReady: false,
    })

    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })
})
