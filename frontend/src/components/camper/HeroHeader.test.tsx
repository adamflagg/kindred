import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { Camper } from '../../types/app-types'
import { HeroHeader } from './HeroHeader'

const camper = {
  id: '3000001:s1',
  name: 'Emma Johnson',
  first_name: 'Emma',
  last_name: 'Johnson',
  person_cm_id: 3000001,
  gender: 'F',
  grade: 0,
  age: 43.01,
  years_at_camp: 0,
} as unknown as Camper

function renderHero(extra: Partial<Parameters<typeof HeroHeader>[0]> = {}) {
  return render(
    <MemoryRouter>
      <HeroHeader
        camper={camper}
        currentYear={2026}
        location={null}
        sessionShortName="WW"
        pronouns="she/her"
        journeyCounts={{ summers: 0, familyWeekends: 0, adultWeekends: 5 }}
        {...extra}
      />
    </MemoryRouter>
  )
}

describe('HeroHeader count line (spec §6.1)', () => {
  it('shows the shared label instead of "years at camp"', () => {
    renderHero()
    expect(screen.getByText('5 adult weekends')).toBeInTheDocument()
    expect(screen.queryByText(/years at camp/)).toBeNull()
  })

  it('hides the stat when every count is zero', () => {
    const { container } = renderHero({
      journeyCounts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
    })
    expect(screen.queryByText(/weekend|summer/)).toBeNull()
    // The whole stat is gone, not just its text: TreePine appears in the hero
    // only on this stat, so an empty span beside a bare icon would fail here.
    expect(container.querySelector('.lucide-tree-pine')).toBeNull()
  })
})
