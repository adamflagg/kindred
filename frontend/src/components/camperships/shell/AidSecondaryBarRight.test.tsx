import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AidSecondaryBarRight } from './AidSecondaryBarRight'

let granted: string[] = []
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('./RemainingLine', () => ({ RemainingLine: () => <div data-testid="remaining" /> }))
vi.mock('./JumpBox', () => ({ JumpBox: () => <div data-testid="jump-box" /> }))

describe('AidSecondaryBarRight (§3.4)', () => {
  it('gives a view holder the Remaining line and the jump box', () => {
    granted = ['financial_aid.view']
    render(<AidSecondaryBarRight />)
    expect(screen.getByTestId('remaining')).toBeInTheDocument()
    expect(screen.getByTestId('jump-box')).toBeInTheDocument()
  })

  it('gives a summary-only user the Remaining line and no jump box (D65, D75)', () => {
    granted = ['financial_aid.summary']
    render(<AidSecondaryBarRight />)
    expect(screen.getByTestId('remaining')).toBeInTheDocument()
    expect(screen.queryByTestId('jump-box')).toBeNull()
  })

  it('keeps a gap from the sync stamps on its left, so "…hours ago" never runs into "Remaining"', () => {
    granted = ['financial_aid.view']
    render(<AidSecondaryBarRight />)
    expect(screen.getByTestId('remaining').parentElement).toHaveClass('ml-4')
  })

  it('draws nothing for someone who cannot open Camperships', () => {
    granted = []
    const { container } = render(<AidSecondaryBarRight />)
    expect(container).toBeEmptyDOMElement()
  })
})
