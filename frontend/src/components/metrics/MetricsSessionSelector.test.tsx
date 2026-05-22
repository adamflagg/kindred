/**
 * Tests for MetricsSessionSelector component
 * Covers Teens quick-pick and Teen Programs section in session dropdown
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MetricsSessionSelector } from './MetricsSessionSelector'
import type { MetricsSessionContextType } from '../../hooks/useMetricsSession'

const mockSetViewMode = vi.fn()
const mockSetSelectedSessionCmId = vi.fn()
const mockSetSelectedDuration = vi.fn()
const mockSetSelectedTeenType = vi.fn()

const baseMockContext = {
  selectedSessionCmId: null,
  selectedSession: undefined,
  selectedDuration: null,
  isLoading: false,
  viewMode: 'sessions' as const,
  setViewMode: mockSetViewMode,
  setSelectedSessionCmId: mockSetSelectedSessionCmId,
  setSelectedDuration: mockSetSelectedDuration,
  clearSession: vi.fn(),
  activeSessionTypes: ['main', 'embedded'],
  sessionTypesParam: 'main,embedded',
  sessions: [],
  campSessions: [
    {
      cm_id: 1001,
      name: 'Session 1',
      session_type: 'main' as const,
      start_date: '2026-06-15',
      end_date: '2026-06-29',
    },
  ],
  questSessions: [],
  teenSessions: [
    {
      cm_id: 2001,
      name: 'SCIT 2026',
      session_type: 'scit' as const,
      start_date: '2026-08-01',
      end_date: '2026-08-14',
    },
    {
      cm_id: 2002,
      name: 'TLI 2026',
      session_type: 'tli' as const,
      start_date: '2026-08-10',
      end_date: '2026-08-24',
    },
  ],
  hasScit: true,
  hasTli: true,
  selectedTeenType: null as 'scit' | 'tli' | null,
  setSelectedTeenType: mockSetSelectedTeenType,
  durationGroups: new Map(),
  durationParam: undefined,
  filterOptions: {} as MetricsSessionContextType['filterOptions'],
  expandedRetention: false,
  setExpandedRetention: vi.fn(),
  compareYear: null,
  setCompareYear: vi.fn(),
  isComparing: false,
} satisfies MetricsSessionContextType

vi.mock('../../hooks/useMetricsSession', () => ({
  useMetricsSession: vi.fn(),
}))

import { useMetricsSession } from '../../hooks/useMetricsSession'

const mockUseMetricsSession = vi.mocked(useMetricsSession)

beforeEach(() => {
  vi.clearAllMocks()
  mockUseMetricsSession.mockReturnValue(baseMockContext)
})

describe('MetricsSessionSelector — teen features', () => {
  describe('with hasScit:true, hasTli:true', () => {
    it('shows a "Teens" option in the quick-pick area', async () => {
      const user = userEvent.setup()
      render(<MetricsSessionSelector />)

      // Open the listbox
      const button = screen.getByRole('button')
      await user.click(button)

      expect(screen.getByRole('option', { name: 'Teens' })).toBeInTheDocument()
    })

    it('shows a "Teen Programs" group label', async () => {
      const user = userEvent.setup()
      render(<MetricsSessionSelector />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(screen.getByText('Teen Programs')).toBeInTheDocument()
    })

    it('renders SCIT and TLI options under Teen Programs', async () => {
      const user = userEvent.setup()
      render(<MetricsSessionSelector />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(screen.getByRole('option', { name: 'SCIT' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'TLI' })).toBeInTheDocument()
    })

    it('clicking "SCIT" calls setSelectedTeenType("scit")', async () => {
      const user = userEvent.setup()
      render(<MetricsSessionSelector />)

      const button = screen.getByRole('button')
      await user.click(button)

      await user.click(screen.getByRole('option', { name: 'SCIT' }))
      expect(mockSetSelectedTeenType).toHaveBeenCalledWith('scit')
    })

    it('clicking "Teens" calls setViewMode("teens")', async () => {
      const user = userEvent.setup()
      render(<MetricsSessionSelector />)

      const button = screen.getByRole('button')
      await user.click(button)

      await user.click(screen.getByRole('option', { name: 'Teens' }))
      expect(mockSetViewMode).toHaveBeenCalledWith('teens')
    })
  })

  describe('with hasScit:false, hasTli:false', () => {
    beforeEach(() => {
      mockUseMetricsSession.mockReturnValue({
        ...baseMockContext,
        hasScit: false,
        hasTli: false,
        teenSessions: [],
      })
    })

    it('does NOT render the Teens quick-pick option', async () => {
      const user = userEvent.setup()
      render(<MetricsSessionSelector />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(screen.queryByRole('option', { name: 'Teens' })).not.toBeInTheDocument()
    })

    it('does NOT render the Teen Programs group label', async () => {
      const user = userEvent.setup()
      render(<MetricsSessionSelector />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(screen.queryByText('Teen Programs')).not.toBeInTheDocument()
    })

    it('does NOT render SCIT or TLI options', async () => {
      const user = userEvent.setup()
      render(<MetricsSessionSelector />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(screen.queryByRole('option', { name: 'SCIT' })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'TLI' })).not.toBeInTheDocument()
    })
  })

  describe('display label when teen type is selected', () => {
    it('shows "SCIT" as display label when selectedTeenType is "scit"', () => {
      mockUseMetricsSession.mockReturnValue({
        ...baseMockContext,
        selectedTeenType: 'scit',
      })
      render(<MetricsSessionSelector />)
      expect(screen.getByRole('button')).toHaveTextContent('SCIT')
    })

    it('shows "TLI" as display label when selectedTeenType is "tli"', () => {
      mockUseMetricsSession.mockReturnValue({
        ...baseMockContext,
        selectedTeenType: 'tli',
      })
      render(<MetricsSessionSelector />)
      expect(screen.getByRole('button')).toHaveTextContent('TLI')
    })

    it('shows "Teens" as display label when viewMode is "teens" and no selectedTeenType', () => {
      mockUseMetricsSession.mockReturnValue({
        ...baseMockContext,
        viewMode: 'teens' as const,
        selectedTeenType: null,
      })
      render(<MetricsSessionSelector />)
      expect(screen.getByRole('button')).toHaveTextContent('Teens')
    })
  })
})
