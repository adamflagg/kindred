/**
 * Tests for YearSelector - loading state when years are unavailable
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  // Owner ruling 2026-10-29: the closed-season lock mark is gone (it replaces CSD-3). A closed season (older than
  // N-1) is told apart only by a lighter grey in the list; the button reads as for any year.
  describe('closed seasons in the picker (no lock mark)', () => {
    const ctx = (currentYear: number) => ({
      currentYear,
      setCurrentYear: vi.fn(),
      availableYears: [2027, 2026, 2025, 2024],
      isTransitioning: false,
      isYearReady: true,
      configuredYear: 2027,
    })

    it('draws no lock on the button of a closed season, on Camperships or elsewhere', () => {
      const { unmount } = render(
        createElement(
          CurrentYearContext.Provider,
          { value: ctx(2025) },
          createElement(YearSelector, { aid: true })
        )
      )
      const button = screen.getByText('2025').closest('button') as HTMLElement
      expect(screen.queryByTestId('season-lock')).toBeNull()
      expect(button.querySelector('.lucide-lock')).toBeNull()
      // The button text is not greyed, even for a closed year.
      expect(button).not.toHaveClass('text-muted-foreground')
      expect(screen.getByText('2025')).not.toHaveClass('text-muted-foreground')
      unmount()
      renderWithContext(ctx(2025))
      expect(screen.queryByTestId('season-lock')).toBeNull()
    })

    it('greys only the closed seasons in the list, keeps them selectable, titles them', async () => {
      const context = ctx(2027)
      renderWithContext(context)
      await userEvent.click(screen.getByText('2027').closest('button') as HTMLElement)
      const option = (year: string) => screen.getByRole('option', { name: new RegExp(`^${year}`) })
      expect(screen.queryByTestId('season-lock')).toBeNull()
      expect(document.querySelector('.lucide-lock')).toBeNull()
      expect(option('2027')).not.toHaveClass('text-muted-foreground')
      expect(option('2026')).not.toHaveClass('text-muted-foreground')
      expect(option('2025')).toHaveClass('text-muted-foreground')
      expect(option('2024')).toHaveClass('text-muted-foreground')
      expect(option('2025')).toHaveAttribute('title', '2025 is closed: shown as history')
      expect(option('2026')).not.toHaveAttribute('title')
      // Still selectable.
      await userEvent.click(option('2025'))
      expect(context.setCurrentYear).toHaveBeenCalledWith(2025)
    })

    it('draws the kit check beside the selected year only, in the aid variant only', async () => {
      const { unmount } = render(
        createElement(
          CurrentYearContext.Provider,
          { value: ctx(2026) },
          createElement(YearSelector, { aid: true })
        )
      )
      await userEvent.click(screen.getByText('2026').closest('button') as HTMLElement)
      const option = (year: string) => screen.getByRole('option', { name: new RegExp(`^${year}`) })
      const check = option('2026').querySelector('[aria-hidden]')
      expect(check).toHaveTextContent('✓')
      expect(check).toHaveClass('text-primary', 'absolute', 'left-[7px]')
      for (const other of ['2027', '2025', '2024']) {
        expect(option(other).querySelector('[aria-hidden]')).toBeNull()
      }
      unmount()
      renderWithContext(ctx(2026))
      await userEvent.click(screen.getByText('2026').closest('button') as HTMLElement)
      expect(screen.queryByText('✓')).toBeNull()
    })

    it('greys nothing before the configured season is known', async () => {
      const { setCurrentYear, availableYears, isTransitioning, isYearReady } = ctx(2025)
      renderWithContext({
        currentYear: 2025,
        setCurrentYear,
        availableYears,
        isTransitioning,
        isYearReady,
      })
      await userEvent.click(screen.getByText('2025').closest('button') as HTMLElement)
      expect(screen.getByRole('option', { name: /^2024/ })).not.toHaveClass('text-muted-foreground')
    })
  })
})
