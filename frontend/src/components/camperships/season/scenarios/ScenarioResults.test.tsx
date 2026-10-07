import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MINUS } from '../../kit/money'
import { results } from './scenarioFixtures'
import { ScenarioResults } from './ScenarioResults'

describe('ScenarioResults (spec §8.3)', () => {
  it("reads a pool's negative Remaining in amber, never red", () => {
    const base = results(700000)
    const [a, b] = base.pools
    render(
      <ScenarioResults
        results={{ ...base, pools: [a!, { ...b!, remaining: -1017 }] }}
        state="recorded"
      />
    )
    expect(screen.getByText(`${MINUS}$1,017`)).toHaveClass('text-amber-700')
  })
})
