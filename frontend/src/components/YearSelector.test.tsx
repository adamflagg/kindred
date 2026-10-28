/**
 * Tests for YearSelector - loading state when years are unavailable
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  // Final audit M-E5: on Camperships the Season picker is the kit's white 26px picker; Summer and
  // Family Camp keep the shared compact button.
  it('dresses the button in the kit picker only with the aid prop', () => {
    const ctx = {
      currentYear: 2026,
      setCurrentYear: vi.fn(),
      availableYears: [2026, 2025],
      isTransitioning: false,
      isYearReady: true,
    }
    const { unmount } = render(
      createElement(
        CurrentYearContext.Provider,
        { value: ctx },
        createElement(YearSelector, { aid: true })
      )
    )
    const aidButton = screen.getByText('2026').closest('button') as HTMLElement
    expect(aidButton).toHaveClass('bg-card', 'text-[12.5px]')
    expect(aidButton).not.toHaveClass('listbox-button-compact')
    // The kit picker dims itself while the year switches (disabled), as the shared button does.
    expect(aidButton.className).toMatch(/disabled:opacity-\d+/)
    expect(aidButton).toHaveClass('disabled:cursor-wait')
    // chrome-9: the mock's subbar has no calendar icon, and the chevron is AidPicker's 14px.
    expect(document.querySelector('.lucide-calendar')).toBeNull()
    expect(aidButton.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5')
    unmount()
    renderWithContext(ctx)
    expect(screen.getByText('2026').closest('button')).toHaveClass('listbox-button-compact')
    expect(document.querySelector('.lucide-calendar')).not.toBeNull()
  })

  it('draws no calendar icon while loading on Camperships either', () => {
    render(
      createElement(
        CurrentYearContext.Provider,
        {
          value: {
            currentYear: 0,
            setCurrentYear: vi.fn(),
            availableYears: [],
            isTransitioning: false,
            isYearReady: false,
          },
        },
        createElement(YearSelector, { aid: true })
      )
    )
    expect(document.querySelector('.lucide-calendar')).toBeNull()
  })

  // CLOSED-SEASONS-DONE (owner ruling CSD-3, "everywhere"): a closed season (older than N-1) wears a lock mark on
  // the picker's button and in its list, wherever the app-wide picker appears. A mark only: nothing unlocks.
  describe('the closed-season lock (CSD-3)', () => {
    const ctx = (currentYear: number) => ({
      currentYear,
      setCurrentYear: vi.fn(),
      availableYears: [2027, 2026, 2025, 2024],
      isTransitioning: false,
      isYearReady: true,
      configuredYear: 2027,
    })

    it('locks the button of a closed season, on Camperships and elsewhere', () => {
      const { unmount } = render(
        createElement(
          CurrentYearContext.Provider,
          { value: ctx(2025) },
          createElement(YearSelector, { aid: true })
        )
      )
      const button = screen.getByText('2025').closest('button') as HTMLElement
      expect(within(button).getByTestId('season-lock')).toHaveAttribute(
        'title',
        '2025 is closed: shown as history'
      )
      unmount()
      renderWithContext(ctx(2025))
      const plain = screen.getByText('2025').closest('button') as HTMLElement
      expect(within(plain).getByTestId('season-lock')).toBeInTheDocument()
    })

    it('leaves an open season unmarked', () => {
      renderWithContext(ctx(2026))
      expect(screen.queryByTestId('season-lock')).toBeNull()
    })

    it('marks every closed season in the list, and only those', async () => {
      renderWithContext(ctx(2027))
      await userEvent.click(screen.getByText('2027').closest('button') as HTMLElement)
      const locked = (year: string) =>
        within(screen.getByRole('option', { name: new RegExp(`^${year}`) })).queryByTestId(
          'season-lock'
        )
      expect(locked('2027')).toBeNull()
      expect(locked('2026')).toBeNull()
      expect(locked('2025')).not.toBeNull()
      expect(locked('2024')).not.toBeNull()
      // A mark only: picking a closed season still works.
      expect(screen.queryByText(/unlock/i)).toBeNull()
    })

    it('marks nothing before the configured season is known', () => {
      const { setCurrentYear, availableYears, isTransitioning, isYearReady } = ctx(2025)
      renderWithContext({
        currentYear: 2025,
        setCurrentYear,
        availableYears,
        isTransitioning,
        isYearReady,
      })
      expect(screen.queryByTestId('season-lock')).toBeNull()
    })
  })
})
