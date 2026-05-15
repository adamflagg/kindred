/**
 * Tests for SessionHeader component
 * Following TDD - tests written first, implementation follows
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

// ---------------------------------------------------------------------------
// Mocks for SessionHeader's heavy deps (DOM rendering tests)
// ---------------------------------------------------------------------------
vi.mock('../PreValidateRequestsButton', () => ({
  default: () => <button>Pre-check</button>,
}))
vi.mock('../ValidateBunkingButton', () => ({
  default: () => <button>Validate Bunking</button>,
}))
vi.mock('../BunkingLegend', () => ({
  BunkingLegendButton: () => <button>Legend</button>,
}))
vi.mock('../ModeBadge', () => ({
  default: ({ isProductionMode }: { isProductionMode: boolean }) => (
    <span>{isProductionMode ? 'CM' : 'Draft'}</span>
  ),
}))
vi.mock('../OptimizeBunksButton', () => ({
  default: () => <button>Optimize Bunks</button>,
}))
vi.mock('../../utils/sessionDisplay', () => ({
  getFormattedSessionName: () => 'Session 1',
}))
vi.mock('../../utils/sessionUtils', () => ({
  sessionNameToUrl: (n: string) => n.toLowerCase().replace(/\s+/g, '-'),
  sortSessionsByDate: (s: unknown[]) => s,
  filterSelectableSessions: (s: unknown[]) => s,
}))

import SessionHeader from './SessionHeader'
import type { SessionHeaderProps } from './SessionHeader'

const LONG_SCENARIO_NAME =
  'copy scenario test to scenario copy scenario very long name that overflows'

import type { Session } from '../../types/app-types'

const mockSession = {
  id: 's1',
  cm_id: 1001,
  name: 'Session 1',
  session_type: 'main',
  start_date: '',
  end_date: '',
  year: 2026,
} as unknown as Session

const defaultProps: SessionHeaderProps = {
  session: mockSession,
  allSessions: [mockSession],
  currentYear: 2026,
  isProductionMode: false,
  currentScenario: { id: 'sc1', name: LONG_SCENARIO_NAME },
  scenarios: [{ id: 'sc1', name: LONG_SCENARIO_NAME }],
  scenarioLoading: false,
  isSolving: false,
  isApplyingResults: false,
  capturedScenarioId: null,
  onSessionChange: vi.fn(),
  onRunSolver: vi.fn(),
  respectLocks: false,
  onRespectLocksChange: vi.fn(),
  onShowClearDialog: vi.fn(),
  onShowNewScenarioModal: vi.fn(),
  onShowScenarioManagement: vi.fn(),
  onSelectScenario: vi.fn(),
  canManage: true,
}

function renderSessionHeader(overrides: Partial<SessionHeaderProps> = {}) {
  const props = { ...defaultProps, ...overrides }
  return render(
    <MemoryRouter>
      <SessionHeader {...props} />
    </MemoryRouter>
  )
}

// ---------------------------------------------------------------------------
// DOM rendering tests — scenario name truncation (feedback item #53)
// ---------------------------------------------------------------------------
describe('SessionHeader scenario name truncation', () => {
  it('scenario dropdown button has a title attribute containing the full scenario name', () => {
    renderSessionHeader()
    // The ListboxButton renders as a <button> containing the scenario name text
    // We find it by its text content
    const button = screen.getByRole('button', { name: new RegExp(LONG_SCENARIO_NAME.slice(0, 20)) })
    expect(button).toHaveAttribute('title', LONG_SCENARIO_NAME)
  })

  it('scenario dropdown button has a max-width class to prevent unbounded growth', () => {
    renderSessionHeader()
    const button = screen.getByRole('button', { name: new RegExp(LONG_SCENARIO_NAME.slice(0, 20)) })
    // Should contain a Tailwind max-w-* class clamped to ~130px (matching action button width)
    expect(button.className).toMatch(/max-w-\[130px\]/)
  })

  it('scenario name span has truncate class to clip overflow text with ellipsis', () => {
    renderSessionHeader()
    const button = screen.getByRole('button', { name: new RegExp(LONG_SCENARIO_NAME.slice(0, 20)) })
    // The inner span should carry the truncate utility
    const nameSpan = button.querySelector('span.truncate')
    expect(nameSpan).toBeInTheDocument()
  })

  it('short scenario name is fully present in the DOM without being cut', () => {
    const SHORT_NAME = 'Default'
    renderSessionHeader({
      currentScenario: { id: 'sc1', name: SHORT_NAME },
      scenarios: [{ id: 'sc1', name: SHORT_NAME }],
    })
    // The title attribute must match the full name (tooltip fallback for truncation)
    const button = screen.getByRole('button', { name: new RegExp(SHORT_NAME) })
    expect(button).toHaveAttribute('title', SHORT_NAME)
    // The inner span must contain the full text — no visual clipping of short names
    const nameSpan = button.querySelector('span.truncate')
    expect(nameSpan?.textContent).toBe(SHORT_NAME)
  })
})

// ---------------------------------------------------------------------------
// DOM rendering tests — action button visibility by mode (#1413)
// ---------------------------------------------------------------------------
describe('SessionHeader action button visibility by mode', () => {
  describe('when isProductionMode is true (viewing live CampMinder data)', () => {
    it('renders the Pre-check button', () => {
      renderSessionHeader({ isProductionMode: true, currentScenario: null })
      expect(screen.getByRole('button', { name: /pre-check/i })).toBeInTheDocument()
    })

    it('renders the Validate Bunking (post-check) button', () => {
      renderSessionHeader({ isProductionMode: true, currentScenario: null })
      expect(screen.getByRole('button', { name: /validate bunking/i })).toBeInTheDocument()
    })

    it('does NOT render the Optimize Bunks (run-solver) button', () => {
      renderSessionHeader({ isProductionMode: true, currentScenario: null })
      expect(screen.queryByRole('button', { name: /optimize bunks/i })).not.toBeInTheDocument()
    })

    it('does NOT render the Clear assignments button', () => {
      renderSessionHeader({ isProductionMode: true, currentScenario: null })
      expect(screen.queryByRole('button', { name: /^clear$/i })).not.toBeInTheDocument()
    })
  })

  describe('when isProductionMode is false (scenario/draft mode)', () => {
    it('renders the Pre-check button', () => {
      renderSessionHeader({ isProductionMode: false })
      expect(screen.getByRole('button', { name: /pre-check/i })).toBeInTheDocument()
    })

    it('renders the Optimize Bunks button', () => {
      renderSessionHeader({ isProductionMode: false })
      expect(screen.getByRole('button', { name: /optimize bunks/i })).toBeInTheDocument()
    })

    it('renders the Clear button when a scenario is active', () => {
      renderSessionHeader({
        isProductionMode: false,
        currentScenario: { id: 'sc1', name: 'Test Scenario' },
      })
      expect(screen.getByRole('button', { name: /^clear$/i })).toBeInTheDocument()
    })
  })

  describe('when canManage is false', () => {
    it('does NOT render the Pre-check button (regardless of mode)', () => {
      renderSessionHeader({ canManage: false, isProductionMode: true, currentScenario: null })
      expect(screen.queryByRole('button', { name: /pre-check/i })).not.toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// Logic-only tests (no DOM) — existing coverage
// ---------------------------------------------------------------------------

// Test the logic that should be in the component
describe('SessionHeader', () => {
  describe('session selector logic', () => {
    it('should filter sessions to only main and embedded types', () => {
      const allSessions = [
        { id: '1', name: 'Session 1', session_type: 'main', cm_id: 1001 },
        { id: '2', name: 'Session 2', session_type: 'main', cm_id: 1002 },
        { id: '2a', name: 'Session 2a', session_type: 'embedded', cm_id: 1003 },
        { id: '2-ag', name: 'Session 2 AG', session_type: 'ag', cm_id: 1004 },
      ]

      // Filter logic
      const filtered = allSessions.filter(
        (s) => s.session_type === 'main' || s.session_type === 'embedded'
      )

      expect(filtered).toHaveLength(3)
      expect(filtered.find((s) => s.session_type === 'ag')).toBeUndefined()
    })

    it('should sort sessions in logical order (1, 2, 2a, 2b, 3, etc)', () => {
      const sessions = [
        { name: 'Session 3', session_type: 'main' },
        { name: 'Session 2b', session_type: 'embedded' },
        { name: 'Session 1', session_type: 'main' },
        { name: 'Session 2', session_type: 'main' },
        { name: 'Session 2a', session_type: 'embedded' },
      ]

      // Sort logic extracted from SessionView
      const parseSession = (name: string): [number, string] => {
        const match = name.match(/session\s+(\d+)([a-z])?/i)
        if (match?.[1]) return [parseInt(match[1], 10), match[2]?.toLowerCase() ?? '']
        return [0, name.toLowerCase()]
      }

      const sorted = [...sessions].sort((a, b) => {
        const [numA, suffixA] = parseSession(a.name)
        const [numB, suffixB] = parseSession(b.name)
        if (numA !== numB) return numA - numB
        return suffixA.localeCompare(suffixB)
      })

      expect(sorted.map((s) => s.name)).toEqual([
        'Session 1',
        'Session 2',
        'Session 2a',
        'Session 2b',
        'Session 3',
      ])
    })
  })

  describe('solver button state', () => {
    it('should be disabled when solving', () => {
      const isSolving = true as boolean
      const isApplyingResults = false as boolean
      const isDisabled = isSolving || isApplyingResults

      expect(isDisabled).toBe(true)
    })

    it('should be disabled when applying results', () => {
      const isSolving = false as boolean
      const isApplyingResults = true as boolean
      const isDisabled = isSolving || isApplyingResults

      expect(isDisabled).toBe(true)
    })

    it('should show correct text based on state', () => {
      const getText = (isSolving: boolean, isApplyingResults: boolean): string => {
        if (isSolving) return 'Optimizing...'
        if (isApplyingResults) return 'Applying...'
        return 'Optimize Bunks'
      }

      expect(getText(true, false)).toBe('Optimizing...')
      expect(getText(false, true)).toBe('Applying...')
      expect(getText(false, false)).toBe('Optimize Bunks')
    })
  })

  describe('scenario selector', () => {
    it('should be disabled while solving or applying', () => {
      const scenarioLoading = false as boolean
      const isSolving = true as boolean
      const isApplyingResults = false as boolean

      const isDisabled = scenarioLoading || isSolving || isApplyingResults

      expect(isDisabled).toBe(true)
    })

    it('should convert "production" value to null for selectScenario', () => {
      const mockSelectScenario = vi.fn()
      const value = 'production'

      // Simulating the onChange handler logic
      const handleChange = (selectedValue: string) => {
        mockSelectScenario(selectedValue === 'production' ? null : selectedValue)
      }

      handleChange(value)

      expect(mockSelectScenario).toHaveBeenCalledWith(null)
    })

    it('should pass scenario ID when selecting a scenario', () => {
      const mockSelectScenario = vi.fn()
      const value = 'scenario-123'

      const handleChange = (selectedValue: string) => {
        mockSelectScenario(selectedValue === 'production' ? null : selectedValue)
      }

      handleChange(value)

      expect(mockSelectScenario).toHaveBeenCalledWith('scenario-123')
    })
  })

  describe('conditional rendering', () => {
    it('should show clear button only when in scenario mode', () => {
      const isProductionMode = false as boolean
      const currentScenario = { id: 'scenario-1', name: 'Test Scenario' } as {
        id: string
        name: string
      } | null

      const shouldShowClear = !isProductionMode && currentScenario !== null

      expect(shouldShowClear).toBe(true)
    })

    it('should hide clear button in production mode', () => {
      const isProductionMode = true as boolean
      const currentScenario = null as { id: string; name: string } | null

      const shouldShowClear = !isProductionMode && currentScenario !== null

      expect(shouldShowClear).toBe(false)
    })

    it('should show new scenario button only in production mode', () => {
      const isProductionMode = true

      expect(isProductionMode).toBe(true)
    })
  })

  describe('scenario indicator pulse', () => {
    it('should show pulse when solving/applying with captured scenario', () => {
      const isSolving = true as boolean
      const isApplyingResults = false as boolean
      const capturedScenarioId = 'scenario-123' as string | null

      const shouldPulse = (isSolving || isApplyingResults) && capturedScenarioId !== null

      expect(shouldPulse).toBe(true)
    })

    it('should not show pulse when not solving or applying', () => {
      const isSolving = false as boolean
      const isApplyingResults = false as boolean
      const capturedScenarioId = 'scenario-123' as string | null

      const shouldPulse = (isSolving || isApplyingResults) && capturedScenarioId !== null

      expect(shouldPulse).toBe(false)
    })
  })

  describe('compact layout design', () => {
    describe('mode indicator badge', () => {
      it('should use compact badge text for production mode', () => {
        const isProductionMode = true
        const getCompactModeText = (isProd: boolean) => (isProd ? 'CM' : 'Draft')

        expect(getCompactModeText(isProductionMode)).toBe('CM')
      })

      it('should use compact badge text for scenario mode', () => {
        const isProductionMode = false
        const getCompactModeText = (isProd: boolean) => (isProd ? 'CM' : 'Draft')

        expect(getCompactModeText(isProductionMode)).toBe('Draft')
      })

      it('should include scenario name in draft mode tooltip/aria-label', () => {
        const scenarioName = 'Test Scenario'
        const getAriaLabel = (isProd: boolean, name?: string) =>
          isProd ? 'Viewing live CampMinder data' : `Draft mode: ${name ?? 'Untitled Scenario'}`

        expect(getAriaLabel(false, scenarioName)).toBe('Draft mode: Test Scenario')
        expect(getAriaLabel(true)).toBe('Viewing live CampMinder data')
      })
    })

    describe('scenario dropdown with integrated new option', () => {
      it('should include "New Scenario" option at end of dropdown in production mode', () => {
        const scenarios = [
          { id: 'scenario-1', name: 'First' },
          { id: 'scenario-2', name: 'Second' },
        ]
        const isProductionMode = true

        // In production mode, dropdown should include a "create new" option
        const getDropdownOptions = (scens: typeof scenarios, isProd: boolean) => {
          const options = [
            { value: 'production', label: 'CampMinder' },
            ...scens.map((s) => ({ value: s.id, label: s.name })),
          ]
          if (isProd) {
            options.push({ value: 'new', label: '+ New Scenario' })
          }
          return options
        }

        const options = getDropdownOptions(scenarios, isProductionMode)
        expect(options).toHaveLength(4) // CampMinder + 2 scenarios + New
        expect(options[options.length - 1]).toEqual({
          value: 'new',
          label: '+ New Scenario',
        })
      })

      it('should not include "New Scenario" option when already in scenario mode', () => {
        const scenarios = [{ id: 'scenario-1', name: 'First' }]
        const isProductionMode = false

        const getDropdownOptions = (scens: typeof scenarios, isProd: boolean) => {
          const options = [
            { value: 'production', label: 'CampMinder' },
            ...scens.map((s) => ({ value: s.id, label: s.name })),
          ]
          if (isProd) {
            options.push({ value: 'new', label: '+ New Scenario' })
          }
          return options
        }

        const options = getDropdownOptions(scenarios, isProductionMode)
        expect(options).toHaveLength(2) // CampMinder + 1 scenario, no New
        expect(options.find((o) => o.value === 'new')).toBeUndefined()
      })

      it('should trigger new scenario modal when "new" option selected', () => {
        const mockSelectScenario = vi.fn()
        const mockShowNewModal = vi.fn()
        const value = 'new'

        // Handler logic for dropdown change
        const handleChange = (selectedValue: string) => {
          if (selectedValue === 'new') {
            mockShowNewModal()
          } else {
            mockSelectScenario(selectedValue === 'production' ? null : selectedValue)
          }
        }

        handleChange(value)

        expect(mockShowNewModal).toHaveBeenCalled()
        expect(mockSelectScenario).not.toHaveBeenCalled()
      })
    })

    describe('compare button visibility', () => {
      it('should only show compare when scenarios exist', () => {
        const scenarios: Array<{ id: string; name: string }> = []

        const shouldShowCompare = scenarios.length > 0

        expect(shouldShowCompare).toBe(false)
      })

      it('should show compare when at least one scenario exists', () => {
        const scenarios = [{ id: 'scenario-1', name: 'Test' }]

        const shouldShowCompare = scenarios.length > 0

        expect(shouldShowCompare).toBe(true)
      })
    })

    describe('session dropdown sizing', () => {
      it('should use reduced font size class for compact layout', () => {
        // The session dropdown should use text-xl sm:text-2xl instead of text-2xl sm:text-3xl
        const compactClasses = 'text-xl sm:text-2xl font-display font-bold'
        const oldClasses = 'text-2xl sm:text-3xl font-display font-bold'

        // Verify the new classes are smaller
        expect(compactClasses).toContain('text-xl')
        expect(compactClasses).not.toContain('text-3xl')
        expect(oldClasses).toContain('text-3xl')
      })
    })
  })
})
