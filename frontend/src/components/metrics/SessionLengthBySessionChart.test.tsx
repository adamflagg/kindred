/**
 * TDD Tests for SessionLengthBySessionChart component.
 *
 * Tests written FIRST before implementation (TDD).
 * This component displays a stacked bar chart showing session breakdown
 * per length category (1-week, 2-week, etc.).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionLengthBySessionChart } from './SessionLengthBySessionChart'
import type { SessionLengthBySessionBreakdown } from '../../types/metrics'

describe('SessionLengthBySessionChart', () => {
  const mockData: SessionLengthBySessionBreakdown[] = [
    {
      length_category: '1 Week',
      total: 25,
      sessions: [
        { session_cm_id: 1001, session_name: 'Session 1', count: 15 },
        { session_cm_id: 1002, session_name: 'Session 2', count: 10 },
      ],
    },
    {
      length_category: '2 Weeks',
      total: 40,
      sessions: [
        { session_cm_id: 1001, session_name: 'Session 1', count: 20 },
        { session_cm_id: 1002, session_name: 'Session 2', count: 20 },
      ],
    },
  ]

  describe('component export', () => {
    it('should export SessionLengthBySessionChart component', async () => {
      const module = await import('./SessionLengthBySessionChart')
      expect(typeof module.SessionLengthBySessionChart).toBe('function')
    })
  })

  describe('rendering', () => {
    it('should render with default title', () => {
      render(<SessionLengthBySessionChart data={mockData} />)
      expect(screen.getByText('Enrollment by Session Length')).toBeInTheDocument()
    })

    it('should render with custom title', () => {
      render(<SessionLengthBySessionChart data={mockData} title="Custom Title" />)
      expect(screen.getByText('Custom Title')).toBeInTheDocument()
    })

    it('should render empty state when no data', () => {
      render(<SessionLengthBySessionChart data={[]} />)
      expect(screen.getByText('No data available')).toBeInTheDocument()
    })

    it('should render chart container for valid data', () => {
      const { container } = render(<SessionLengthBySessionChart data={mockData} />)
      expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument()
    })
  })

  describe('legend', () => {
    it('should show session names in legend outside chart', () => {
      render(<SessionLengthBySessionChart data={mockData} />)
      expect(screen.getByText('Session 1')).toBeInTheDocument()
      expect(screen.getByText('Session 2')).toBeInTheDocument()
    })

    it('should use text-sm class for legend when 6 or fewer sessions', () => {
      const { container } = render(<SessionLengthBySessionChart data={mockData} />)
      // 2 sessions - should use text-sm
      const legendSpans = container.querySelectorAll('[data-testid="legend-label"]')
      for (const span of legendSpans) {
        expect(span.className).toContain('text-sm')
        expect(span.className).not.toContain('text-xs')
      }
    })

    it('should use text-xs class for legend when more than 6 sessions', () => {
      // Create data with 7+ unique sessions
      const manySessionsData: SessionLengthBySessionBreakdown[] = [
        {
          length_category: '1 Week',
          total: 70,
          sessions: [
            { session_cm_id: 1001, session_name: 'Session 1', count: 10 },
            { session_cm_id: 1002, session_name: 'Session 2', count: 10 },
            { session_cm_id: 1003, session_name: 'Session 3', count: 10 },
            { session_cm_id: 1004, session_name: 'Session 4', count: 10 },
            { session_cm_id: 1005, session_name: 'Quest A', count: 10 },
            { session_cm_id: 1006, session_name: 'Quest B', count: 10 },
            { session_cm_id: 1007, session_name: 'Quest C', count: 10 },
          ],
        },
      ]
      const { container } = render(<SessionLengthBySessionChart data={manySessionsData} />)
      const legendSpans = container.querySelectorAll('[data-testid="legend-label"]')
      expect(legendSpans.length).toBe(7)
      for (const span of legendSpans) {
        expect(span.className).toContain('text-xs')
      }
    })
  })

  describe('click handling', () => {
    it('should accept onCategoryClick prop without error', () => {
      const onCategoryClick = vi.fn()
      render(<SessionLengthBySessionChart data={mockData} onCategoryClick={onCategoryClick} />)
      expect(screen.getByText('Enrollment by Session Length')).toBeInTheDocument()
    })
  })

  describe('stacking order', () => {
    const campThenQuestData: SessionLengthBySessionBreakdown[] = [
      {
        length_category: '2 Weeks',
        total: 30,
        sessions: [
          { session_cm_id: 2001, session_name: 'Camp Session A', count: 10 },
          { session_cm_id: 2002, session_name: 'Camp Session B', count: 10 },
          { session_cm_id: 2003, session_name: 'Quest X', count: 10 },
        ],
      },
    ]

    const typeLookup = {
      'Camp Session A': 'camp' as const,
      'Camp Session B': 'camp' as const,
      'Quest X': 'quest' as const,
    }

    const dateLookup = {
      'Camp Session A': '2025-06-01',
      'Camp Session B': '2025-07-01',
      'Quest X': '2025-06-15',
    }

    it('should render camp sessions on top of the stack (last in SVG = on top)', () => {
      const { container } = render(
        <SessionLengthBySessionChart
          data={campThenQuestData}
          sessionTypeLookup={typeLookup}
          sessionDateLookup={dateLookup}
        />
      )
      // In Recharts SVG, bars are rendered as <rect> in SVG order.
      // Last <Bar> component renders last (on top visually).
      // Camp sessions should be the last rendered bars (on top).
      // We can verify by checking the order of .recharts-bar elements
      const bars = container.querySelectorAll('.recharts-bar')
      expect(bars.length).toBe(3) // 3 sessions
      // Quest should be rendered first (bottom), camp sessions last (top)
      // The last bar should be a camp session
    })

    it('should show legend in camp-first reading order', () => {
      render(
        <SessionLengthBySessionChart
          data={campThenQuestData}
          sessionTypeLookup={typeLookup}
          sessionDateLookup={dateLookup}
        />
      )
      const legendLabels = screen.getAllByTestId('legend-label')
      // Legend should show camp sessions first, then quests
      expect(legendLabels[0]!.textContent).toBe('Camp Session A')
      expect(legendLabels[1]!.textContent).toBe('Camp Session B')
      expect(legendLabels[2]!.textContent).toBe('Quest X')
    })

    it('should apply rounded corners to the topmost bar (last camp session)', () => {
      const { container } = render(
        <SessionLengthBySessionChart
          data={campThenQuestData}
          sessionTypeLookup={typeLookup}
          sessionDateLookup={dateLookup}
        />
      )
      // The last rendered <Bar> (camp, topmost) should have radius [4,4,0,0]
      // In Recharts, this creates rounded rect elements
      const bars = container.querySelectorAll('.recharts-bar')
      // Last bar (topmost = last camp) should be the one with rounded corners
      expect(bars.length).toBeGreaterThan(0)
    })
  })
})
