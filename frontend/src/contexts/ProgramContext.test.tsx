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

describe('ProgramContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('localStorage migration shim removal', () => {
    it('does NOT translate old "family" value to "weekend"', () => {
      vi.mocked(window.localStorage.getItem).mockReturnValue('family')

      render(
        <ProgramProvider>
          <ProgramConsumer />
        </ProgramProvider>
      )

      const current = screen.getByTestId('current-program').textContent
      expect(current).not.toBe('weekend')
      expect(current).toBe('null')
    })

    it('does NOT translate old "metrics" value to "analytics"', () => {
      vi.mocked(window.localStorage.getItem).mockReturnValue('metrics')

      render(
        <ProgramProvider>
          <ProgramConsumer />
        </ProgramProvider>
      )

      const current = screen.getByTestId('current-program').textContent
      expect(current).not.toBe('analytics')
      expect(current).toBe('null')
    })

    it('accepts current valid "summer" value', () => {
      vi.mocked(window.localStorage.getItem).mockReturnValue('summer')

      render(
        <ProgramProvider>
          <ProgramConsumer />
        </ProgramProvider>
      )

      expect(screen.getByTestId('current-program').textContent).toBe('summer')
    })

    it('accepts current valid "weekend" value', () => {
      vi.mocked(window.localStorage.getItem).mockReturnValue('weekend')

      render(
        <ProgramProvider>
          <ProgramConsumer />
        </ProgramProvider>
      )

      expect(screen.getByTestId('current-program').textContent).toBe('weekend')
    })

    it('accepts current valid "analytics" value', () => {
      vi.mocked(window.localStorage.getItem).mockReturnValue('analytics')

      render(
        <ProgramProvider>
          <ProgramConsumer />
        </ProgramProvider>
      )

      expect(screen.getByTestId('current-program').textContent).toBe('analytics')
    })

    it('returns null when localStorage is empty', () => {
      vi.mocked(window.localStorage.getItem).mockReturnValue(null)

      render(
        <ProgramProvider>
          <ProgramConsumer />
        </ProgramProvider>
      )

      expect(screen.getByTestId('current-program').textContent).toBe('null')
    })

    it('returns null for unknown stored values', () => {
      vi.mocked(window.localStorage.getItem).mockReturnValue('unknown-program')

      render(
        <ProgramProvider>
          <ProgramConsumer />
        </ProgramProvider>
      )

      expect(screen.getByTestId('current-program').textContent).toBe('null')
    })
  })
})
