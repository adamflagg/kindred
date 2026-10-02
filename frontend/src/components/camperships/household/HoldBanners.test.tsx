import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ROW_LIAM } from '../requests/gridFixtures'
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
})
