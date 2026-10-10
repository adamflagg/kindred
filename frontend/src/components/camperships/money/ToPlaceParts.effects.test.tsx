import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EffectList } from './ToPlaceParts'

describe('EffectList withheld reasons', () => {
  it('draws each reason on its own line under the words', () => {
    render(
      <EffectList
        lines={[
          {
            sym: 'warn',
            lead: 'R1 not marked Posted',
            text: ': after the Oct 2 posting',
            items: ['the application was changed (Oct 8)', 'an outside grant was posted (Oct 8)'],
          },
        ]}
      />
    )
    const first = screen.getByText('· the application was changed (Oct 8)')
    const second = screen.getByText('· an outside grant was posted (Oct 8)')
    expect(first).toHaveClass('block')
    expect(second).toHaveClass('block')
    expect(first.parentElement).toBe(second.parentElement)
  })
})
