/**
 * Tests for ProgramContext - verifying that the legacy localStorage migration
 * shim has been removed. Old stored values ('family', 'metrics') must NOT be
 * translated to new values ('weekend', 'analytics') — they should be treated
 * as invalid and fall back to null.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgramProvider, useProgram } from './ProgramContext'

function ProgramConsumer() {
  const { currentProgram } = useProgram()
  return <div data-testid="current-program">{currentProgram ?? 'null'}</div>
}

function renderWithStored(value: string | null) {
  vi.mocked(window.localStorage.getItem).mockReturnValue(value)
  return render(
    <ProgramProvider>
      <ProgramConsumer />
    </ProgramProvider>
  )
}

describe('ProgramContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('localStorage migration shim removal', () => {
    it('does NOT translate old "family" value to "weekend"', () => {
      renderWithStored('family')

      const current = screen.getByTestId('current-program').textContent
      expect(current).not.toBe('weekend')
      expect(current).toBe('null')
    })

    it('does NOT translate old "metrics" value to "analytics"', () => {
      renderWithStored('metrics')

      const current = screen.getByTestId('current-program').textContent
      expect(current).not.toBe('analytics')
      expect(current).toBe('null')
    })

    it('accepts current valid "summer" value', () => {
      renderWithStored('summer')

      expect(screen.getByTestId('current-program').textContent).toBe('summer')
    })

    it('accepts current valid "weekend" value', () => {
      renderWithStored('weekend')

      expect(screen.getByTestId('current-program').textContent).toBe('weekend')
    })

    it('accepts current valid "analytics" value', () => {
      renderWithStored('analytics')

      expect(screen.getByTestId('current-program').textContent).toBe('analytics')
    })

    it('returns null when localStorage is empty', () => {
      renderWithStored(null)

      expect(screen.getByTestId('current-program').textContent).toBe('null')
    })

    it('returns null for unknown stored values', () => {
      renderWithStored('unknown-program')

      expect(screen.getByTestId('current-program').textContent).toBe('null')
    })
  })
})
