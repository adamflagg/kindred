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
    // Pin changed (ux3 to-place-m1): the "·" is its own 10px box so a wrapped reason hangs under its words; the
    // reason's block still carries the dot and the words (it was one "· words" text node).
    const first = screen.getByText('the application was changed (Oct 8)').closest('span.block')
    const second = screen.getByText('an outside grant was posted (Oct 8)').closest('span.block')
    expect(first).toHaveTextContent('·the application was changed (Oct 8)')
    expect(second).toHaveTextContent('·an outside grant was posted (Oct 8)')
    expect(first?.parentElement).toBe(second?.parentElement)
  })
})
