import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AidNameChips, fitChips } from './NameChips'

describe('fitChips', () => {
  it('fits whole chips and keeps room for "+N" while some are left over', () => {
    // three chips of 80px, 4px gap, 34px reserved for "+N": 84 + 84 + 34 = 202 <= 210, a third would need 286
    expect(fitChips([80, 80, 80], 210, 5)).toBe(2)
  })
  it('needs no reserve when every name fits', () => {
    expect(fitChips([80, 80], 168, 2)).toBe(2)
  })
  it('shows none when not even one fits beside "+N" (review focus 5)', () => {
    expect(fitChips([120], 100, 4)).toBe(0)
  })
  it('never fits a later chip after an earlier one failed', () => {
    expect(fitChips([200, 10], 150, 2)).toBe(0)
  })
})

describe('AidNameChips', () => {
  it('renders every chip as a link with its title and days, then the count of the rest', () => {
    render(
      <MemoryRouter>
        <AidNameChips
          total={5}
          chips={[
            {
              key: '1',
              label: 'Garcia',
              days: 12,
              late: true,
              href: '/aid/households/1000002',
              title: 'Open the Garcia household · waiting 12 days',
            },
            {
              key: '2',
              label: 'Chen',
              days: 3,
              href: '/aid/households/1000003',
              title: 'Open the Chen household · waiting 3 days',
            },
          ]}
        />
      </MemoryRouter>
    )
    const garcia = screen.getByRole('link', { name: /Garcia/ })
    expect(garcia).toHaveAttribute('title', 'Open the Garcia household · waiting 12 days')
    expect(garcia).toHaveTextContent('Garcia12d')
    expect(screen.getByTestId('chips-more')).toHaveTextContent('+3') // jsdom measures 0px: every chip fits, 5 − 2 = 3
  })
})
