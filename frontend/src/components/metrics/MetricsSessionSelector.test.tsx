/**
 * Tests for MetricsSessionSelector component.
 *
 * PR 4: presets are headings with their sessions under them, one option per row (pick 2B), drawn
 * with the kit AidPicker's heading level plus a session count (board 5, option i). The list is
 * about ten rows tall (board 7): ten 26px kit rows plus the list's 8px padding, so 270px.
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
  durationGroups: new Map([['1-week', []]]) as MetricsSessionContextType['durationGroups'],
  durationParam: undefined,
  filterOptions: {} as MetricsSessionContextType['filterOptions'],
  expandedRetention: false,
  setExpandedRetention: vi.fn(),
  compareYear: null,
  setCompareYear: vi.fn(),
  isComparing: false,
  includeTeenPipeline: false,
  setIncludeTeenPipeline: vi.fn(),
  scopeHasTeens: false,
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

describe('MetricsSessionSelector — presets as headings (2B, 5i)', () => {
  const open = async () => {
    const user = userEvent.setup()
    render(<MetricsSessionSelector />)
    await user.click(screen.getByRole('button'))
    return user
  }

  it('lists All Summer, then each preset as a heading with its sessions under it', async () => {
    await open()
    const names = screen.getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual([
      'All Summer',
      '✓At Camp1',
      'Session 1',
      'Quests0',
      'Teens2',
      'SCIT',
      'TLI',
      '1 Week',
    ])
  })

  it('draws the presets as bold headings and their sessions indented', async () => {
    await open()
    for (const h of ['At Camp', 'Quests', 'Teens']) {
      expect(screen.getByRole('option', { name: new RegExp(`^✓?${h}`) })).toHaveClass('font-bold')
    }
    expect(screen.getByRole('option', { name: 'Session 1' }).style.paddingLeft).toBe('34px')
    expect(screen.getByRole('option', { name: 'SCIT' }).style.paddingLeft).toBe('34px')
  })

  it('keeps By Duration as a plain, unpickable label', async () => {
    await open()
    expect(screen.getByText('By Duration')).toHaveAttribute('role', 'presentation')
    expect(screen.queryByRole('option', { name: /By Duration/ })).not.toBeInTheDocument()
  })

  it('opens about ten rows tall', async () => {
    await open()
    const list = screen.getByRole('listbox')
    // Ten 26px kit rows (py-1 + 18px line) plus p-1, not max-h-96's ~14 rows nor the kit's 260px.
    expect(list).toHaveClass('max-h-[270px]')
    expect(list.className).not.toContain('max-h-96')
    expect(list.className).not.toContain('max-h-[260px]')
  })

  it('clicking a heading picks the preset', async () => {
    const user = await open()
    await user.click(screen.getByRole('option', { name: /^Teens/ }))
    expect(mockSetViewMode).toHaveBeenCalledWith('teens')
  })

  it('clicking "SCIT" calls setSelectedTeenType("scit")', async () => {
    const user = await open()
    await user.click(screen.getByRole('option', { name: 'SCIT' }))
    expect(mockSetSelectedTeenType).toHaveBeenCalledWith('scit')
  })

  it('clicking a session picks it', async () => {
    const user = await open()
    await user.click(screen.getByRole('option', { name: 'Session 1' }))
    expect(mockSetSelectedSessionCmId).toHaveBeenCalledWith(1001)
  })

  it('clicking a length picks it', async () => {
    const user = await open()
    await user.click(screen.getByRole('option', { name: '1 Week' }))
    expect(mockSetSelectedDuration).toHaveBeenCalledWith('1-week')
  })

  it('keeps the Analytics button', () => {
    render(<MetricsSessionSelector />)
    expect(screen.getByRole('button')).toHaveClass('listbox-button', 'min-w-[180px]')
  })

  describe('with no teen programs this season', () => {
    beforeEach(() => {
      mockUseMetricsSession.mockReturnValue({
        ...baseMockContext,
        hasScit: false,
        hasTli: false,
        teenSessions: [],
      })
    })

    it('has no Teens heading and no SCIT or TLI', async () => {
      await open()
      expect(screen.queryByRole('option', { name: /^Teens/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'SCIT' })).not.toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'TLI' })).not.toBeInTheDocument()
    })
  })

  describe('not used on this page (4B)', () => {
    it('is disabled and says so', () => {
      render(<MetricsSessionSelector notUsedHere />)
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(button).toHaveTextContent('At Camp · not used here')
    })
  })

  describe('display label', () => {
    it.each([
      [{ selectedTeenType: 'scit' as const }, 'SCIT'],
      [{ selectedTeenType: 'tli' as const }, 'TLI'],
      [{ viewMode: 'teens' as const, selectedTeenType: null }, 'Teens'],
      [{ selectedDuration: '2-week' as const }, '2 Week'],
    ])('reads %o as "%s"', (over, label) => {
      mockUseMetricsSession.mockReturnValue({ ...baseMockContext, ...over })
      render(<MetricsSessionSelector />)
      expect(screen.getByRole('button')).toHaveTextContent(label)
    })
  })
})
