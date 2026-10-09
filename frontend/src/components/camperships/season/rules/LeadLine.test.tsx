/**
 * The chapter bar's lead slot (final mock season-rules.html: lead()). ONE row, ~36px, in every state: the receipt
 * line is 12px words and a 12px link, never the 16px wrapping link; the discard question asks inline.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { LeadLine, type LeadState } from './LeadLine'

const RECEIPT: LeadState = {
  kind: 'receipt',
  words: 'Rules v3 · approved Oct 8, 2026',
  version: 3,
  backHref: '/aid/season/rules?year=2027',
}

const FINANCE: LeadState = {
  kind: 'finance',
  show: 'draft',
  draftVersion: 4,
  approvedVersion: 3,
  hold: null,
  draftHref: '/d',
  approvedHref: '/a',
}

function lead(state: LeadState, props: Partial<Parameters<typeof LeadLine>[0]> = {}) {
  return render(
    <MemoryRouter>
      <LeadLine state={state} onAll={vi.fn()} {...props} />
    </MemoryRouter>
  )
}

describe('the receipt line (owner item 13)', () => {
  it('reads "Rules v3 · approved Oct 8, 2026" as a 12px status whose title says which version this is', () => {
    lead(RECEIPT)
    const status = screen.getByText('Rules v3 · approved Oct 8, 2026')
    expect(status).toHaveAttribute(
      'title',
      "You came from a receipt: this is rules v3 exactly as it was approved on Oct 8, 2026, the version that priced it. Later approvals don't change it."
    )
    expect(status).toHaveClass('text-[12.5px]')
  })

  it('offers "Back to the rules in effect ›" as a small link, not the 16px "The Rules as They Price the Season ›"', () => {
    lead(RECEIPT)
    const back = screen.getByRole('link', { name: 'Back to the rules in effect ›' })
    expect(back).toHaveAttribute('href', '/aid/season/rules?year=2027')
    expect(back).toHaveAttribute('title', 'Back to Season › Rules as it prices the season today')
    expect(back).toHaveClass('text-xs')
    expect(back).not.toHaveClass('text-[13.5px]')
    expect(screen.queryByText(/They Price the Season/)).toBeNull()
  })

  it('stays on one row: nothing wraps, and Open All / Close All sit after the link', () => {
    lead(RECEIPT)
    const row = screen.getByText('Rules v3 · approved Oct 8, 2026').parentElement as HTMLElement
    expect(row).not.toHaveClass('flex-wrap')
    expect(row).toHaveClass('flex-nowrap')
    expect(within(row).getByRole('button', { name: 'Open All' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Close All' })).toBeInTheDocument()
  })

  it("gives the registrar's line the same one-row treatment", () => {
    lead({ kind: 'registrar', version: 3 })
    const status = screen.getByText('The approved rules: v3, in effect and frozen.')
    expect(status.parentElement).not.toHaveClass('flex-wrap')
    expect(status).toHaveAttribute('title')
  })
})

describe('the discard question, inline on the bar (mock P.discardAsk)', () => {
  it('replaces the status with a warning question and steps Open All / Close All aside', () => {
    lead(FINANCE, {
      asking: true,
      children: (
        <>
          <button type="button">Discard</button>
          <button type="button">Keep</button>
        </>
      ),
    })
    expect(screen.getByText('Discard v4? Changes since v3 are lost.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open All' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close All' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()
  })

  it('shows the frozen fact and the folds when nothing is being asked', async () => {
    const onAll = vi.fn()
    lead(FINANCE, { onAll })
    expect(screen.getByText('v3 is frozen · approving puts v4 in effect')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open All' }))
    expect(onAll).toHaveBeenCalledWith(true)
  })
})

describe('holds name themselves on the switch (mock hold())', () => {
  it('titles the greyed Draft | In effect switch "Save or cancel the edit first." while a card is edited', () => {
    lead({ ...FINANCE, hold: 'edit' })
    const draft = screen.getByText('Draft v4')
    expect(draft).toHaveAttribute('title', 'Save or cancel the edit first.')
    expect(screen.getByText('v3 in effect')).toHaveAttribute(
      'title',
      'Save or cancel the edit first.'
    )
  })
})
