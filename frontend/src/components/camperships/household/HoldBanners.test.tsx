import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { gridRow, ROW_LIAM } from '../requests/gridFixtures'
import { householdPage, householdRequest } from './householdFixtures'
import { HoldBanners } from './HoldBanners'

describe('HoldBanners (§6.3 item 3)', () => {
  it("names each hold by its words, its camper and the server's message", () => {
    render(<HoldBanners page={householdPage({ requests: [householdRequest(ROW_LIAM)] })} />)
    expect(screen.getByText('Placeholder income')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    expect(screen.getByText(/Income was entered as \$1/)).toBeInTheDocument()
  })

  it('draws nothing with no hold', () => {
    const { container } = render(<HoldBanners page={householdPage()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('words the codes the engine raises, from the server meaning (M2)', () => {
    const cases: Array<[string, string]> = [
      ['income_missing', 'Income missing'],
      ['income_below_first_band', 'Income below first band'],
      ['cost_unknown', 'Cost unknown'],
      ['ask_missing', 'Ask missing'],
      ['no_round1_table', 'No Round 1 table'],
      ['rules_error', 'Rules error'],
      ['unknown_program', 'Program not in the rules'],
      ['program_closed', 'Program closed to aid'],
      ['unknown_decision_type', 'Decision type not in the rules'],
    ]
    for (const [code, words] of cases) {
      const row = gridRow({ holds: [{ code, severity: 'hold', message: 'm' }] })
      const { unmount } = render(
        <HoldBanners page={householdPage({ requests: [householdRequest(row)] })} />
      )
      expect(screen.getByText(words)).toBeInTheDocument()
      unmount()
    }
  })

  it('keeps two holds with one code on one request apart (M1)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const row = gridRow({
      holds: [
        { code: 'cost_unknown', severity: 'hold', message: 'first' },
        { code: 'cost_unknown', severity: 'hold', message: 'second' },
      ],
    })
    render(<HoldBanners page={householdPage({ requests: [householdRequest(row)] })} />)
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it("puts each hold's actions under it when handed in (M7)", () => {
    render(
      <HoldBanners
        page={householdPage({ requests: [householdRequest(ROW_LIAM)] })}
        actions={(request, code) => (
          <button type="button">{`fix ${code} for ${request.row.camper_name}`}</button>
        )}
      />
    )
    expect(
      screen.getByRole('button', { name: 'fix placeholder_income for Liam Garcia' })
    ).toBeInTheDocument()
  })
})
