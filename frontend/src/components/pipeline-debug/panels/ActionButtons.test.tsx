/**
 * Tests for ActionButtons — dry-run-only phase replay buttons.
 *
 * Verifies:
 * - Renders "Rerun this phase" (not "Run Again")
 * - Does NOT render a "Write to production" checkbox or confirmation dialog
 * - Clicking "Rerun this phase" calls onRerunPhase exactly once
 * - Clicking "Run From Here" calls onRunFromHere with no arguments
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ActionButtons } from './ActionButtons'

describe('ActionButtons', () => {
  it('renders "Rerun this phase" button (not "Run Again")', () => {
    render(<ActionButtons onRerunPhase={vi.fn()} onRunFromHere={vi.fn()} />)
    expect(screen.getByRole('button', { name: /rerun this phase/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run again$/i })).not.toBeInTheDocument()
  })

  it('renders "Run From Here" button', () => {
    render(<ActionButtons onRerunPhase={vi.fn()} onRunFromHere={vi.fn()} />)
    expect(screen.getByRole('button', { name: /run from here/i })).toBeInTheDocument()
  })

  it('does NOT render a "Write to production" checkbox', () => {
    render(<ActionButtons onRerunPhase={vi.fn()} onRunFromHere={vi.fn()} />)
    expect(screen.queryByLabelText(/write to production/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/write to production/i)).not.toBeInTheDocument()
  })

  it('does NOT render a confirmation dialog', () => {
    render(<ActionButtons onRerunPhase={vi.fn()} onRunFromHere={vi.fn()} />)
    expect(screen.queryByText(/confirm production write/i)).not.toBeInTheDocument()
  })

  it('clicking "Rerun this phase" calls onRerunPhase exactly once', async () => {
    const onRerunPhase = vi.fn()
    const user = userEvent.setup()
    render(<ActionButtons onRerunPhase={onRerunPhase} onRunFromHere={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /rerun this phase/i }))
    expect(onRerunPhase).toHaveBeenCalledTimes(1)
  })

  it('clicking "Run From Here" calls onRunFromHere exactly once (no writeToProduction arg)', async () => {
    const onRunFromHere = vi.fn()
    const user = userEvent.setup()
    render(<ActionButtons onRerunPhase={vi.fn()} onRunFromHere={onRunFromHere} />)
    await user.click(screen.getByRole('button', { name: /run from here/i }))
    expect(onRunFromHere).toHaveBeenCalledTimes(1)
    // The handler must no longer forward a writeToProduction boolean.
    const firstArg = onRunFromHere.mock.calls[0]?.[0]
    expect(typeof firstArg).not.toBe('boolean')
  })

  it('disables both buttons when isRunning=true', () => {
    render(<ActionButtons onRerunPhase={vi.fn()} onRunFromHere={vi.fn()} isRunning={true} />)
    expect(screen.getByRole('button', { name: /rerun this phase/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /run from here/i })).toBeDisabled()
  })
})
